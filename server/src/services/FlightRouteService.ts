import axios, { AxiosError } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import openSkyService from './OpenSkyService';
import aerodataboxService from './AerodataboxService';
import { mapAircraftType } from '../utils/aircraftCategoryMapper';

interface Airport {
  iata?: string | null;
  icao?: string | null;
  name?: string | null;
  location?: {
    lat: number;
    lng: number;
  } | null;
  inferred?: boolean;
  historical?: boolean;
}

interface FlightData {
  firstSeen?: number | null;
  lastSeen?: number | null;
  duration?: number | null;
  scheduledDeparture?: number | null;
  scheduledArrival?: number | null;
  actualDeparture?: number | null;
  actualArrival?: number | null;
  filedEte?: number | null;
}

interface AircraftInfo {
  type?: string | null;
  model?: string | null;
  category?: number | null;
}

interface Route {
  departureAirport?: Airport;
  arrivalAirport?: Airport;
  flightData?: FlightData;
  aircraft?: AircraftInfo;
  flightStatus?: string | null;
  route?: string | null;
  routeDistance?: number | null;
  baggageClaim?: string | null;
  gateOrigin?: string | null;
  gateDestination?: string | null;
  terminalOrigin?: string | null;
  terminalDestination?: string | null;
  actualRunwayOff?: string | null;
  actualRunwayOn?: string | null;
  progressPercent?: number | null;
  filedAirspeed?: number | null;
  blocked?: boolean;
  diverted?: boolean;
  cancelled?: boolean;
  departureDelay?: number | null;
  arrivalDelay?: number | null;
  registration?: string | null;
  source?: string;
  callsign?: string | null;
  icao24?: string | null;
  incompleteRoute?: boolean;
}

interface LandedFlightCache {
  hasLanded: boolean;
  lastArrival: number | null;
  timestamp: number;
}

interface OpenSkyFlight {
  callsign?: string | null;
  firstSeen?: number | null;
  lastSeen?: number | null;
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  departureAirportCandidatesCount?: number;
  arrivalAirportCandidatesCount?: number;
}

interface FlightAwareFlight {
  origin?: {
    code_iata?: string;
    code_icao?: string;
    code?: string;
    name?: string;
  };
  destination?: {
    code_iata?: string;
    code_icao?: string;
    code?: string;
    name?: string;
  };
  aircraft_type?: string;
  registration?: string;
  status?: string;
  route?: string;
  route_distance?: number;
  baggage_claim?: string;
  gate_origin?: string;
  gate_destination?: string;
  terminal_origin?: string;
  terminal_destination?: string;
  actual_runway_off?: string;
  actual_runway_on?: string;
  progress_percent?: number;
  filed_airspeed?: number;
  blocked?: boolean;
  diverted?: boolean;
  cancelled?: boolean;
  departure_delay?: number;
  arrival_delay?: number;
  scheduled_off?: string;
  scheduled_on?: string;
  scheduled_out?: string;
  scheduled_in?: string;
  actual_off?: string;
  actual_on?: string;
  actual_out?: string;
  actual_in?: string;
  filed_ete?: number;
  ident?: string;
}

interface AirportCandidate {
  ident?: string;
  iata_code?: string;
  gps_code?: string;
  name?: string;
  type?: string;
  latitude_deg?: number;
  longitude_deg?: number;
  distance_km?: number;
  runways?: Array<{
    length_m?: number;
    length_ft?: number;
  }>;
  callsign?: string;
}

/**
 * Service for fetching flight route information (departure/arrival airports)
 * Uses OpenSky Network API (FREE!) and FlightAware AeroAPI
 * Implements intelligent caching to minimize API calls
 */
export interface FlightRouteServiceOptions {
  flightAwareBaseUrl?: string | null;
  flightAwareApiKey?: string | null;
}

type FlightAwareConfig = {
  baseUrl?: string | null;
  apiKey?: string | null;
};

export class FlightRouteService {
  private flightAwareBaseUrl: string | undefined;

  private flightAwareApiKey: string | undefined;

  private cache: Map<string, Route>;

  private landedFlightsCache: Map<string, LandedFlightCache>;

  constructor(options?: FlightRouteServiceOptions) {
    const configSource: FlightAwareConfig = (config?.external?.flightAware ?? {}) as FlightAwareConfig;
    const resolvedBaseUrl = options && Object.prototype.hasOwnProperty.call(options, 'flightAwareBaseUrl')
      ? options.flightAwareBaseUrl
      : configSource.baseUrl;
    const resolvedApiKey = options && Object.prototype.hasOwnProperty.call(options, 'flightAwareApiKey')
      ? options.flightAwareApiKey
      : configSource.apiKey;

    this.flightAwareBaseUrl = typeof resolvedBaseUrl === 'string' && resolvedBaseUrl.trim() !== '' ? resolvedBaseUrl.trim() : undefined;
    this.flightAwareApiKey = typeof resolvedApiKey === 'string' && resolvedApiKey.trim() !== '' ? resolvedApiKey.trim() : undefined;
    this.cache = new Map();
    this.landedFlightsCache = new Map();
  }

