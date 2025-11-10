import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';

interface Location {
  lat: number;
  lng: number;
}

interface AirportLocation {
  location?: Location;
  icao?: string;
  iata?: string;
}

interface Route {
  departureAirport?: AirportLocation;
  arrivalAirport?: AirportLocation;
  flightData?: {
    actualDeparture?: number;
    scheduledDeparture?: number;
    actualArrival?: number;
    scheduledArrival?: number;
  };
  flightStatus?: string;
  progressPercent?: number;
  aircraft?: {
    type?: string;
    model?: string;
  };
}

interface Aircraft {
  latitude?: number | null;
  longitude?: number | null;
  last_contact?: number | null;
  velocity?: number | null;
  true_track?: number | null;
  baro_altitude?: number | null;
  vertical_rate?: number | null;
  category?: number | null;
  callsign?: string | null;
  icao24?: string;
  [key: string]: any;
}

interface PredictedPosition {
  latitude: number;
  longitude: number;
  baro_altitude: number | null;
  predicted: boolean;
  confidence: number;
}

/**
 * Trajectory Prediction Service
 * 
 * Uses route data (departure/arrival airports) and last known position to predict
 * aircraft locations between real API updates (every 2 minutes).
 */
class TrajectoryPredictionService {
  // Route cache for future use (currently unused but kept for API compatibility)
  // @ts-ignore - unused but part of original API
  private _routeCache: Map<string, any>;

  constructor() {
    // @ts-ignore - unused but part of original API
    this._routeCache = new Map();
  }

  /**
   * Predict aircraft position based on:
   * 1. Last known position (from database)
   * 2. Route data (departure/arrival airports from cache/history)
   * 3. Last known velocity, heading, altitude
   */
  predictPosition(
    aircraft: Aircraft,
    route: Route | null | undefined,
    elapsedSeconds: number
  ): PredictedPosition | null {
    if (!aircraft.latitude || !aircraft.longitude || !aircraft.last_contact) {
      return null;
    }

    if (route?.departureAirport?.location && route?.arrivalAirport?.location) {
      return this.predictAlongGreatCircle(
        aircraft,
        route.departureAirport.location,
        route.arrivalAirport.location,
        elapsedSeconds,
        route.flightData,
      );
    }

    if (aircraft.velocity && aircraft.true_track !== null) {
      return this.predictDeadReckoning(aircraft, elapsedSeconds);
    }

    return null;
  }

  /**
   * Predict position along great circle route between departure and arrival airports
   */
  predictAlongGreatCircle(
    aircraft: Aircraft,
    depLocation: Location,
    arrLocation: Location,
    elapsedSeconds: number,
    flightData?: { actualDeparture?: number; scheduledDeparture?: number; actualArrival?: number; scheduledArrival?: number } | null
  ): PredictedPosition {
    const depLat = depLocation.lat;
    const depLon = depLocation.lng;
    const arrLat = arrLocation.lat;
    const arrLon = arrLocation.lng;

    const totalDistance = this.haversineDistance(depLat, depLon, arrLat, arrLon);
    const distanceFromDep = this.haversineDistance(
      depLat, depLon,
      aircraft.latitude!, aircraft.longitude!,
    );

    let progress = totalDistance > 0 ? distanceFromDep / totalDistance : 0;
    progress = Math.max(0, Math.min(1, progress));

    if (flightData) {
      const timeProgress = this.calculateTimeProgress(flightData, elapsedSeconds);
      if (timeProgress !== null) {
        progress = (timeProgress * 0.7) + (progress * 0.3);
      }
    }

    const estimatedSpeedMs = aircraft.velocity || 250;
    const distanceTraveled = estimatedSpeedMs * elapsedSeconds;
    const progressIncrease = totalDistance > 0 ? distanceTraveled / totalDistance : 0;
    const newProgress = Math.min(1, progress + progressIncrease);

    const predictedPos = this.interpolateGreatCircle(
      depLat, depLon,
      arrLat, arrLon,
      newProgress,
    );

    const predictedAltitude = this.predictAltitude(
      aircraft.baro_altitude,
      progress,
      aircraft.vertical_rate,
      elapsedSeconds,
    );

    return {
      latitude: predictedPos.lat,
      longitude: predictedPos.lng,
      baro_altitude: predictedAltitude,
      predicted: true,
      confidence: this.calculateConfidence(progress, elapsedSeconds, flightData),
    };
  }

