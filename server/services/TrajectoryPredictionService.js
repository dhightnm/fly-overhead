const logger = require('../utils/logger');
const postgresRepository = require('../repositories/PostgresRepository');

/**
 * Trajectory Prediction Service
 *
 * Uses route data (departure/arrival airports) and last known position to predict
 * aircraft locations between real API updates (every 2 minutes).
 *
 * This is how commercial flight tracking services work:
 * - Real positions when available (from OpenSky every 2 min)
 * - Great circle route prediction based on departure/arrival airports
 * - Dead reckoning: extrapolate position based on last known speed/heading/altitude
 * - Smooth interpolation along predicted route until next real update
 */
class TrajectoryPredictionService {
  constructor() {
    // Cache for route calculations (dep/arr -> great circle path)
    this.routeCache = new Map();
  }

  /**
   * Predict aircraft position based on:
   * 1. Last known position (from database)
   * 2. Route data (departure/arrival airports from cache/history)
   * 3. Last known velocity, heading, altitude
   *
   * @param {Object} aircraft - Aircraft data from database
   * @param {Object} route - Route data (from FlightRouteService cache)
   * @param {number} elapsedSeconds - Time since last_contact (in seconds)
   * @returns {Object|null} - Predicted position {latitude, longitude, baro_altitude} or null if can't predict
   */
  predictPosition(aircraft, route, elapsedSeconds) {
    // Can't predict without last known position
    if (!aircraft.latitude || !aircraft.longitude || !aircraft.last_contact) {
      return null;
    }

    // If we have both departure and arrival, use great circle route prediction
    if (route?.departureAirport?.location && route?.arrivalAirport?.location) {
      return this.predictAlongGreatCircle(
        aircraft,
        route.departureAirport.location,
        route.arrivalAirport.location,
        elapsedSeconds,
        route.flightData,
      );
    }

    // If we only have departure or no route, use dead reckoning (speed + heading)
    if (aircraft.velocity && aircraft.true_track !== null) {
      return this.predictDeadReckoning(aircraft, elapsedSeconds);
    }

    return null;
  }

