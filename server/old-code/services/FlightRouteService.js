const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const postgresRepository = require('../repositories/PostgresRepository');
const openSkyService = require('./OpenSkyService');
const { mapAircraftType } = require('../utils/aircraftCategoryMapper');

/**
 * Service for fetching flight route information (departure/arrival airports)
 * Uses OpenSky Network API (FREE!) and FlightAware AeroAPI
 * Implements intelligent caching to minimize API calls
 */
class FlightRouteService {
  constructor() {
    this.flightAwareBaseUrl = config.external.flightAware?.baseUrl;
    this.flightAwareApiKey = config.external.flightAware?.apiKey;
    this.cache = new Map(); // In-memory cache for current session
    this.landedFlightsCache = new Map(); // Cache for landed flight status (callsign -> {hasLanded, timestamp})
  }

  /**
   * Check if a flight has landed based on FlightAware data
   * Returns true if the flight has landed (has actualArrival timestamp in the past)
   * Uses aggressive caching to minimize API calls
   */
  async hasFlightLanded(callsign) {
    if (!this.flightAwareApiKey || !callsign) return { hasLanded: false, lastArrival: null };

    // Check cache first (30-minute TTL)
    const cached = this.landedFlightsCache.get(callsign);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < 30 * 60 * 1000) { // 30 minutes
        logger.debug(`Landed flight cache HIT: ${callsign} = ${cached.hasLanded}`);
        return { hasLanded: cached.hasLanded, lastArrival: cached.lastArrival };
      }
      // Cache expired, remove it
      this.landedFlightsCache.delete(callsign);
    }

    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const startDate = yesterday.toISOString().split('T')[0];

      const response = await axios.get(`${this.flightAwareBaseUrl}/flights/${callsign}`, {
        params: {
          start: startDate, // Check last 24 hours
        },
        headers: {
          Accept: 'application/json; charset=UTF-8',
          'x-apikey': this.flightAwareApiKey,
        },
        timeout: 2000, // Reduced from 5s to 2s for faster failover
      });

      if (!response.data?.flights || response.data.flights.length === 0) {
        this.landedFlightsCache.set(callsign, {
          hasLanded: false,
          lastArrival: null,
          timestamp: Date.now(),
        });
        return { hasLanded: false, lastArrival: null };
      }

      let mostRecentLandedFlight = null;
      for (const flight of response.data.flights) {
        if (flight.actual_in) {
          mostRecentLandedFlight = flight;
          break;
        }
      }

      if (mostRecentLandedFlight) {
        const flight = mostRecentLandedFlight;
        const arrivalTime = new Date(flight.actual_in).getTime();
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
        // Cache the result
        this.landedFlightsCache.set(callsign, {
          hasLanded: hoursAgo > 0,
          lastArrival: arrivalTime,
          timestamp: Date.now(),
        });
        return { hasLanded: hoursAgo > 0, lastArrival: arrivalTime };
      }
      // No completed flights found
      logger.debug('No completed flights found for callsign', { callsign });
      this.landedFlightsCache.set(callsign, {
        hasLanded: false,
        lastArrival: null,
        timestamp: Date.now(),
      });
      return { hasLanded: false, lastArrival: null };
    } catch (error) {
      logger.debug('Could not check flight landing status', { callsign, error: error.message });
      return { hasLanded: false, lastArrival: null };
    }
  }

  /**
   * Get flight route information for an aircraft
   * Priority: Cache -> Check if current flight -> OpenSky (historical only) -> FlightAware (current flights) -> Position inference
   * @param {boolean} allowExpensiveApis - Whether to use FlightAware (only for user-initiated requests, default false)
   */
  async getFlightRoute(icao24, callsign, isCurrentFlight = false, allowExpensiveApis = false) {
    const cacheKey = `${callsign || icao24}`;

    // 1. Check in-memory cache (skip for user-initiated requests to get fresh aircraft data)
    if (!allowExpensiveApis && this.cache.has(cacheKey)) {
      logger.info('Route cache HIT (in-memory) - skipping API call', { cacheKey, icao24, callsign });
      const cachedRoute = this.cache.get(cacheKey);
      // Enrich with model/type if we have aircraft_type
      if (cachedRoute.aircraft?.type) {
        const aircraftInfo = mapAircraftType(cachedRoute.aircraft.type);
        cachedRoute.aircraft = {
          ...cachedRoute.aircraft,
          model: aircraftInfo.model,
          type: aircraftInfo.type,
          category: aircraftInfo.category,
        };
      }
      return cachedRoute;
    }

    // 2. Check database cache (skip for user-initiated requests to get fresh data)
    if (!allowExpensiveApis) {
      const cachedRoute = await postgresRepository.getCachedRoute(cacheKey);
      if (cachedRoute) {
        // Enrich with model/type if we have aircraft_type from cache
        if (cachedRoute.aircraft?.type) {
          const aircraftInfo = mapAircraftType(cachedRoute.aircraft.type);
          cachedRoute.aircraft = {
            ...cachedRoute.aircraft,
            model: aircraftInfo.model,
            type: aircraftInfo.type,
            category: aircraftInfo.category,
          };
        }

        logger.info('Route cache HIT (database) - skipping API call', {
          cacheKey,
          icao24,
          callsign,
          source: cachedRoute.source || 'unknown',
          hasAircraft: !!cachedRoute.aircraft,
          allowExpensiveApis,
        });
        this.cache.set(cacheKey, cachedRoute);
        return cachedRoute;
      }
    } else {
      logger.info('Skipping database cache for user-initiated request (allowExpensiveApis=true)', {
        cacheKey,
        icao24,
        callsign,
      });
    }

    logger.info('Route cache MISS - fetching from API', {
      cacheKey, icao24, callsign, isCurrentFlight,
    });

    // 2.5. If we don't have a callsign but have icao24, try to get it from flight_routes_history
    // This allows us to query FlightAware even when aircraft_states doesn't have the callsign
    // Prioritize most recent active flights to get the current callsign
    let finalCallsign = callsign;
    if (!finalCallsign && icao24 && allowExpensiveApis) {
      const callsignFromHistory = await postgresRepository.getDb().oneOrNone(
        `SELECT callsign 
         FROM flight_routes_history
         WHERE icao24 = $1
           AND callsign IS NOT NULL
           AND callsign != ''
         ORDER BY 
           -- Prioritize active flights (no end time)
           CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
           -- Most recent creation time first (this ensures we get the latest callsign)
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

    // 3. Try OpenSky ONLY for historical flights (not current flights)
    // OpenSky data is 24+ hours old, so it's not useful for current/in-flight aircraft
    // For current flights, skip straight to FlightAware (much faster, saves 4-8 seconds)
    if (!isCurrentFlight) {
      logger.info('Trying OpenSky for route data (historical flights only)', { icao24, callsign });
      try {
        const route = await this.fetchRouteFromOpenSky(icao24, isCurrentFlight);
        if (route) {
          logger.info('Found route from OpenSky (historical data)', {
            icao24,
            callsign,
            departure: route.departureAirport?.icao || route.departureAirport?.iata,
            arrival: route.arrivalAirport?.icao || route.arrivalAirport?.iata,
          });
          // Store in cache (fast lookup for most recent)
          await this.cacheRoute(cacheKey, {
            ...route,
            callsign,
            icao24,
            source: 'opensky',
          });

          // Also store in history (all routes preserved)
          await postgresRepository.storeRouteHistory({
            ...route,
            callsign,
            icao24,
            source: 'opensky',
          });

          // For historical flights, OpenSky data is perfect - return immediately
          return { ...route, source: 'opensky' };
        }
      } catch (error) {
        logger.debug('OpenSky flight route not available', {
          icao24,
          error: error.message,
        });
      }
    } else {
      logger.info('Skipping OpenSky for current flight (saves 4-8 seconds)', { icao24, callsign });
    }

    // 4. Try FlightAware (ONLY if allowExpensiveApis=true, for user-initiated requests)
    // FlightAware has excellent real-time flight tracking but is $$$
    // Use finalCallsign (which may have been retrieved from flight_routes_history)
    if (this.flightAwareApiKey && finalCallsign && allowExpensiveApis) {
      logger.info('Trying FlightAware AeroAPI for route (user-initiated request)', { icao24, callsign: finalCallsign });
      try {
        const routeResult = await this.fetchRouteFromFlightAware(finalCallsign);
        if (routeResult) {
          // Handle array of flights (historical data) or single flight
          const routes = Array.isArray(routeResult) ? routeResult : [routeResult];

          // Check if we have any valid routes
          if (routes.length === 0) {
            logger.info('FlightAware returned empty route array', { icao24, callsign });
            // Continue to try other sources
          } else {
            // Filter for active flights (in flight, en route, or scheduled but not yet departed)
            // Priority: En Route/In Flight > Scheduled > Arrived/Landed
            const activeRoutes = routes.filter((r) => {
              const status = r.flightStatus?.toLowerCase() || '';
              return (status.includes('en route')
                      || status.includes('in flight')
                      || status === 'scheduled'
                      || status === 'departed')
                     && !r.cancelled
                     && !r.diverted
                     && !r.flightData?.actualArrival; // Not yet arrived
            });

            // If we have active routes, prefer ones that are actually in flight
            const inFlightRoutes = activeRoutes.filter((r) => {
              const status = r.flightStatus?.toLowerCase() || '';
              return status.includes('en route') || status.includes('in flight');
            });

            // Use in-flight route if available, otherwise active route, otherwise most recent
            const mostRecentRoute = inFlightRoutes.length > 0
              ? inFlightRoutes[0]
              : (activeRoutes.length > 0 ? activeRoutes[0] : routes[0]);

            logger.info('Successfully fetched route from FlightAware', {
              icao24,
              callsign: finalCallsign,
              numFlights: routes.length,
              activeFlights: activeRoutes.length,
              departure: mostRecentRoute.departureAirport?.icao || mostRecentRoute.departureAirport?.iata,
              arrival: mostRecentRoute.arrivalAirport?.icao || mostRecentRoute.arrivalAirport?.iata,
              flightStatus: mostRecentRoute.flightStatus,
            });

            // Enrich with model/type if we have aircraft_type
            const enrichedRoute = { ...mostRecentRoute };
            if (mostRecentRoute.aircraft?.type) {
              // Map aircraft type - handle "Plane" as a generic type that needs model lookup
              const aircraftType = mostRecentRoute.aircraft.type;
              let aircraftInfo;

              // If type is "Plane" but we have a model, try to map from model
              if (aircraftType === 'Plane' && mostRecentRoute.aircraft.model) {
                // Try mapping from model instead
                aircraftInfo = mapAircraftType(mostRecentRoute.aircraft.model);
                // If model mapping didn't work, use the model directly
                if (!aircraftInfo.model) {
                  aircraftInfo = {
                    model: mostRecentRoute.aircraft.model,
                    type: aircraftType,
                    category: null,
                  };
                }
              } else {
                aircraftInfo = mapAircraftType(aircraftType);
              }

              enrichedRoute.aircraft = {
                ...mostRecentRoute.aircraft,
                model: aircraftInfo.model || mostRecentRoute.aircraft.model,
                type: aircraftInfo.type || aircraftType,
                category: aircraftInfo.category,
              };
            }

            // Store most recent in cache (fast lookup)
            await this.cacheRoute(cacheKey, {
              ...enrichedRoute,
              callsign: finalCallsign,
              icao24,
              source: 'flightaware',
            });

            // Store ALL flights in history (for historical tracking)
            for (const route of routes) {
              try {
                // Store all flights that have valid origin/destination (already filtered in mapFlight)
                await postgresRepository.storeRouteHistory({
                  ...route,
                  callsign,
                  icao24,
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
                // Ignore duplicate key errors (same flight already stored)
                if (!storeErr.message?.includes('duplicate key') && !storeErr.message?.includes('uniq_flight_routes_history_flight_key')) {
                  logger.warn('Failed to store FlightAware flight in history', {
                    callsign,
                    icao24,
                    error: storeErr.message,
                  });
                }
              }
            }

            return {
              ...enrichedRoute, callsign: finalCallsign, icao24, source: 'flightaware',
            };
          }
        }

        // If FlightAware returned no data by callsign, try querying by icao24/registration
        logger.info('FlightAware returned no route data by callsign, trying by icao24', {
          icao24,
          callsign: finalCallsign,
        });

        // Try FlightAware search endpoint with icao24/registration
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
            const flights = searchResponse.data.results;
            // Filter for active flights and map to route format
            const activeFlights = flights.filter((f) => {
              const status = f.status?.toLowerCase() || '';
              return (status.includes('en route') || status.includes('in flight')
                || status === 'scheduled' || status === 'departed')
                && !f.cancelled && !f.diverted
                && f.origin && f.destination;
            });

            if (activeFlights.length > 0) {
              const flight = activeFlights[0];
              const mappedRoute = {
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
                aircraft: flight.aircraft_type ? {
                  type: flight.aircraft_type || null,
                  model: flight.aircraft_type || null,
                } : undefined,
                flightStatus: flight.status || null,
              };

              logger.info('Found route from FlightAware by icao24', {
                icao24,
                callsign: flight.ident || finalCallsign,
                departure: mappedRoute.departureAirport?.icao,
                arrival: mappedRoute.arrivalAirport?.icao,
              });

              const foundCallsign = flight.ident || finalCallsign;

              // Cache and return
              await this.cacheRoute(cacheKey, {
                ...mappedRoute,
                callsign: foundCallsign,
                icao24,
                source: 'flightaware',
              });

              return {
                ...mappedRoute,
                callsign: foundCallsign,
                icao24,
                source: 'flightaware',
              };
            }
          }
        } catch (searchError) {
          logger.debug('FlightAware search by icao24 also failed', {
            icao24,
            error: searchError.message,
          });
        }

        logger.info('FlightAware returned no route data', { icao24, callsign: finalCallsign });
        // Continue to inference if FlightAware doesn't have the flight
      } catch (error) {
        const statusCode = error.response?.status;
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
            error: error.message,
            status: statusCode,
            statusText: error.response?.statusText,
          });
        }
        // Continue to inference even if FlightAware fails
      }
    } else if (!allowExpensiveApis) {
      logger.info('Skipping FlightAware (background job) - using inference', { icao24, callsign });
    }

    // 5. Check flight_routes_history for existing route data (callsign, departure, arrival)
    // This is often more reliable than inference since it comes from actual flight data
    // Priority: Active flights (no end time) > Recent flights > By creation time
    if (icao24) {
      const existingRoute = await postgresRepository.getDb().oneOrNone(
        `SELECT callsign, departure_icao, departure_iata, departure_name,
                arrival_icao, arrival_iata, arrival_name, source,
                actual_flight_start, actual_flight_end, created_at
         FROM flight_routes_history
         WHERE icao24 = $1
           AND departure_icao IS NOT NULL
           AND arrival_icao IS NOT NULL
         ORDER BY 
           -- Prioritize active flights (no end time) over completed ones
           CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
           -- Among active flights, prefer ones with recent start times
           CASE WHEN actual_flight_start IS NOT NULL 
                AND actual_flight_start > NOW() - INTERVAL '24 hours' 
                THEN 0 ELSE 1 END ASC,
           -- Then by most recent start time
           actual_flight_start DESC NULLS LAST,
           -- Finally by creation time (most recent first)
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

        // Get airport details for departure
        const depAirport = existingRoute.departure_icao
          ? await postgresRepository.findAirportByCode(existingRoute.departure_icao)
          : null;

        // Get airport details for arrival
        const arrAirport = existingRoute.arrival_icao
          ? await postgresRepository.findAirportByCode(existingRoute.arrival_icao)
          : null;

        const routeData = {
          departureAirport: {
            iata: existingRoute.departure_iata || (depAirport?.iata_code) || null,
            icao: existingRoute.departure_icao || null,
            name: existingRoute.departure_name || (depAirport?.name) || null,
            location: depAirport ? {
              lat: parseFloat(depAirport.latitude_deg),
              lng: parseFloat(depAirport.longitude_deg),
            } : null,
          },
          arrivalAirport: {
            iata: existingRoute.arrival_iata || (arrAirport?.iata_code) || null,
            icao: existingRoute.arrival_icao || null,
            name: existingRoute.arrival_name || (arrAirport?.name) || null,
            location: arrAirport ? {
              lat: parseFloat(arrAirport.latitude_deg),
              lng: parseFloat(arrAirport.longitude_deg),
            } : null,
          },
          source: existingRoute.source || 'flight_routes_history',
        };

        // Use callsign from history if we don't have one
        const finalCallsign = callsign || existingRoute.callsign;

        // Cache the route
        await this.cacheRoute(cacheKey, {
          ...routeData,
          callsign: finalCallsign,
          icao24,
        });

        return { ...routeData, callsign: finalCallsign, icao24 };
      }
    }

    // 6. Last resort: Position-based inference
    const inferredRoute = await this.inferRouteFromPosition(icao24);
    if (inferredRoute) {
      // Cache inferred routes, but with shorter TTL if arrival is missing
      const hasArrival = inferredRoute.arrivalAirport?.icao || inferredRoute.arrivalAirport?.iata;

      logger.info('Caching inferred route', {
        icao24,
        callsign,
        hasDeparture: !!(inferredRoute.departureAirport?.icao || inferredRoute.departureAirport?.iata),
        hasArrival,
        cacheTTL: hasArrival ? '24h' : '30min',
      });

      // Store in cache (will expire based on created_at in database)
      await this.cacheRoute(cacheKey, {
        ...inferredRoute,
        callsign,
        icao24,
        source: 'inference',
        incompleteRoute: !hasArrival, // Flag for shorter cache TTL
      });

      // Also store in history (permanent record)
      await postgresRepository.storeRouteHistory({
        ...inferredRoute,
        callsign,
        icao24,
        source: 'inference',
      });

      return { ...inferredRoute, source: 'inference' };
    }
    return null;
  }

  /**
   * Fetch route from OpenSky Network (FREE!)
   * Note: Only works for flights from previous day or earlier
   */
  async fetchRouteFromOpenSky(icao24, isCurrentFlight = false) {
    try {
      // OpenSky one way has data from previous day or earlier
      // Try multiple time ranges to find flights
      const now = Math.floor(Date.now() / 1000);
      const oneDay = 24 * 60 * 60;

      // Reduced from 4 to 2 time ranges to minimize OpenSky API calls
      // This helps preserve OpenSky quota for real-time aircraft tracking
      const timeRanges = [];
      for (let i = 1; i <= 2; i++) {
        timeRanges.push({
          begin: now - ((i + 1) * oneDay),
          end: now - (i * oneDay),
        });
      }

      logger.info('Querying OpenSky for flights', {
        icao24,
        timeRanges: timeRanges.map((r) => ({
          begin: new Date(r.begin * 1000).toISOString(),
          end: new Date(r.end * 1000).toISOString(),
        })),
      });

      // Collect ALL flights from ALL time ranges (not just the first match)
      const allFlights = [];

      for (const range of timeRanges) {
        const flights = await openSkyService.getFlightsByAircraft(icao24, range.begin, range.end);
        if (flights && flights.length > 0) {
          allFlights.push(...flights);
        }
      }

      if (allFlights.length > 0) {
        // Remove duplicates (same icao24, callsign, firstSeen, lastSeen = same flight)
        const seen = new Set();
        const uniqueFlights = allFlights.filter((flight) => {
          const key = `${flight.callsign?.trim() || ''}-${flight.firstSeen}-${flight.lastSeen}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Get most recent flight for cache
        // Sort by lastSeen descending (most recent first)
        const sortedFlights = uniqueFlights.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        const mostRecentFlight = sortedFlights[0];

        // Infer departure airport from previous flight's arrival if missing/unreliable
        let inferredDeparture = null;
        if (sortedFlights.length > 1) {
          // Check if most recent flight has missing or unreliable departure
          // estDepartureAirport can be null or empty string - both should trigger inference
          const candidates = (mostRecentFlight.departureAirportCandidatesCount || 0);
          const departureAirport = mostRecentFlight.estDepartureAirport;
          const hasReliableDeparture = candidates > 0
            && departureAirport
            && String(departureAirport).trim() !== '';

          logger.info('Checking if departure inference needed', {
            icao24,
            hasReliableDeparture,
            candidates,
            departureAirport,
            sortedFlightsCount: sortedFlights.length,
            mostRecentFlight: mostRecentFlight.callsign?.trim(),
          });

          if (!hasReliableDeparture) {
            // Look for the previous flight (next in sorted array) that has an arrival airport
            // Check flights in chronological order (most recent first, so i=1 is the previous flight)
            for (let i = 1; i < sortedFlights.length; i++) {
              const previousFlight = sortedFlights[i];
              // Use previous flight's arrival if it exists
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
                break; // Use the first (most recent) previous flight's arrival
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

        // Store ALL unique flights in history table (for historical tracking)
        // Don't await - let it run in background to avoid blocking response
        Promise.allSettled(
          uniqueFlights.map((flight) => {
            // OpenSky data quality indicators
            // If departureAirportCandidatesCount is 0, OpenSky's departure estimate may be unreliable
            const hasDepartureCandidates = (flight.departureAirportCandidatesCount || 0) > 0;
            const hasArrivalCandidates = (flight.arrivalAirportCandidatesCount || 0) > 0;
            const hasDepartureData = !!flight.estDepartureAirport;
            const hasArrivalData = !!flight.estArrivalAirport;

            // Log warnings for potentially unreliable data
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

            // If departure has 0 candidates, consider it unreliable
            // Try to infer from previous flight in the sorted array
            let reliableDeparture = hasDepartureCandidates ? flight.estDepartureAirport : null;

            // If no reliable departure, check if we can infer from previous flight
            if (!reliableDeparture && flight !== mostRecentFlight) {
              // Find this flight's position and check previous flight's arrival
              const currentIndex = sortedFlights.findIndex((f) => f.firstSeen === flight.firstSeen && f.lastSeen === flight.lastSeen);
              if (currentIndex > 0) {
                const previousFlight = sortedFlights[currentIndex - 1];
                if (previousFlight.estArrivalAirport
                    && ((previousFlight.arrivalAirportCandidatesCount || 0) > 0 || previousFlight.estArrivalAirport)) {
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
                firstSeen: flight.firstSeen,
                lastSeen: flight.lastSeen,
                duration: flight.lastSeen ? flight.lastSeen - flight.firstSeen : null,
              },
            });
          }),
        ).then((results) => {
          const succeeded = results.filter((r) => r.status === 'fulfilled').length;
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (succeeded > 0) {
            logger.info('Stored routes in history', {
              icao24,
              stored: succeeded,
              failed,
            });
          }
        }).catch((error) => {
          logger.warn('Error storing routes in history (non-critical)', { error: error.message });
        });

        // OpenSky historical data is valid even for current flights
        // The route (departure/arrival) typically doesn't change during flight
        // Use this data even if the flight is current - it's better than nothing
        // Only skip if the data is too old (more than 7 days - unlikely to be same route)
        const now = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60);
        const flightIsTooOld = mostRecentFlight.lastSeen < sevenDaysAgo;

        if (flightIsTooOld) {
          logger.info('OpenSky flight data is too old (more than 7 days), skipping', {
            icao24,
            openSkyLastSeen: mostRecentFlight.lastSeen,
            openSkyLastSeenDate: new Date(mostRecentFlight.lastSeen * 1000).toISOString(),
          });
          return null;
        }

        // Use OpenSky data even for current flights - historical routes are often still valid
        logger.info('Using OpenSky historical route data (valid for current flights)', {
          icao24,
          openSkyLastSeen: mostRecentFlight.lastSeen,
          openSkyLastSeenDate: new Date(mostRecentFlight.lastSeen * 1000).toISOString(),
          isCurrentFlight,
        });

        // Return most recent flight for immediate use
        // Only use departure if OpenSky has candidates (reliable data)
        // Otherwise, try to infer from previous flight's arrival
        const hasDepartureCandidates = (mostRecentFlight.departureAirportCandidatesCount || 0) > 0;
        const reliableDeparture = hasDepartureCandidates
          ? mostRecentFlight.estDepartureAirport
          : (inferredDeparture || null); // Use inferred departure if available

        return {
          departureAirport: {
            iata: null, // OpenSky provides ICAO codes, can convert later if needed
            icao: reliableDeparture,
            name: reliableDeparture,
          },
          arrivalAirport: {
            iata: null,
            icao: mostRecentFlight.estArrivalAirport || null,
            name: mostRecentFlight.estArrivalAirport || null,
          },
          flightData: {
            firstSeen: mostRecentFlight.firstSeen,
            lastSeen: mostRecentFlight.lastSeen,
            duration: mostRecentFlight.lastSeen ? mostRecentFlight.lastSeen - mostRecentFlight.firstSeen : null,
          },
        };
      }

      logger.debug('No OpenSky flights found for aircraft after checking all time ranges', { icao24 });
      return null;
    } catch (error) {
      logger.debug('Error fetching route from OpenSky', { icao24, error: error.message });
      // Return null to allow fallback to other sources
      return null;
    }
  }

  /**
   * Cache route data
   */
  async cacheRoute(cacheKey, routeData) {
    logger.info('FlightRouteService.cacheRoute called', {
      cacheKey,
      source: routeData.source,
      hasCallsign: !!routeData.callsign,
    });
    try {
      await postgresRepository.cacheRoute(cacheKey, routeData);
      this.cache.set(cacheKey, routeData);
      logger.info('FlightRouteService.cacheRoute completed', { cacheKey, source: routeData.source });
    } catch (error) {
      logger.error('FlightRouteService.cacheRoute failed', { cacheKey, error: error.message });
      throw error;
    }
  }

  /**
   * Fetch route from FlightAware AeroAPI
   * Provides real-time flight tracking with excellent coverage
   */
  async fetchRouteFromFlightAware(callsign, dateString = null) {
    try {
      // If dateString provided, use it; otherwise don't specify start to get all recent flights
      const params = {};
      if (dateString) {
        params.start = dateString;
      }
      // Don't specify start if we want all available flights (more efficient)

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

      // Return ALL flights from the response (for historical data)
      // The caller can process multiple flights if needed
      const { flights } = response.data;

      // For single-flight response, return the mapped flight
      // For multiple flights, return array of mapped flights
      const mapFlight = (flight) => {
        if (!flight.origin || !flight.destination) {
          return null;
        }

        const mapped = {
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
            // Use scheduled_off/actual_off for departure (runway times)
            // scheduled_out/actual_out are gate times which may be null for GA flights
            scheduledDeparture: flight.scheduled_off ? new Date(flight.scheduled_off).getTime() / 1000
              : (flight.scheduled_out ? new Date(flight.scheduled_out).getTime() / 1000 : null),
            scheduledArrival: flight.scheduled_on ? new Date(flight.scheduled_on).getTime() / 1000
              : (flight.scheduled_in ? new Date(flight.scheduled_in).getTime() / 1000 : null),
            actualDeparture: flight.actual_off ? new Date(flight.actual_off).getTime() / 1000
              : (flight.actual_out ? new Date(flight.actual_out).getTime() / 1000 : null),
            actualArrival: flight.actual_on ? new Date(flight.actual_on).getTime() / 1000
              : (flight.actual_in ? new Date(flight.actual_in).getTime() / 1000 : null),
            filedEte: flight.filed_ete || null,
          },
          aircraft: flight.aircraft_type ? {
            type: flight.aircraft_type || null,
            model: flight.aircraft_type || null, // FlightAware's aircraft_type IS the model (e.g., "B738", "A321")
          } : undefined,
          // Additional FlightAware fields
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

      // Map all flights and filter out nulls
      const mappedFlights = flights.map(mapFlight).filter((f) => f !== null);

      // If no valid flights after mapping, return null
      if (mappedFlights.length === 0) {
        logger.debug('FlightAware returned no valid flights after mapping', { callsign });
        return null;
      }

      // If single flight requested, return single object
      // Otherwise return array for backfill operations
      if (mappedFlights.length === 1) {
        return mappedFlights[0];
      }

      // Return array of all flights for historical processing
      return mappedFlights;
    } catch (error) {
      const statusCode = error.response?.status;
      if (statusCode === 429) {
        logger.warn('FlightAware rate limit (429)', { callsign });
        throw error; // Re-throw to trigger fallback
      }
      if (statusCode === 404) {
        logger.debug('Flight not found in FlightAware', { callsign });
        return null; // Not an error, just no data
      }
      logger.error('Error fetching route from FlightAware API', {
        callsign,
        error: error.message,
        status: statusCode,
        statusText: error.response?.statusText,
      });
      throw error;
    }
  }

  /**
   * Fallback: Infer route from flight position history and historical flight patterns
   * Strategy:
   * 1. Find departure airport from first position
   * 2. Check flight_routes_cache/history for previous flights with same callsign + departure
   * 3. Use historical arrival airport if found
   * 4. Otherwise, only infer arrival if aircraft is clearly landing (descending + near airport)
   */
  async inferRouteFromPosition(icao24) {
    try {
      const history = await postgresRepository.findAircraftHistory(icao24);

      if (history.length < 2) {
        logger.debug('Not enough position history to infer route', { icao24, historyLength: history.length });
        return null;
      }

      // Get first and last positions, plus callsign
      const firstPos = history[0];
      const lastPos = history[history.length - 1];
      const callsign = firstPos.callsign ? firstPos.callsign.trim() : null;

      if (!firstPos.latitude || !firstPos.longitude) {
        logger.debug('Missing lat/lng in first position', { icao24 });
        return null;
      }

      logger.info('Inferring route from position history and flight patterns', {
        icao24,
        callsign,
        firstPos: { lat: firstPos.latitude, lng: firstPos.longitude },
        lastPos: lastPos.latitude && lastPos.longitude
          ? { lat: lastPos.latitude, lng: lastPos.longitude }
          : 'invalid',
        historyPoints: history.length,
      });

      // STEP 1: Find departure airport from first position
      const departureAirports = await postgresRepository.findAirportsNearPoint(
        firstPos.latitude,
        firstPos.longitude,
        50, // 50km radius for departure
        null,
      );

      const departureAirport = this.selectBestAirport(departureAirports, 'departure', icao24);

      if (!departureAirport) {
        logger.debug('Could not identify departure airport', { icao24 });
        return null;
      }

      logger.info('Identified departure airport', {
        icao24,
        callsign,
        airport: departureAirport.ident,
        name: departureAirport.name,
        distance_km: departureAirport.distance_km,
      });

      // STEP 2: Look up historical routes for this callsign + departure airport
      // Also try by icao24 if callsign is missing
      let arrivalAirport = null;

      if (callsign) {
        const historicalRoute = await postgresRepository.findHistoricalRoute(
          callsign,
          departureAirport.ident,
        );

        if (historicalRoute) {
          logger.info('Found historical route for callsign', {
            icao24,
            callsign,
            departure: historicalRoute.departure_icao,
            arrival: historicalRoute.arrival_icao,
            source: historicalRoute.source,
          });

          // Use historical arrival airport
          return {
            departureAirport: {
              iata: departureAirport.iata_code || null,
              icao: departureAirport.ident || departureAirport.gps_code || null,
              name: departureAirport.name || null,
              inferred: true,
              location: {
                lat: departureAirport.latitude_deg,
                lng: departureAirport.longitude_deg,
              },
            },
            arrivalAirport: {
              iata: historicalRoute.arrival_iata || null,
              icao: historicalRoute.arrival_icao || null,
              name: historicalRoute.arrival_name || null,
              inferred: true,
              historical: true, // Flag to indicate this came from historical data
            },
          };
        }

        logger.debug('No historical route found for callsign + departure', { icao24, callsign });
      }

      // STEP 2b: If no callsign, try to find historical route by icao24 + departure
      if (!callsign && icao24) {
        const historicalRouteByIcao = await postgresRepository.findHistoricalRouteByIcao24(
          icao24,
          departureAirport.ident,
        );

        if (historicalRouteByIcao) {
          logger.info('Found historical route for icao24', {
            icao24,
            departure: historicalRouteByIcao.departure_icao,
            arrival: historicalRouteByIcao.arrival_icao,
            source: historicalRouteByIcao.source,
          });

          // Use historical arrival airport
          return {
            departureAirport: {
              iata: departureAirport.iata_code || null,
              icao: departureAirport.ident || departureAirport.gps_code || null,
              name: departureAirport.name || null,
              inferred: true,
              location: {
                lat: departureAirport.latitude_deg,
                lng: departureAirport.longitude_deg,
              },
            },
            arrivalAirport: {
              iata: historicalRouteByIcao.arrival_iata || null,
              icao: historicalRouteByIcao.arrival_icao || null,
              name: historicalRouteByIcao.arrival_name || null,
              inferred: true,
              historical: true, // Flag to indicate this came from historical data
            },
          };
        }

        logger.debug('No historical route found for icao24 + departure', { icao24 });
      }

      // STEP 3: Check if aircraft is on final approach (descending near an airport)
      if (lastPos.latitude && lastPos.longitude) {
        const isDescending = lastPos.vertical_rate && lastPos.vertical_rate < -2; // Descending
        const isLowAltitude = lastPos.baro_altitude && lastPos.baro_altitude < 1500; // Below 1500m (~5000ft)
        const hasLowVelocity = lastPos.velocity && lastPos.velocity < 100; // Slowing down

        if (isDescending && isLowAltitude) {
          logger.info('Aircraft appears to be on final approach', {
            icao24,
            altitude: lastPos.baro_altitude,
            verticalRate: lastPos.vertical_rate,
            velocity: lastPos.velocity,
          });

          // Find nearby airports
          const nearbyAirports = await postgresRepository.findAirportsNearPoint(
            lastPos.latitude,
            lastPos.longitude,
            25, // 25km radius for landing
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
                  lat: departureAirport.latitude_deg,
                  lng: departureAirport.longitude_deg,
                },
              },
              arrivalAirport: {
                iata: arrivalAirport.iata_code || null,
                icao: arrivalAirport.ident || arrivalAirport.gps_code || null,
                name: arrivalAirport.name || null,
                inferred: true,
                location: {
                  lat: arrivalAirport.latitude_deg,
                  lng: arrivalAirport.longitude_deg,
                },
              },
            };
          }
        }
      }

      // STEP 4: Return with departure only (arrival unknown for in-flight aircraft)
      logger.info('Returning departure only - arrival cannot be inferred for in-flight aircraft', { icao24 });
      return {
        departureAirport: {
          iata: departureAirport.iata_code || null,
          icao: departureAirport.ident || departureAirport.gps_code || null,
          name: departureAirport.name || null,
          inferred: true,
          location: {
            lat: departureAirport.latitude_deg,
            lng: departureAirport.longitude_deg,
          },
        },
        arrivalAirport: {
          iata: null,
          icao: null,
          name: null,
          inferred: false, // Not inferred - genuinely unknown
          location: null,
        },
      };
    } catch (error) {
      logger.error('Error inferring route from position', { icao24, error: error.message });
      return null;
    }
  }

  /**
   * Helper: Select best airport from candidates
   */
  selectBestAirport(airports, positionType, icao24) {
    if (!airports || airports.length === 0) {
      logger.debug(`No airports found near ${positionType} position`, { icao24 });
      return null;
    }

    // Filter out closed airports and heliports, prioritize by:
    // 1. Type (large_airport > medium_airport > small_airport)
    // 2. Runway length (jets need >= 1800m, cargo prefer >= 2500m)
    // 3. Has runways (from JSONB field)
    // 4. Distance (closer is better)
    const priorityTypes = {
      large_airport: 3,
      medium_airport: 2,
      small_airport: 1,
    };

    const cargoPrefixes = ['FDX', 'UPS'];
    const isCargo = (code) => !!code && cargoPrefixes.some((p) => (code || '').toUpperCase().startsWith(p));

    const scored = airports
      .filter((apt) => apt.type !== 'closed' && apt.type !== 'heliport')
      .map((apt) => {
        const typeScore = priorityTypes[apt.type] || 0;
        const hasRunways = apt.runways && Array.isArray(apt.runways) && apt.runways.length > 0;
        let maxRunwayMeters = 0;
        if (hasRunways) {
          for (const rw of apt.runways) {
            const len = Number(rw.length_m) || Number(rw.length_ft ? rw.length_ft * 0.3048 : 0);
            if (len > maxRunwayMeters) maxRunwayMeters = len;
          }
        }
        const runwayLenScore = Math.min(maxRunwayMeters / 500, 10); // up to +10 points for very long runways
        const runwayCountScore = hasRunways ? Math.min(apt.runways.length, 5) : 0; // up to +5
        const distanceScore = 1 / (apt.distance_km + 1); // closer = higher

        // Penalize very small strips for jets/cargo
        let penalties = 0;
        if (apt.type === 'small_airport') penalties += 2;
        if (maxRunwayMeters < 1500) penalties += 5; // unsuitable for most jets

        const score = (typeScore * 100)
          + (runwayLenScore * 10)
          + (runwayCountScore * 2)
          + distanceScore
          - penalties;

        return { airport: apt, score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      logger.debug(`No suitable airports found near ${positionType} position after filtering`, { icao24 });
      return null;
    }

    // Extra guard: for known cargo carriers, avoid small/private fields if a better option exists
    const top = scored[0].airport;
    const callsign = (airports[0]?.callsign || '').toUpperCase(); // not always present
    if (isCargo(callsign) && (top.type === 'small_airport' || !top.runways || top.runways.length === 0)) {
      const alt = scored.find((s) => s.airport.type !== 'small_airport' && s.airport.runways && s.airport.runways.length > 0);
      if (alt) return alt.airport;
    }
    return top;
  }

  /**
   * Batch fetch routes for multiple aircraft
   */
  async getBatchRoutes(aircraftList) {
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

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
  }
}

/**
 * Decides if an aircraft should be filtered as 'landed' based on lastContact/actualArrival.
 * lastContact: ms since epoch
 * lastArrival: ms since epoch or null
 * bufferMs: window after landing to hide the plane (default 10 min)
 */
function shouldFilterAsLanded(lastContact, lastArrival, bufferMs = 10 * 60 * 1000) {
  if (!lastArrival) return false;
  return lastContact <= lastArrival + bufferMs;
}

module.exports.shouldFilterAsLanded = shouldFilterAsLanded;

module.exports = new FlightRouteService();