  /**
   * Dead reckoning: Predict position based on last known speed and heading
   */
  predictDeadReckoning(aircraft: Aircraft, elapsedSeconds: number): PredictedPosition | null {
    if (!aircraft.velocity || aircraft.true_track === null || aircraft.latitude === null || aircraft.longitude === null) {
      return null;
    }

    const metersPerDegreeLat = 111000;
    const metersPerDegreeLon = 111000 * Math.cos(aircraft.latitude * Math.PI / 180);
    const distanceMeters = aircraft.velocity * elapsedSeconds;
    const headingRad = (aircraft.true_track * Math.PI) / 180;

    const deltaLat = (distanceMeters / metersPerDegreeLat) * Math.cos(headingRad);
    const deltaLon = (distanceMeters / metersPerDegreeLon) * Math.sin(headingRad);

    let predictedAltitude = aircraft.baro_altitude;
    if (aircraft.vertical_rate) {
      predictedAltitude = (aircraft.baro_altitude || 0) + (aircraft.vertical_rate * elapsedSeconds);
      predictedAltitude = Math.max(0, Math.min(50000, predictedAltitude));
    }

    return {
      latitude: aircraft.latitude + deltaLat,
      longitude: aircraft.longitude + deltaLon,
      baro_altitude: predictedAltitude,
      predicted: true,
      confidence: 0.6,
    };
  }

  /**
   * Calculate time-based progress if we have scheduled/actual flight times
   */
  calculateTimeProgress(
    flightData: { actualDeparture?: number; scheduledDeparture?: number; actualArrival?: number; scheduledArrival?: number },
    _elapsedSeconds: number
  ): number | null {
    const now = Math.floor(Date.now() / 1000);
    const departureTime = flightData.actualDeparture || flightData.scheduledDeparture;
    const arrivalTime = flightData.actualArrival || flightData.scheduledArrival;

    if (!departureTime || !arrivalTime) return null;

    const flightDuration = arrivalTime - departureTime;
    const elapsedSinceDeparture = now - departureTime;

    if (flightDuration <= 0 || elapsedSinceDeparture < 0) return null;

    return Math.min(1, Math.max(0, elapsedSinceDeparture / flightDuration));
  }

  /**
   * Predict altitude based on flight phase
   */
  predictAltitude(
    currentAltitude: number | null | undefined,
    progress: number,
    verticalRate: number | null | undefined,
    elapsedSeconds: number
  ): number | null {
    if (currentAltitude === null || currentAltitude === undefined) {
      return null;
    }

    if (verticalRate) {
      const predicted = currentAltitude + (verticalRate * elapsedSeconds);
      return Math.max(0, Math.min(50000, predicted));
    }

    if (progress < 0.33) {
      return Math.min(currentAltitude + (elapsedSeconds * 3), 12000);
    } else if (progress > 0.67) {
      return Math.max(currentAltitude - (elapsedSeconds * 3), 0);
    } else {
      return currentAltitude;
    }
  }

  /**
   * Calculate confidence score for prediction (0-1)
   */
  calculateConfidence(
    progress: number,
    elapsedSeconds: number,
    flightData?: { actualDeparture?: number; scheduledDeparture?: number } | null
  ): number {
    let confidence = 1.0;

    if (progress > 0.1 && progress < 0.9) {
      confidence = 0.9;
    }

    const minutesSinceUpdate = elapsedSeconds / 60;
    if (minutesSinceUpdate > 5) {
      confidence *= Math.max(0.5, 1 - (minutesSinceUpdate - 5) * 0.1);
    }

    if (flightData && (flightData.scheduledDeparture || flightData.actualDeparture)) {
      confidence = Math.min(1.0, confidence * 1.1);
    }

    return Math.max(0.5, Math.min(1.0, confidence));
  }

  /**
   * Calculate distance between two points using Haversine formula (in meters)
   */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
      * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Interpolate position along great circle route
   */
  interpolateGreatCircle(lat1: number, lon1: number, lat2: number, lon2: number, f: number): Location {
    const lat1Rad = lat1 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;

    const d = Math.acos(
      Math.sin(lat1Rad) * Math.sin(lat2Rad)
      + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad),
    );