  /**
   * Predict position along great circle route between departure and arrival airports
   * This is the most accurate method when we know the full route
   */
  predictAlongGreatCircle(aircraft, depLocation, arrLocation, elapsedSeconds, flightData) {
    const depLat = depLocation.lat;
    const depLon = depLocation.lng;
    const arrLat = arrLocation.lat;
    const arrLon = arrLocation.lng;

    // Calculate total distance along great circle
    const totalDistance = this.haversineDistance(depLat, depLon, arrLat, arrLon);

    // Calculate distance from departure to last known position
    const distanceFromDep = this.haversineDistance(
      depLat,
      depLon,
      aircraft.latitude,
      aircraft.longitude,
    );

    // Estimate flight progress (0 = departure, 1 = arrival)
    // Use distance along route as progress indicator
    let progress = totalDistance > 0 ? distanceFromDep / totalDistance : 0;

    // Clamp progress between 0 and 1
    progress = Math.max(0, Math.min(1, progress));

    // If we have scheduled/actual flight times, use time-based progress
    if (flightData) {
      const timeProgress = this.calculateTimeProgress(flightData, elapsedSeconds);
      if (timeProgress !== null) {
        // Blend distance and time progress (weight time more heavily if available)
        progress = (timeProgress * 0.7) + (progress * 0.3);
      }
    }

    // Calculate how much further along route aircraft should be
    // Use last known velocity to estimate distance traveled since last update
    const estimatedSpeedMs = aircraft.velocity ? aircraft.velocity : 250; // m/s, default ~900 km/h
    const distanceTraveled = estimatedSpeedMs * elapsedSeconds; // meters
    const progressIncrease = totalDistance > 0 ? distanceTraveled / totalDistance : 0;

    // Update progress
    const newProgress = Math.min(1, progress + progressIncrease);

    // Calculate position along great circle at new progress
    const predictedPos = this.interpolateGreatCircle(
      depLat,
      depLon,
      arrLat,
      arrLon,
      newProgress,
    );

    // Predict altitude (typically climbs to cruise, then descends)
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
      predicted: true, // Flag to indicate this is predicted, not real
      confidence: this.calculateConfidence(progress, elapsedSeconds, flightData),
    };
  }

  /**
   * Dead reckoning: Predict position based on last known speed and heading
   * Less accurate than great circle, but works when route is unknown
   */
  predictDeadReckoning(aircraft, elapsedSeconds) {
    if (!aircraft.velocity || aircraft.true_track === null) {
      return null;
    }

    // Convert velocity from m/s to degrees (rough approximation)
    // 1 degree latitude ≈ 111,000 meters
    // 1 degree longitude ≈ 111,000 * cos(latitude) meters
    const metersPerDegreeLat = 111000;
    const metersPerDegreeLon = 111000 * Math.cos(aircraft.latitude * Math.PI / 180);

    // Calculate distance traveled (meters)
    const distanceMeters = aircraft.velocity * elapsedSeconds;

    // Convert heading to radians (0° = North, clockwise)
    const headingRad = (aircraft.true_track * Math.PI) / 180;

    // Calculate displacement
    const deltaLat = (distanceMeters / metersPerDegreeLat) * Math.cos(headingRad);
    const deltaLon = (distanceMeters / metersPerDegreeLon) * Math.sin(headingRad);

    // Predict altitude (use vertical rate if available)
    let predictedAltitude = aircraft.baro_altitude;
    if (aircraft.vertical_rate) {
      predictedAltitude = aircraft.baro_altitude + (aircraft.vertical_rate * elapsedSeconds);
      // Clamp to reasonable values
      predictedAltitude = Math.max(0, Math.min(50000, predictedAltitude));
    }

    return {
      latitude: aircraft.latitude + deltaLat,
      longitude: aircraft.longitude + deltaLon,
      baro_altitude: predictedAltitude,
      predicted: true,
      confidence: 0.6, // Lower confidence for dead reckoning
    };
  }

  /**
   * Calculate time-based progress if we have scheduled/actual flight times
   */
  calculateTimeProgress(flightData, elapsedSeconds) {
    if (!flightData) return null;

    const now = Math.floor(Date.now() / 1000);

    // Use actual times if available, fall back to scheduled
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
   * Typical profile: climb to cruise (first 1/3), cruise (middle 1/3), descend (last 1/3)
   */
  predictAltitude(currentAltitude, progress, verticalRate, elapsedSeconds) {
    if (!currentAltitude && currentAltitude !== 0) {
      return null;
    }

    // If we have vertical rate, use it for prediction
    if (verticalRate) {
      const predicted = currentAltitude + (verticalRate * elapsedSeconds);
      return Math.max(0, Math.min(50000, predicted));
    }

    // Otherwise, estimate based on typical flight profile
    if (progress < 0.33) {
      // Climbing phase - estimate cruise altitude (typically 10-12km for commercial)
      return Math.min(currentAltitude + (elapsedSeconds * 3), 12000);
    } if (progress > 0.67) {
      // Descending phase
      return Math.max(currentAltitude - (elapsedSeconds * 3), 0);
    }
    // Cruise - altitude should be relatively stable
    return currentAltitude;
  }

  /**
   * Calculate confidence score for prediction (0-1)
   */
  calculateConfidence(progress, elapsedSeconds, flightData) {
    let confidence = 1.0;

    // Lower confidence for predictions far from departure/arrival
    // Middle of flight = more uncertainty
    if (progress > 0.1 && progress < 0.9) {
      confidence = 0.9;
    }

    // Lower confidence as time since last update increases
    // After 5 minutes, confidence drops significantly
    const minutesSinceUpdate = elapsedSeconds / 60;
    if (minutesSinceUpdate > 5) {
      confidence *= Math.max(0.5, 1 - (minutesSinceUpdate - 5) * 0.1);
    }

    // Higher confidence if we have flight timing data
    if (flightData && (flightData.scheduledDeparture || flightData.actualDeparture)) {
      confidence = Math.min(1.0, confidence * 1.1);
    }

    return Math.max(0.5, Math.min(1.0, confidence));
  }

  /**
   * Calculate distance between two points using Haversine formula (in meters)
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
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
   * Returns position at fraction f (0 = departure, 1 = arrival)
   */
  interpolateGreatCircle(lat1, lon1, lat2, lon2, f) {
    // Convert to radians
    const lat1Rad = lat1 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;

    // Angular distance
    const d = Math.acos(
      Math.sin(lat1Rad) * Math.sin(lat2Rad)
      + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad),
    );

    // Avoid division by zero
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
   * This should be called when serving aircraft data to client
   */
  async enhanceAircraftWithPredictions(aircraftList) {
    const now = Math.floor(Date.now() / 1000);

    return Promise.all(aircraftList.map(async (aircraft) => {
      // Calculate time since last update
      const elapsedSeconds = aircraft.last_contact ? (now - aircraft.last_contact) : 0;

      // Skip prediction if data is very fresh (< 30 seconds)
      if (elapsedSeconds < 30) {
        return aircraft;
      }

      // Skip prediction if data is too stale (> 10 minutes) - likely not flying
      if (elapsedSeconds > 600) {
        return aircraft;
      }

      // Skip prediction for rotorcraft/helicopters (OpenSky category 7)
      if (aircraft.category === 7) {
        return aircraft;
      }

      // Skip prediction if velocity extremely low (< 50 m/s ~ 97 kts)
      if (aircraft.velocity !== null && aircraft.velocity !== undefined && aircraft.velocity < 50) {
        return aircraft;
      }

      // Get route data from cache or database
      const cacheKey = aircraft.callsign || aircraft.icao24;
      let route = await postgresRepository.getCachedRoute(cacheKey);

      // If route exists but missing airport locations, fetch them
      if (route) {
        if (route.departureAirport && !route.departureAirport.location) {
          const depCode = route.departureAirport.icao || route.departureAirport.iata;
          if (depCode) {
            try {
              const depAirport = await postgresRepository.findAirportByCode(depCode);
              if (depAirport) {
                route.departureAirport.location = {
                  lat: depAirport.latitude_deg,
                  lng: depAirport.longitude_deg,
                };
              }
            } catch (err) {
              logger.debug('Could not fetch departure airport location', { code: depCode, error: err.message });
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
                  lat: arrAirport.latitude_deg,
                  lng: arrAirport.longitude_deg,
                };
              }
            } catch (err) {
              logger.debug('Could not fetch arrival airport location', { code: arrCode, error: err.message });
            }
          }
        }
      } else if (aircraft.callsign) {
        // If no route in cache, check history for recent flights
        try {
          const recentHistory = await postgresRepository.getHistoricalRoutes(
            aircraft.icao24,
            null,
            null,
            1,
          );
          if (recentHistory && recentHistory.length > 0) {
            const historyRoute = recentHistory[0];
            // Convert history format to route format
            if (historyRoute.departureAirport && historyRoute.arrivalAirport) {
              // Fetch airport locations
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
                      lat: depAirport.latitude_deg,
                      lng: depAirport.longitude_deg,
                    },
                  },
                  arrivalAirport: {
                    ...historyRoute.arrivalAirport,
                    location: {
                      lat: arrAirport.latitude_deg,
                      lng: arrAirport.longitude_deg,
                    },
                  },
                };
              }
            }
          }
        } catch (err) {
          logger.debug('Could not fetch route from history', { icao24: aircraft.icao24, error: err.message });
        }
      }

      // Predict position
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
        // Merge predicted position with aircraft data
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

module.exports = new TrajectoryPredictionService();