  /**
   * Check if a flight has landed based on FlightAware data
   */
  async hasFlightLanded(
    callsign: string | null | undefined,
  ): Promise<{ hasLanded: boolean; lastArrival: number | null }> {
    if (!this.flightAwareApiKey || !callsign) return { hasLanded: false, lastArrival: null };

    const cached = this.landedFlightsCache.get(callsign);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < 30 * 60 * 1000) {
        logger.debug(`Landed flight cache HIT: ${callsign} = ${cached.hasLanded}`);
        return { hasLanded: cached.hasLanded, lastArrival: cached.lastArrival };
      }
      this.landedFlightsCache.delete(callsign);
    }

    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const startDate = yesterday.toISOString().split('T')[0];

      const response = await axios.get(`${this.flightAwareBaseUrl}/flights/${callsign}`, {
        params: {
          start: startDate,
        },
        headers: {
          Accept: 'application/json; charset=UTF-8',
          'x-apikey': this.flightAwareApiKey,
        },
        timeout: 2000,
      });

      if (!response.data?.flights || response.data.flights.length === 0) {
        this.landedFlightsCache.set(callsign, {
          hasLanded: false,
          lastArrival: null,
          timestamp: Date.now(),
        });
        return { hasLanded: false, lastArrival: null };
      }

      let mostRecentLandedFlight: FlightAwareFlight | null = null;
      for (const flight of response.data.flights) {
        if (flight.actual_in) {
          mostRecentLandedFlight = flight;
          break;
        }
      }

      if (mostRecentLandedFlight) {
        const flight = mostRecentLandedFlight;
        const arrivalTime = new Date(flight.actual_in!).getTime();
        const now = Date.now();
        const hoursAgo = (now - arrivalTime) / (1000 * 60 * 60);
        logger.info('Flight landing status', {
          callsign,
          origin: flight.origin?.code_icao || flight.origin?.code_iata,
          destination: flight.destination?.code_icao || flight.destination?.code_iata,
          actualArrival: flight.actual_in,
          hoursAgo: hoursAgo.toFixed(2),
          hasLanded: hoursAgo > 0,
        });
        this.landedFlightsCache.set(callsign, {
          hasLanded: hoursAgo > 0,
          lastArrival: arrivalTime,
          timestamp: Date.now(),
        });
        return { hasLanded: hoursAgo > 0, lastArrival: arrivalTime };
      }
      logger.debug('No completed flights found for callsign', { callsign });
      this.landedFlightsCache.set(callsign, {
        hasLanded: false,
        lastArrival: null,
        timestamp: Date.now(),
      });
      return { hasLanded: false, lastArrival: null };
    } catch (error) {
      const err = error as Error;
      logger.debug('Could not check flight landing status', { callsign, error: err.message });
      return { hasLanded: false, lastArrival: null };
    }
  }

  /**
   * Get flight route information for an aircraft
   */
  async getFlightRoute(
    icao24: string | null | undefined,
    callsign: string | null | undefined,
    isCurrentFlight = false,
    allowExpensiveApis = false,
  ): Promise<Route | null> {
    const cacheKey = `${callsign || icao24}`;

    if (!allowExpensiveApis && this.cache.has(cacheKey)) {
      logger.debug('Route cache HIT (in-memory) - skipping API call', { cacheKey, icao24, callsign });
      const cachedRoute = this.cache.get(cacheKey)!;
      if (cachedRoute.aircraft?.type) {
        const aircraftInfo = mapAircraftType(cachedRoute.aircraft.type, cachedRoute.aircraft.model);
        cachedRoute.aircraft = {
          ...cachedRoute.aircraft,
          model: aircraftInfo.model,
          type: aircraftInfo.type,
          category: aircraftInfo.category,
        };
      }
      return cachedRoute;
    }

    if (!allowExpensiveApis) {
      const cachedRoute = await postgresRepository.getCachedRoute(cacheKey);
      if (cachedRoute) {
        if (cachedRoute.aircraft?.type) {
          const aircraftInfo = mapAircraftType(cachedRoute.aircraft.type, cachedRoute.aircraft.model);
          cachedRoute.aircraft = {
            ...cachedRoute.aircraft,
            model: aircraftInfo.model,
            type: aircraftInfo.type,
            category: aircraftInfo.category,
          };
        }

        logger.debug('Route cache HIT (database) - skipping API call', {
          cacheKey,
          icao24,
          callsign,
          source: cachedRoute.source || 'unknown',
          hasAircraft: !!cachedRoute.aircraft,
          allowExpensiveApis,
        });
        this.cache.set(cacheKey, cachedRoute as Route);
        return cachedRoute as Route;
      }
    } else {
      logger.debug('Skipping database cache for user-initiated request (allowExpensiveApis=true)', {
        cacheKey,
        icao24,
        callsign,
      });
    }

    logger.debug('Route cache MISS - fetching from API', {
      cacheKey,
      icao24,
      callsign,
      isCurrentFlight,
    });

    let finalCallsign = callsign;
    if (!finalCallsign && icao24 && allowExpensiveApis) {
      const callsignFromHistory = await postgresRepository.getDb().oneOrNone<{ callsign: string }>(
        `SELECT callsign 
         FROM flight_routes_history
         WHERE icao24 = $1
           AND callsign IS NOT NULL
           AND callsign != ''
         ORDER BY 
           CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
           created_at DESC
         LIMIT 1`,
        [icao24.toLowerCase()],
      );

      if (callsignFromHistory?.callsign) {
        finalCallsign = callsignFromHistory.callsign.trim();
        logger.info('Retrieved callsign from flight_routes_history for FlightAware query', {
          icao24,
          callsign: finalCallsign,
        });
      }
    }

    let aerodataboxRoute: Route | null = null;

    if (icao24 && allowExpensiveApis) {
      try {
        const aerodataboxData = await aerodataboxService.getFlightByIcao24(icao24.toLowerCase());
        if (aerodataboxData) {
          const { routeData, callsign: aerodataboxCallsign } = aerodataboxData;
          const mappedRoute: Route = {
            departureAirport: routeData.departureAirport || undefined,
            arrivalAirport: routeData.arrivalAirport || undefined,
            flightData: routeData.flightData,
            aircraft: routeData.aircraft
              ? {
                model: routeData.aircraft.model || null,
                type: routeData.aircraft.type || null,
                category: null,
              }
              : undefined,
            flightStatus: routeData.flightStatus || null,
            registration: routeData.registration || null,
            source: routeData.source || 'aerodatabox',
            callsign: routeData.callsign || null,
            icao24: routeData.icao24 || (icao24 ? icao24.toLowerCase() : null),
          };

          if (aerodataboxCallsign) {
            try {
              await postgresRepository.updateAircraftCallsign(icao24, aerodataboxCallsign);
            } catch (err) {
              const error = err as Error;
              logger.debug('Failed to persist callsign from Aerodatabox', { icao24, error: error.message });
            }
          }

          try {
            await this.cacheRoute(cacheKey, mappedRoute);
          } catch (err) {
            const error = err as Error;
            logger.debug('Failed to cache Aerodatabox route', { icao24, error: error.message });
          }

          try {
            await postgresRepository.storeRouteHistory({ ...routeData, source: mappedRoute.source });
          } catch (err) {
            const error = err as Error;
            logger.debug('Failed to store Aerodatabox route history', { icao24, error: error.message });
          }

          aerodataboxRoute = mappedRoute;

          if (!finalCallsign && aerodataboxCallsign) {
            finalCallsign = aerodataboxCallsign;
          }
        }
      } catch (err) {
        const error = err as Error;
        logger.debug('Aerodatabox enrichment failed', { icao24, error: error.message });
      }
    }

    if (!isCurrentFlight) {
      logger.info('Trying OpenSky for route data (historical flights only)', { icao24, callsign });
      try {
        const route = await this.fetchRouteFromOpenSky(icao24 || '', isCurrentFlight);
        if (route) {
          logger.info('Found route from OpenSky (historical data)', {
            icao24,
            callsign,
            departure: route.departureAirport?.icao || route.departureAirport?.iata,
            arrival: route.arrivalAirport?.icao || route.arrivalAirport?.iata,
          });
          await this.cacheRoute(cacheKey, {
            ...route,
            callsign,
            icao24: icao24 || null,
            source: 'opensky',
          });

          await postgresRepository.storeRouteHistory({
            ...route,
            callsign,
            icao24: icao24 || null,
            source: 'opensky',
          });

          return { ...route, source: 'opensky' };
        }
      } catch (error) {
        const err = error as Error;
        logger.debug('OpenSky flight route not available', {
          icao24,
          error: err.message,
        });
      }
    } else {
      logger.debug('Skipping OpenSky for current flight (saves 4-8 seconds)', { icao24, callsign });
    }

    if (this.flightAwareApiKey && finalCallsign && allowExpensiveApis) {
      logger.info('Trying FlightAware AeroAPI for route (user-initiated request)', { icao24, callsign: finalCallsign });
      try {
        const routeResult = await this.fetchRouteFromFlightAware(finalCallsign);
        if (routeResult) {
          const routes = Array.isArray(routeResult) ? routeResult : [routeResult];

          if (routes.length === 0) {
            logger.info('FlightAware returned empty route array', { icao24, callsign });
          } else {
            const activeRoutes = routes.filter((r) => {
              const status = r.flightStatus?.toLowerCase() || '';
              return (
                (status.includes('en route')
                  || status.includes('in flight')
                  || status === 'scheduled'
                  || status === 'departed')
                && !r.cancelled
                && !r.diverted
                && !r.flightData?.actualArrival
              );
            });

            const inFlightRoutes = activeRoutes.filter((r) => {
              const status = r.flightStatus?.toLowerCase() || '';
              return status.includes('en route') || status.includes('in flight');
            });

            const mostRecentRoute = inFlightRoutes.length > 0 ? inFlightRoutes[0] : activeRoutes.length > 0 ? activeRoutes[0] : routes[0];

            logger.info('Successfully fetched route from FlightAware', {
              icao24,
              callsign: finalCallsign,
              numFlights: routes.length,
              activeFlights: activeRoutes.length,
              departure: mostRecentRoute.departureAirport?.icao || mostRecentRoute.departureAirport?.iata,
              arrival: mostRecentRoute.arrivalAirport?.icao || mostRecentRoute.arrivalAirport?.iata,
              flightStatus: mostRecentRoute.flightStatus,
            });

            const enrichedRoute = { ...mostRecentRoute };
            if (mostRecentRoute.aircraft?.type) {
              const aircraftType = mostRecentRoute.aircraft.type;
              let aircraftInfo;

              if (aircraftType === 'Plane' && mostRecentRoute.aircraft.model) {
                aircraftInfo = mapAircraftType(mostRecentRoute.aircraft.model, null);
                if (!aircraftInfo.model) {
                  aircraftInfo = {
                    model: mostRecentRoute.aircraft.model,
                    type: aircraftType,
                    category: null,
                  };
                }
              } else {
                aircraftInfo = mapAircraftType(aircraftType, mostRecentRoute.aircraft.model);
              }

              enrichedRoute.aircraft = {
                ...mostRecentRoute.aircraft,
                model: aircraftInfo.model || mostRecentRoute.aircraft.model,
                type: aircraftInfo.type || aircraftType,
                category: aircraftInfo.category,
              };
            }

            await this.cacheRoute(cacheKey, {
              ...enrichedRoute,
              callsign: finalCallsign,
              icao24: icao24 || null,
              source: 'flightaware',
            });

            for (const route of routes) {
              try {
                await postgresRepository.storeRouteHistory({
                  ...route,
                  callsign,
                  icao24: icao24 || null,
                  source: 'flightaware',
                });
                logger.debug('Stored FlightAware flight in history', {
                  callsign,
                  icao24,
                  departure: route.departureAirport?.icao || route.departureAirport?.iata,
                  arrival: route.arrivalAirport?.icao || route.arrivalAirport?.iata,
                  hasScheduledStart: !!route.flightData?.scheduledDeparture,
                  hasActualStart: !!route.flightData?.actualDeparture,
                });
              } catch (storeErr) {
                const err = storeErr as Error;
                if (
                  !err.message?.includes('duplicate key')
                  && !err.message?.includes('uniq_flight_routes_history_flight_key')
                ) {
                  logger.warn('Failed to store FlightAware flight in history', {
                    callsign,
                    icao24,
                    error: err.message,
                  });
                }
              }
            }

            return {
              ...enrichedRoute, callsign: finalCallsign, icao24: icao24 || null, source: 'flightaware',
            };
          }
        }

        logger.info('FlightAware returned no route data by callsign, trying by icao24', {
          icao24,
          callsign: finalCallsign,
        });

        try {
          const searchResponse = await axios.get(`${this.flightAwareBaseUrl}/flights/search`, {
            params: {
              query: `-ident ${icao24}`,
              max_pages: 1,
            },
            headers: {
              Accept: 'application/json; charset=UTF-8',
              'x-apikey': this.flightAwareApiKey,
            },
            timeout: 8000,
          });

          if (searchResponse.data?.results && searchResponse.data.results.length > 0) {
            const flights = searchResponse.data.results as FlightAwareFlight[];
            const activeFlights = flights.filter((f) => {
              const status = f.status?.toLowerCase() || '';
              return (
                (status.includes('en route')
                  || status.includes('in flight')
                  || status === 'scheduled'
                  || status === 'departed')
                && !f.cancelled
                && !f.diverted
                && f.origin
                && f.destination
              );
            });

            if (activeFlights.length > 0) {
              const flight = activeFlights[0];
              const mappedRoute: Route = {
                departureAirport: {
                  iata: flight.origin?.code_iata || null,
                  icao: flight.origin?.code_icao || flight.origin?.code || null,
                  name: flight.origin?.name || null,
                },
                arrivalAirport: {
                  iata: flight.destination?.code_iata || null,
                  icao: flight.destination?.code_icao || flight.destination?.code || null,
                  name: flight.destination?.name || null,
                },
                aircraft: flight.aircraft_type
                  ? {
                    type: flight.aircraft_type || null,
                    model: flight.aircraft_type || null,
                  }
                  : undefined,
                flightStatus: flight.status || null,
              };

              logger.info('Found route from FlightAware by icao24', {
                icao24,
                callsign: flight.ident || finalCallsign,
                departure: mappedRoute.departureAirport?.icao,
                arrival: mappedRoute.arrivalAirport?.icao,
              });

              const foundCallsign = flight.ident || finalCallsign;

              await this.cacheRoute(cacheKey, {
                ...mappedRoute,
                callsign: foundCallsign,
                icao24: icao24 || null,
                source: 'flightaware',
              });

              return {
                ...mappedRoute,
                callsign: foundCallsign,
                icao24: icao24 || null,
                source: 'flightaware',
              };
            }
          }
        } catch (searchError) {
          const err = searchError as Error;
          logger.debug('FlightAware search by icao24 also failed', {
            icao24,
            error: err.message,
          });
        }

        logger.info('FlightAware returned no route data', { icao24, callsign: finalCallsign });
      } catch (error) {
        const err = error as AxiosError;
        const statusCode = err.response?.status;
        const isRateLimited = statusCode === 429;

        if (isRateLimited) {
          logger.warn('FlightAware rate limit reached (429) - trying other sources', {
            icao24,
            callsign,
            status: statusCode,
          });
        } else {
          logger.warn('Error fetching route from FlightAware API', {
            icao24,
            callsign,
            error: err.message,
            status: statusCode,
            statusText: err.response?.statusText,
          });
        }
      }
    } else if (!allowExpensiveApis) {
      logger.debug('Skipping FlightAware (background job) - using inference', { icao24, callsign });
    }

    if (icao24) {
      const existingRoute = await postgresRepository.getDb().oneOrNone<{
        callsign: string | null;
        departure_icao: string | null;
        departure_iata: string | null;
        departure_name: string | null;
        arrival_icao: string | null;
        arrival_iata: string | null;
        arrival_name: string | null;
        source: string | null;
        actual_flight_start: Date | null;
        actual_flight_end: Date | null;
        created_at: Date;
      }>(
        `SELECT callsign, departure_icao, departure_iata, departure_name,
                arrival_icao, arrival_iata, arrival_name, source,
                actual_flight_start, actual_flight_end, created_at
         FROM flight_routes_history
         WHERE icao24 = $1
           AND departure_icao IS NOT NULL
           AND arrival_icao IS NOT NULL
         ORDER BY 
           CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
           CASE WHEN actual_flight_start IS NOT NULL 
                AND actual_flight_start > NOW() - INTERVAL '24 hours' 
                THEN 0 ELSE 1 END ASC,
           actual_flight_start DESC NULLS LAST,
           created_at DESC
         LIMIT 1`,
        [icao24.toLowerCase()],
      );

      if (existingRoute) {
        logger.info('Found route from flight_routes_history', {
          icao24,
          callsign: existingRoute.callsign,
          departure: existingRoute.departure_icao,
          arrival: existingRoute.arrival_icao,
          source: existingRoute.source,
        });

        const depAirport = existingRoute.departure_icao
          ? await postgresRepository.findAirportByCode(existingRoute.departure_icao)
          : null;

        const arrAirport = existingRoute.arrival_icao
          ? await postgresRepository.findAirportByCode(existingRoute.arrival_icao)
          : null;

        const routeData: Route = {
          departureAirport: {
            iata: existingRoute.departure_iata || depAirport?.iata_code || null,
            icao: existingRoute.departure_icao || null,
            name: existingRoute.departure_name || depAirport?.name || null,
            location: depAirport
              ? {
                lat: parseFloat(depAirport.latitude_deg),
                lng: parseFloat(depAirport.longitude_deg),
              }
              : null,
          },
          arrivalAirport: {
            iata: existingRoute.arrival_iata || arrAirport?.iata_code || null,
            icao: existingRoute.arrival_icao || null,
            name: existingRoute.arrival_name || arrAirport?.name || null,
            location: arrAirport
              ? {
                lat: parseFloat(arrAirport.latitude_deg),
                lng: parseFloat(arrAirport.longitude_deg),
              }
              : null,
          },
          source: existingRoute.source || 'flight_routes_history',
        };

        const finalCallsign = callsign || existingRoute.callsign;

        await this.cacheRoute(cacheKey, {
          ...routeData,
          callsign: finalCallsign,
          icao24: icao24 || null,
        });

        return { ...routeData, callsign: finalCallsign, icao24: icao24 || null };
      }
    }

    const inferredRoute = await this.inferRouteFromPosition(icao24 || '');
    if (inferredRoute) {
      const hasArrival = inferredRoute.arrivalAirport?.icao || inferredRoute.arrivalAirport?.iata;

      logger.debug('Caching inferred route', {
        icao24,
        callsign,
        hasDeparture: !!(inferredRoute.departureAirport?.icao || inferredRoute.departureAirport?.iata),
        hasArrival,
        cacheTTL: hasArrival ? '24h' : '30min',
      });

      await this.cacheRoute(cacheKey, {
        ...inferredRoute,
        callsign,
        icao24: icao24 || null,
        source: 'inference',
        incompleteRoute: !hasArrival,
      });

      await postgresRepository.storeRouteHistory({
        ...inferredRoute,
        callsign,
        icao24: icao24 || null,
        source: 'inference',
      });

      return { ...inferredRoute, source: 'inference' };
    }
    return aerodataboxRoute;
  }

  /**
   * Fetch route from OpenSky Network (FREE!)
   */
  async fetchRouteFromOpenSky(icao24: string, isCurrentFlight = false): Promise<Route | null> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const oneDay = 24 * 60 * 60;

      const timeRanges: Array<{ begin: number; end: number }> = [];
      for (let i = 1; i <= 2; i++) {
        timeRanges.push({
          begin: now - (i + 1) * oneDay,
          end: now - i * oneDay,
        });
      }

      logger.info('Querying OpenSky for flights', {
        icao24,
        timeRanges: timeRanges.map((r) => ({
          begin: new Date(r.begin * 1000).toISOString(),
          end: new Date(r.end * 1000).toISOString(),
        })),
      });

      const allFlights: OpenSkyFlight[] = [];

      for (const range of timeRanges) {
        const flights = await openSkyService.getFlightsByAircraft(icao24, range.begin, range.end);
        if (flights && flights.length > 0) {
          allFlights.push(...flights);
        }
      }

      if (allFlights.length > 0) {
        const seen = new Set<string>();
        const uniqueFlights = allFlights.filter((flight) => {
          const key = `${flight.callsign?.trim() || ''}-${flight.firstSeen}-${flight.lastSeen}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const sortedFlights = uniqueFlights.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        const mostRecentFlight = sortedFlights[0];

        let inferredDeparture: string | null = null;
        if (sortedFlights.length > 1) {
          const candidates = mostRecentFlight.departureAirportCandidatesCount || 0;
          const departureAirport = mostRecentFlight.estDepartureAirport;
          const hasReliableDeparture = candidates > 0 && departureAirport && String(departureAirport).trim() !== '';

          logger.info('Checking if departure inference needed', {
            icao24,
            hasReliableDeparture,
            candidates,
            departureAirport,
            sortedFlightsCount: sortedFlights.length,
            mostRecentFlight: mostRecentFlight.callsign?.trim(),
          });

          if (!hasReliableDeparture) {
            for (let i = 1; i < sortedFlights.length; i++) {
              const previousFlight = sortedFlights[i];
              if (previousFlight.estArrivalAirport && String(previousFlight.estArrivalAirport).trim() !== '') {
                inferredDeparture = String(previousFlight.estArrivalAirport).trim();
                logger.info('Inferred departure from previous flight', {
                  icao24,
                  currentFlight: mostRecentFlight.callsign?.trim(),
                  currentFlightDeparture: mostRecentFlight.estDepartureAirport,
                  inferredDeparture,
                  previousFlight: previousFlight.callsign?.trim(),
                  previousArrival: previousFlight.estArrivalAirport,
                  previousArrivalCandidates: previousFlight.arrivalAirportCandidatesCount,
                });
                break;
              }
            }
          }
        }

        logger.info('Found OpenSky flight routes', {
          icao24,
          totalFlights: uniqueFlights.length,
          mostRecent: {
            callsign: mostRecentFlight.callsign?.trim(),
            departure: mostRecentFlight.estDepartureAirport,
            inferredDeparture,
            arrival: mostRecentFlight.estArrivalAirport,
          },
        });

        Promise.allSettled(
          uniqueFlights.map((flight) => {
            const hasDepartureCandidates = (flight.departureAirportCandidatesCount || 0) > 0;
            const hasDepartureData = !!flight.estDepartureAirport;

            if (hasDepartureData && !hasDepartureCandidates) {
              logger.warn('OpenSky flight has departure airport but 0 candidates (may be unreliable/wrong)', {
                icao24,
                callsign: flight.callsign?.trim(),
                departure: flight.estDepartureAirport,
                arrival: flight.estArrivalAirport,
                departureCandidates: flight.departureAirportCandidatesCount,
                arrivalCandidates: flight.arrivalAirportCandidatesCount,
              });
            }

            let reliableDeparture = hasDepartureCandidates ? flight.estDepartureAirport : null;

            if (!reliableDeparture && flight !== mostRecentFlight) {
              const currentIndex = sortedFlights.findIndex(
                (f) => f.firstSeen === flight.firstSeen && f.lastSeen === flight.lastSeen,
              );
              if (currentIndex > 0) {
                const previousFlight = sortedFlights[currentIndex - 1];
                if (
                  previousFlight.estArrivalAirport
                  && ((previousFlight.arrivalAirportCandidatesCount || 0) > 0 || previousFlight.estArrivalAirport)
                ) {
                  reliableDeparture = previousFlight.estArrivalAirport;
                  logger.debug('Inferred departure for historical flight from previous arrival', {
                    icao24,
                    flight: flight.callsign?.trim(),
                    inferredFrom: previousFlight.callsign?.trim(),
                  });
                }
              }
            }

            return postgresRepository.storeRouteHistory({
              callsign: flight.callsign?.trim() || null,
              icao24,
              departureAirport: {
                iata: null,
                icao: reliableDeparture,
                name: reliableDeparture,
              },
              arrivalAirport: {
                iata: null,
                icao: flight.estArrivalAirport || null,
                name: flight.estArrivalAirport || null,
              },
              flightData: {
                firstSeen: flight.firstSeen || null,
                lastSeen: flight.lastSeen || null,
                duration: flight.lastSeen ? flight.lastSeen - (flight.firstSeen || 0) : null,
              },
            });
          }),
        )
          .then((results) => {
            const succeeded = results.filter((r) => r.status === 'fulfilled').length;
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (succeeded > 0) {
              logger.info('Stored routes in history', {
                icao24,
                stored: succeeded,
                failed,
              });
            }
          })
          .catch((error) => {
            const err = error as Error;
            logger.warn('Error storing routes in history (non-critical)', { error: err.message });
          });

        const now = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = now - 7 * 24 * 60 * 60;
        const flightIsTooOld = (mostRecentFlight.lastSeen || 0) < sevenDaysAgo;

        if (flightIsTooOld) {
          logger.info('OpenSky flight data is too old (more than 7 days), skipping', {
            icao24,
            openSkyLastSeen: mostRecentFlight.lastSeen,
            openSkyLastSeenDate: mostRecentFlight.lastSeen
              ? new Date(mostRecentFlight.lastSeen * 1000).toISOString()
              : null,
          });
          return null;
        }

        logger.info('Using OpenSky historical route data (valid for current flights)', {
          icao24,
          openSkyLastSeen: mostRecentFlight.lastSeen,
          openSkyLastSeenDate: mostRecentFlight.lastSeen
            ? new Date(mostRecentFlight.lastSeen * 1000).toISOString()
            : null,
          isCurrentFlight,
        });

        const hasDepartureCandidates = (mostRecentFlight.departureAirportCandidatesCount || 0) > 0;
        const reliableDeparture = hasDepartureCandidates
          ? mostRecentFlight.estDepartureAirport
          : inferredDeparture || null;

        return {
          departureAirport: {
            iata: null,
            icao: reliableDeparture,
            name: reliableDeparture,
          },
          arrivalAirport: {
            iata: null,
            icao: mostRecentFlight.estArrivalAirport || null,
            name: mostRecentFlight.estArrivalAirport || null,
          },
          flightData: {
            firstSeen: mostRecentFlight.firstSeen || null,
            lastSeen: mostRecentFlight.lastSeen || null,
            duration: mostRecentFlight.lastSeen ? mostRecentFlight.lastSeen - (mostRecentFlight.firstSeen || 0) : null,
          },
        };
      }

      logger.debug('No OpenSky flights found for aircraft after checking all time ranges', { icao24 });
      return null;
    } catch (error) {
      const err = error as Error;
      logger.debug('Error fetching route from OpenSky', { icao24, error: err.message });
      return null;
    }
  }

  /**
   * Cache route data
   */
  async cacheRoute(cacheKey: string, routeData: Route): Promise<void> {
    logger.debug('FlightRouteService.cacheRoute called', {
      cacheKey,
      source: routeData.source,
      hasCallsign: !!routeData.callsign,
    });
    try {
      await postgresRepository.cacheRoute(cacheKey, routeData);
      this.cache.set(cacheKey, routeData);
      logger.debug('FlightRouteService.cacheRoute completed', { cacheKey, source: routeData.source });
    } catch (error) {
      const err = error as Error;
      logger.error('FlightRouteService.cacheRoute failed', { cacheKey, error: err.message });
      throw error;
    }
  }

  /**
   * Fetch route from FlightAware AeroAPI
   */
  async fetchRouteFromFlightAware(callsign: string, dateString: string | null = null): Promise<Route | Route[] | null> {
    try {
      const params: any = {};
      if (dateString) {
        params.start = dateString;
      }

      logger.info('Querying FlightAware AeroAPI', { callsign, date: dateString || 'all recent' });

      const response = await axios.get(`${this.flightAwareBaseUrl}/flights/${callsign}`, {
        params,
        headers: {
          Accept: 'application/json; charset=UTF-8',
          'x-apikey': this.flightAwareApiKey,
        },
        timeout: 8000,
      });

      if (!response.data?.flights || response.data.flights.length === 0) {
        logger.debug('FlightAware returned no flights', { callsign });
        return null;
      }

      const flights = response.data.flights as FlightAwareFlight[];

      const mapFlight = (flight: FlightAwareFlight): Route | null => {
        if (!flight.origin || !flight.destination) {
          return null;
        }

        const mapped: Route = {
          departureAirport: {
            iata: flight.origin.code_iata || null,
            icao: flight.origin.code_icao || flight.origin.code || null,
            name: flight.origin.name || null,
          },
          arrivalAirport: {
            iata: flight.destination.code_iata || null,
            icao: flight.destination.code_icao || flight.destination.code || null,
            name: flight.destination.name || null,
          },
          flightData: {
            scheduledDeparture: flight.scheduled_off
              ? new Date(flight.scheduled_off).getTime() / 1000
              : flight.scheduled_out
                ? new Date(flight.scheduled_out).getTime() / 1000
                : null,
            scheduledArrival: flight.scheduled_on
              ? new Date(flight.scheduled_on).getTime() / 1000
              : flight.scheduled_in
                ? new Date(flight.scheduled_in).getTime() / 1000
                : null,
            actualDeparture: flight.actual_off
              ? new Date(flight.actual_off).getTime() / 1000
              : flight.actual_out
                ? new Date(flight.actual_out).getTime() / 1000
                : null,
            actualArrival: flight.actual_on
              ? new Date(flight.actual_on).getTime() / 1000
              : flight.actual_in
                ? new Date(flight.actual_in).getTime() / 1000
                : null,
            filedEte: flight.filed_ete || null,
          },
          aircraft: flight.aircraft_type
            ? {
              type: flight.aircraft_type || null,
              model: flight.aircraft_type || null,
            }
            : undefined,
          registration: flight.registration || null,
          flightStatus: flight.status || null,
          route: flight.route || null,
          routeDistance: flight.route_distance || null,
          baggageClaim: flight.baggage_claim || null,
          gateOrigin: flight.gate_origin || null,
          gateDestination: flight.gate_destination || null,
          terminalOrigin: flight.terminal_origin || null,
          terminalDestination: flight.terminal_destination || null,
          actualRunwayOff: flight.actual_runway_off || null,
          actualRunwayOn: flight.actual_runway_on || null,
          progressPercent: flight.progress_percent || null,
          filedAirspeed: flight.filed_airspeed || null,
          blocked: flight.blocked || false,
          diverted: flight.diverted || false,
          cancelled: flight.cancelled || false,
          departureDelay: flight.departure_delay || null,
          arrivalDelay: flight.arrival_delay || null,
        };

        return mapped;
      };

      const mappedFlights = flights.map(mapFlight).filter((f) => f !== null) as Route[];

      if (mappedFlights.length === 0) {
        logger.debug('FlightAware returned no valid flights after mapping', { callsign });
        return null;
      }

      if (mappedFlights.length === 1) {
        return mappedFlights[0];
      }

      return mappedFlights;
    } catch (error) {
      const err = error as AxiosError;
      const statusCode = err.response?.status;
      if (statusCode === 429) {
        logger.warn('FlightAware rate limit (429)', { callsign });
        throw error;
      }
      if (statusCode === 404) {
        logger.debug('Flight not found in FlightAware', { callsign });
        return null;
      }
      logger.error('Error fetching route from FlightAware API', {
        callsign,
        error: err.message,
        status: statusCode,
        statusText: err.response?.statusText,
      });
      throw error;
    }
  }

  /**
   * Fallback: Infer route from flight position history and historical flight patterns
   */
  async inferRouteFromPosition(icao24: string): Promise<Route | null> {
    try {
      const history = await postgresRepository.findAircraftHistory(icao24);

      if (history.length < 2) {
        logger.debug('Not enough position history to infer route', { icao24, historyLength: history.length });
        return null;
      }

      const firstPos = history[0];
      const lastPos = history[history.length - 1];
      const callsign = firstPos.callsign ? firstPos.callsign.trim() : null;

      if (!firstPos.latitude || !firstPos.longitude) {
        logger.debug('Missing lat/lng in first position', { icao24 });
        return null;
      }

      logger.debug('Inferring route from position history and flight patterns', {
        icao24,
        callsign,
        firstPos: { lat: firstPos.latitude, lng: firstPos.longitude },
        lastPos: lastPos.latitude && lastPos.longitude ? { lat: lastPos.latitude, lng: lastPos.longitude } : 'invalid',
        historyPoints: history.length,
      });

      const departureAirports = await postgresRepository.findAirportsNearPoint(
        firstPos.latitude,
        firstPos.longitude,
        50,
        null,
      );

      const departureAirport = this.selectBestAirport(departureAirports, 'departure', icao24);

      if (!departureAirport) {
        logger.debug('Could not identify departure airport', { icao24 });
        return null;
      }

      logger.debug('Identified departure airport', {
        icao24,
        callsign,
        airport: departureAirport.ident,
        name: departureAirport.name,
        distance_km: departureAirport.distance_km,
      });

      let arrivalAirport: AirportCandidate | null = null;

      if (callsign) {
        const historicalRoute = await postgresRepository.findHistoricalRoute(callsign, departureAirport.ident || '');

        if (historicalRoute) {
          logger.info('Found historical route for callsign', {
            icao24,
            callsign,
            departure: historicalRoute.departure_icao,
            arrival: historicalRoute.arrival_icao,
            source: historicalRoute.source,
          });

          return {
            departureAirport: {
              iata: departureAirport.iata_code || null,
              icao: departureAirport.ident || departureAirport.gps_code || null,
              name: departureAirport.name || null,
              inferred: true,
              location: {
                lat:
                  typeof departureAirport.latitude_deg === 'string'
                    ? parseFloat(departureAirport.latitude_deg)
                    : departureAirport.latitude_deg || 0,
                lng:
                  typeof departureAirport.longitude_deg === 'string'
                    ? parseFloat(departureAirport.longitude_deg)
                    : departureAirport.longitude_deg || 0,
              },
            },
            arrivalAirport: {
              iata: historicalRoute.arrival_iata || null,
              icao: historicalRoute.arrival_icao || null,
              name: historicalRoute.arrival_name || null,
              inferred: true,
              historical: true,
            },
          };
        }

        logger.debug('No historical route found for callsign + departure', { icao24, callsign });
      }

      if (!callsign && icao24) {
        const historicalRouteByIcao = await postgresRepository.findHistoricalRouteByIcao24(
          icao24,
          departureAirport.ident || '',
        );

        if (historicalRouteByIcao) {
          logger.info('Found historical route for icao24', {
            icao24,
            departure: historicalRouteByIcao.departure_icao,
            arrival: historicalRouteByIcao.arrival_icao,
            source: historicalRouteByIcao.source,
          });

          return {
            departureAirport: {
              iata: departureAirport.iata_code || null,
              icao: departureAirport.ident || departureAirport.gps_code || null,
              name: departureAirport.name || null,
              inferred: true,
              location: {
                lat:
                  typeof departureAirport.latitude_deg === 'string'
                    ? parseFloat(departureAirport.latitude_deg)
                    : departureAirport.latitude_deg || 0,
                lng:
                  typeof departureAirport.longitude_deg === 'string'
                    ? parseFloat(departureAirport.longitude_deg)
                    : departureAirport.longitude_deg || 0,
              },
            },
            arrivalAirport: {
              iata: historicalRouteByIcao.arrival_iata || null,
              icao: historicalRouteByIcao.arrival_icao || null,
              name: historicalRouteByIcao.arrival_name || null,
              inferred: true,
              historical: true,
            },
          };
        }

        logger.debug('No historical route found for icao24 + departure', { icao24 });
      }

      if (lastPos.latitude && lastPos.longitude) {
        const isDescending = lastPos.vertical_rate && lastPos.vertical_rate < -2;
        const isLowAltitude = lastPos.baro_altitude && lastPos.baro_altitude < 1500;

        if (isDescending && isLowAltitude) {
          logger.info('Aircraft appears to be on final approach', {
            icao24,
            altitude: lastPos.baro_altitude,
            verticalRate: lastPos.vertical_rate,
            velocity: lastPos.velocity,
          });

          const nearbyAirports = await postgresRepository.findAirportsNearPoint(
            lastPos.latitude,
            lastPos.longitude,
            25,
            null,
          );

          arrivalAirport = this.selectBestAirport(nearbyAirports, 'arrival', icao24);

          if (arrivalAirport) {
            logger.info('Inferred arrival airport from final approach', {
              icao24,
              airport: arrivalAirport.ident,
              name: arrivalAirport.name,
              distance_km: arrivalAirport.distance_km,
            });

            return {
              departureAirport: {
                iata: departureAirport.iata_code || null,
                icao: departureAirport.ident || departureAirport.gps_code || null,
                name: departureAirport.name || null,
                inferred: true,
                location: {
                  lat:
                    typeof departureAirport.latitude_deg === 'string'
                      ? parseFloat(departureAirport.latitude_deg)
                      : departureAirport.latitude_deg || 0,
                  lng:
                    typeof departureAirport.longitude_deg === 'string'
                      ? parseFloat(departureAirport.longitude_deg)
                      : departureAirport.longitude_deg || 0,
                },
              },
              arrivalAirport: {
                iata: arrivalAirport.iata_code || null,
                icao: arrivalAirport.ident || arrivalAirport.gps_code || null,
                name: arrivalAirport.name || null,
                inferred: true,
                location: {
                  lat:
                    typeof arrivalAirport.latitude_deg === 'string'
                      ? parseFloat(arrivalAirport.latitude_deg)
                      : arrivalAirport.latitude_deg || 0,
                  lng:
                    typeof arrivalAirport.longitude_deg === 'string'
                      ? parseFloat(arrivalAirport.longitude_deg)
                      : arrivalAirport.longitude_deg || 0,
                },
              },
            };
          }
        }
      }

      logger.debug('Returning departure only - arrival cannot be inferred for in-flight aircraft', { icao24 });
      return {
        departureAirport: {
          iata: departureAirport.iata_code || null,
          icao: departureAirport.ident || departureAirport.gps_code || null,
          name: departureAirport.name || null,
          inferred: true,
          location: {
            lat:
              typeof departureAirport.latitude_deg === 'string'
                ? parseFloat(departureAirport.latitude_deg)
                : departureAirport.latitude_deg || 0,
            lng:
              typeof departureAirport.longitude_deg === 'string'
                ? parseFloat(departureAirport.longitude_deg)
                : departureAirport.longitude_deg || 0,
          },
        },
        arrivalAirport: {
          iata: null,
          icao: null,
          name: null,
          inferred: false,
          location: null,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Error inferring route from position', { icao24, error: err.message });
      return null;
    }
  }

  /**
   * Helper: Select best airport from candidates
   */
  selectBestAirport(airports: AirportCandidate[], positionType: string, icao24: string): AirportCandidate | null {
    if (!airports || airports.length === 0) {
      logger.debug(`No airports found near ${positionType} position`, { icao24 });
      return null;
    }

    const priorityTypes: Record<string, number> = {
      large_airport: 3,
      medium_airport: 2,
      small_airport: 1,
    };

    const cargoPrefixes = ['FDX', 'UPS'];
    const isCargo = (code: string | undefined) => !!code && cargoPrefixes.some((p) => (code || '').toUpperCase().startsWith(p));

    const scored = airports
      .filter((apt) => apt.type !== 'closed' && apt.type !== 'heliport')
      .map((apt) => {
        const typeScore = priorityTypes[apt.type || ''] || 0;
        const hasRunways = apt.runways && Array.isArray(apt.runways) && apt.runways.length > 0;
        let maxRunwayMeters = 0;
        if (hasRunways) {
          for (const rw of apt.runways) {
            const len = Number(rw.length_m) || Number(rw.length_ft ? rw.length_ft * 0.3048 : 0);
            if (len > maxRunwayMeters) maxRunwayMeters = len;
          }
        }
        const runwayLenScore = Math.min(maxRunwayMeters / 500, 10);
        const runwayCountScore = hasRunways ? Math.min(apt.runways!.length, 5) : 0;
        const distanceScore = 1 / ((apt.distance_km || 0) + 1);

        let penalties = 0;
        if (apt.type === 'small_airport') penalties += 2;
        if (maxRunwayMeters < 1500) penalties += 5;

        const score = typeScore * 100 + runwayLenScore * 10 + runwayCountScore * 2 + distanceScore - penalties;

        return { airport: apt, score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      logger.debug(`No suitable airports found near ${positionType} position after filtering`, { icao24 });
      return null;
    }

    const top = scored[0].airport;
    const callsign = (airports[0]?.callsign || '').toUpperCase();
    if (isCargo(callsign) && (top.type === 'small_airport' || !top.runways || top.runways.length === 0)) {
      const alt = scored.find(
        (s) => s.airport.type !== 'small_airport' && s.airport.runways && s.airport.runways.length > 0,
      );
      if (alt) return alt.airport;
    }
    return top;
  }

  /**
   * Batch fetch routes for multiple aircraft
   */
  async getBatchRoutes(
    aircraftList: Array<{ icao24: string; callsign?: string | null }>,
  ): Promise<Array<{ icao24: string; callsign?: string | null; route: Route | null }>> {
    const results = await Promise.allSettled(
      aircraftList.map(async (aircraft) => {
        const route = await this.getFlightRoute(aircraft.icao24, aircraft.callsign);
        return {
          icao24: aircraft.icao24,
          callsign: aircraft.callsign,
          route,
        };
      }),
    );

    return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  }
}

/**
 * Decides if an aircraft should be filtered as 'landed' based on lastContact/actualArrival.
 */
export function shouldFilterAsLanded(
  lastContact: number | null,
  lastArrival: number | null,
  bufferMs = 10 * 60 * 1000,
): boolean {
  if (!lastArrival) return false;
  return (lastContact || 0) <= lastArrival + bufferMs;
}

export default new FlightRouteService();