    if (Math.abs(d) < 1e-10) {
      return { lat: lat1, lng: lon1 };
    }

    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);

    const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);

    const latRad = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lonRad = Math.atan2(y, x);

    return {
      lat: latRad * 180 / Math.PI,
      lng: lonRad * 180 / Math.PI,
    };
  }

  /**
   * Enhance aircraft data with predicted positions for all aircraft in viewport
   */
  async enhanceAircraftWithPredictions(aircraftList: Aircraft[]): Promise<Aircraft[]> {
    const now = Math.floor(Date.now() / 1000);
    
    return Promise.all(aircraftList.map(async (aircraft) => {
      const elapsedSeconds = aircraft.last_contact ? (now - aircraft.last_contact) : 0;

      if (elapsedSeconds < 30) {
        return aircraft;
      }

      if (elapsedSeconds > 600) {
        return aircraft;
      }

      if (aircraft.category === 7) {
        return aircraft;
      }

      if (aircraft.velocity !== null && aircraft.velocity !== undefined && aircraft.velocity < 50) {
        return aircraft;
      }

      const cacheKey = aircraft.callsign || aircraft.icao24;
      let route: Route | null = null;
      
      try {
        route = await postgresRepository.getCachedRoute(cacheKey || '') as Route | null;
      } catch (err) {
        // Route not found, continue
      }

      if (route) {
        if (route.departureAirport && !route.departureAirport.location) {
          const depCode = route.departureAirport.icao || route.departureAirport.iata;
          if (depCode) {
            try {
              const depAirport = await postgresRepository.findAirportByCode(depCode);
              if (depAirport) {
                route.departureAirport.location = {
                  lat: parseFloat(depAirport.latitude_deg),
                  lng: parseFloat(depAirport.longitude_deg),
                };
              }
            } catch (err) {
              const error = err as Error;
              logger.debug('Could not fetch departure airport location', { code: depCode, error: error.message });
            }
          }
        }

        if (route.arrivalAirport && !route.arrivalAirport.location) {
          const arrCode = route.arrivalAirport.icao || route.arrivalAirport.iata;
          if (arrCode) {
            try {
              const arrAirport = await postgresRepository.findAirportByCode(arrCode);
              if (arrAirport) {
                route.arrivalAirport.location = {
                  lat: parseFloat(arrAirport.latitude_deg),
                  lng: parseFloat(arrAirport.longitude_deg),
                };
              }
            } catch (err) {
              const error = err as Error;
              logger.debug('Could not fetch arrival airport location', { code: arrCode, error: error.message });
            }
          }
        }
      } else if (aircraft.callsign) {
        try {
          const recentHistory = await postgresRepository.getHistoricalRoutes(
            aircraft.icao24 || '',
            null,
            null,
            1,
          );
          if (recentHistory && recentHistory.length > 0) {
            const historyRoute = recentHistory[0] as any;
            if (historyRoute.departureAirport && historyRoute.arrivalAirport) {
              const depCode = historyRoute.departureAirport.icao || historyRoute.departureAirport.iata;
              const arrCode = historyRoute.arrivalAirport.icao || historyRoute.arrivalAirport.iata;
              
              let depAirport = null;
              let arrAirport = null;

              if (depCode) {
                try {
                  depAirport = await postgresRepository.findAirportByCode(depCode);
                } catch (err) {
                  logger.debug('Could not fetch departure airport from history', { code: depCode });
                }
              }

              if (arrCode) {
                try {
                  arrAirport = await postgresRepository.findAirportByCode(arrCode);
                } catch (err) {
                  logger.debug('Could not fetch arrival airport from history', { code: arrCode });
                }
              }

              if (depAirport && arrAirport) {
                route = {
                  ...historyRoute,
                  departureAirport: {
                    ...historyRoute.departureAirport,
                    location: {
                      lat: parseFloat(depAirport.latitude_deg),
                      lng: parseFloat(depAirport.longitude_deg),
                    },
                  },
                  arrivalAirport: {
                    ...historyRoute.arrivalAirport,
                    location: {
                      lat: parseFloat(arrAirport.latitude_deg),
                      lng: parseFloat(arrAirport.longitude_deg),
                    },
                  },
                };
              }
            }
          }
        } catch (err) {
          const error = err as Error;
          logger.debug('Could not fetch route from history', { icao24: aircraft.icao24, error: error.message });
        }
      }

      const hasSameAirportRoute = route
        && route.departureAirport?.icao
        && route.arrivalAirport?.icao
        && route.departureAirport.icao === route.arrivalAirport.icao;

      const flightStatus = route?.flightStatus ? String(route.flightStatus).toLowerCase() : null;
      const progressPercent = route?.progressPercent;
      const routeAircraftDescriptor = (route?.aircraft?.type || route?.aircraft?.model || '').toString().toLowerCase();
      const isRouteRotorcraft = /^(b0[0-9]|bk[0-9]|h[0-9]|ec[0-9]|as[0-9])/.test(routeAircraftDescriptor)
        || routeAircraftDescriptor.includes('heli')
        || routeAircraftDescriptor.includes('rotor')
        || routeAircraftDescriptor.includes('jetranger')
        || routeAircraftDescriptor.includes('longranger');

      if (hasSameAirportRoute
        || flightStatus === 'arrived'
        || (typeof progressPercent === 'number' && progressPercent >= 100)
        || isRouteRotorcraft) {
        return aircraft;
      }

      const predicted = this.predictPosition(aircraft, route, elapsedSeconds);

      if (predicted) {
        return {
          ...aircraft,
          latitude: predicted.latitude,
          longitude: predicted.longitude,
          baro_altitude: predicted.baro_altitude,
          predicted: true,
          prediction_confidence: predicted.confidence,
          last_update_age_seconds: elapsedSeconds,
        };
      }

      return aircraft;
    }));
  }
}

export default new TrajectoryPredictionService();
