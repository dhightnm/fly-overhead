const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const postgresRepository = require('../repositories/PostgresRepository');
const openSkyService = require('./OpenSkyService');

/**
 * Service for fetching flight route information (departure/arrival airports)
 * Uses OpenSky Network API (FREE!) as primary source, falls back to Aviation Edge if needed
 * Implements intelligent caching to minimize API calls
 */
class FlightRouteService {
  constructor() {
    this.baseUrl = config.external.aviationEdge?.baseUrl;
    this.apiKey = config.external.aviationEdge?.apiKey;
    this.flightAwareBaseUrl = config.external.flightAware?.baseUrl;
    this.flightAwareApiKey = config.external.flightAware?.apiKey;
    this.cache = new Map(); // In-memory cache for current session
  }

  /**
   * Get flight route information for an aircraft
   * Priority: Cache -> Check if current flight -> OpenSky (historical only) -> Aviation Edge (current flights) -> Position inference
   */
  async getFlightRoute(icao24, callsign, isCurrentFlight = false) {
    // 1. Check in-memory cache
    const cacheKey = `${callsign || icao24}`;
    if (this.cache.has(cacheKey)) {
      logger.info('Route cache HIT (in-memory) - skipping API call', { cacheKey, icao24, callsign });
      return this.cache.get(cacheKey);
    }

    // 2. Check database cache
    const cachedRoute = await postgresRepository.getCachedRoute(cacheKey);
    if (cachedRoute) {
      logger.info('Route cache HIT (database) - skipping API call', { 
        cacheKey, 
        icao24, 
        callsign,
        source: cachedRoute.source || 'unknown',
      });
      this.cache.set(cacheKey, cachedRoute);
      return cachedRoute; // Already has source from database
    }
    
    logger.info('Route cache MISS - fetching from API', { cacheKey, icao24, callsign, isCurrentFlight });

    // 3. Try OpenSky FIRST (even for current flights) - better data coverage
    // OpenSky provides historical routes (last 24-48 hours) which are often still valid for flights in progress
    // AviationStack has limited coverage - many flights aren't in their database
    // Strategy: Use OpenSky historical data as fallback when AviationStack doesn't have the flight
    logger.info('Trying OpenSky for route data (historical, but may still be valid)', { icao24, callsign, isCurrentFlight });
    
    let openSkyRoute = null; // Store OpenSky route to use if AviationStack fails
    
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
        if (!isCurrentFlight) {
          return { ...route, source: 'opensky' };
        }
        
        // For current flights, store OpenSky route as fallback
        // Continue to try AviationStack for more real-time data
        openSkyRoute = { ...route, source: 'opensky' };
        logger.info('OpenSky route found, will try AviationStack for more current data', { icao24, callsign });
      }
    } catch (error) {
      logger.debug('OpenSky flight route not available', { 
        icao24, 
        error: error.message,
      });
    }

    // 4. Try FlightAware (for current flights) - better coverage than AviationStack
    // FlightAware has excellent real-time flight tracking
    if (this.flightAwareApiKey && callsign) {
      logger.info('Trying FlightAware AeroAPI for route (real-time data)', { icao24, callsign });
      try {
        const route = await this.fetchRouteFromFlightAware(callsign);
        if (route) {
          logger.info('Successfully fetched route from FlightAware', { 
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
            source: 'flightaware',
          });
          
          // Also store in history if we have flight timestamps
          if (route.flightData) {
            await postgresRepository.storeRouteHistory({
              ...route,
              callsign,
              icao24,
              source: 'flightaware',
            });
          }
          
          return { ...route, source: 'flightaware' };
        } else {
          logger.info('FlightAware returned no route data', { icao24, callsign });
          // Continue to try AviationStack if FlightAware doesn't have the flight
        }
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
        // Continue to try AviationStack even if FlightAware fails
      }
    }

    // 5. Try AviationStack (for current flights) - limited coverage but more real-time
    // Note: AviationStack has limited data coverage, may not have all active flights
    if (this.apiKey) {
      logger.info('Trying AviationStack API for route (limited coverage)', { icao24, callsign });
      try {
        const route = await this.fetchRouteFromAPI(icao24, callsign);
        if (route) {
          logger.info('Successfully fetched route from AviationStack', { 
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
            source: 'aviationstack',
          });
          
          // Also store in history if we have flight timestamps
          if (route.flightData) {
            await postgresRepository.storeRouteHistory({
              ...route,
              callsign,
              icao24,
              source: 'aviationstack',
            });
          }
          
          return { ...route, source: 'aviationstack' };
        } else {
          logger.info('AviationStack returned no route data (limited coverage - flight not in their database)', { icao24, callsign });
          // AviationStack has limited coverage - many flights aren't in their system
          // If we have OpenSky data, use that instead
          if (openSkyRoute) {
            logger.info('Using OpenSky historical route data since AviationStack has no data for this flight', { icao24, callsign });
            return openSkyRoute;
          }
        }
      } catch (error) {
        const statusCode = error.response?.status;
        const isRateLimited = statusCode === 429;
        
        if (isRateLimited) {
          logger.warn('AviationStack rate limit reached (429) - falling back to OpenSky', { 
            icao24,
            callsign,
            status: statusCode,
          });
        } else {
          logger.warn('Error fetching route from AviationStack API', { 
            icao24,
            callsign,
            error: error.message,
            status: statusCode,
            statusText: error.response?.statusText,
          });
        }
        
        // If error (including rate limit) and we have OpenSky data, use that
        if (openSkyRoute) {
          logger.info('Using OpenSky route data after AviationStack error/rate limit', { 
            icao24, 
            callsign,
            reason: isRateLimited ? 'rate_limit' : 'error',
          });
          return openSkyRoute;
        }
      }
    } else {
      logger.debug('AviationStack API key not configured, skipping', { icao24, callsign });
      // If no API key and we have OpenSky data, use that
      if (openSkyRoute) {
        logger.info('Using OpenSky route data (AviationStack not configured)', { icao24, callsign });
        return openSkyRoute;
      }
    }

    // 6. If we found OpenSky data earlier, return it now (better than nothing)
    if (openSkyRoute) {
      logger.info('Falling back to OpenSky historical route data', { icao24, callsign });
      return openSkyRoute; // Already has source: 'opensky'
    }

    // 7. Last resort: Position-based inference
    const inferredRoute = await this.inferRouteFromPosition(icao24);
    if (inferredRoute) {
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
      const twoDays = 2 * oneDay;
      
      // Try multiple time ranges going back up to 7 days (OpenSky has historical data)
      // Each range is max 2 days (OpenSky limitation)
      const timeRanges = [];
      for (let i = 1; i <= 4; i++) {
        timeRanges.push({
          begin: now - ((i + 1) * oneDay),
          end: now - (i * oneDay),
        });
      }

      logger.info('Querying OpenSky for flights', { 
        icao24, 
        timeRanges: timeRanges.map(r => ({
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
              const currentIndex = sortedFlights.findIndex(f => 
                f.firstSeen === flight.firstSeen && f.lastSeen === flight.lastSeen
              );
              if (currentIndex > 0) {
                const previousFlight = sortedFlights[currentIndex - 1];
                if (previousFlight.estArrivalAirport && 
                    ((previousFlight.arrivalAirportCandidatesCount || 0) > 0 || previousFlight.estArrivalAirport)) {
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
          })
        ).then((results) => {
          const succeeded = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
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

      logger.info('No OpenSky flights found for aircraft after checking all time ranges', { icao24 });
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
   * Fetch route from AviationStack API
   * Note: The API key provided works with /flights endpoint, not /routes
   */
  async fetchRouteFromAPI(icao24, callsign) {
    try {
      let routeData = null;
      let rateLimited = false; // Track if we hit rate limit

      // Use AviationStack /flights endpoint (not /routes - requires higher subscription)
      // Strategy: Try multiple parameter combinations to find the flight
      if (callsign) {
        const callsignTrimmed = callsign.trim();
        
        // 1. Try flight_icao first (e.g., "AAL445" - ICAO format)
        // Note: flight_date parameter may require higher subscription tier, try without it first
        logger.info('Trying AviationStack with flight_icao', { flight_icao: callsignTrimmed });
        try {
          const response = await axios.get(`${this.baseUrl}/flights`, {
            params: {
              access_key: this.apiKey,
              flight_icao: callsignTrimmed,
              flight_status: 'active', // Prioritize active flights (real-time)
              limit: 1,
            },
            timeout: 5000,
          });

          logger.debug('AviationStack /flights response (by flight_icao)', { 
            flight_icao: callsignTrimmed,
            dataLength: response.data?.data?.length || 0,
          });

          if (response.data?.data && response.data.data.length > 0) {
            routeData = response.data.data[0];
            logger.info('Found route from AviationStack using flight_icao', { 
              flight_icao: callsignTrimmed,
              departure: routeData.departure?.icao || routeData.departure?.iata,
              arrival: routeData.arrival?.icao || routeData.arrival?.iata,
            });
          }
        } catch (error) {
          const statusCode = error.response?.status;
          if (statusCode === 429) {
            rateLimited = true;
            logger.warn('AviationStack rate limit (429) reached on flight_icao search - skipping remaining attempts', {
              flight_icao: callsignTrimmed,
            });
            throw error; // Re-throw to trigger fallback immediately
          }
          logger.debug('AviationStack search by flight_icao failed', { 
            flight_icao: callsignTrimmed,
            error: error.message,
            status: statusCode,
          });
        }

        // 2. Try flight_iata (e.g., "AA445" - IATA format)
        if (!routeData) {
          logger.info('Trying AviationStack with flight_iata', { flight_iata: callsignTrimmed });
          try {
            const response = await axios.get(`${this.baseUrl}/flights`, {
              params: {
                access_key: this.apiKey,
                flight_iata: callsignTrimmed,
                flight_status: 'active',
                limit: 1,
              },
              timeout: 5000,
            });

            if (response.data?.data && response.data.data.length > 0) {
              routeData = response.data.data[0];
              logger.info('Found route from AviationStack using flight_iata', { 
                flight_iata: callsignTrimmed,
                departure: routeData.departure?.icao || routeData.departure?.iata,
                arrival: routeData.arrival?.icao || routeData.arrival?.iata,
              });
            }
          } catch (error) {
            const statusCode = error.response?.status;
            if (statusCode === 429) {
              rateLimited = true;
              logger.warn('AviationStack rate limit (429) reached on flight_iata search - skipping remaining attempts', {
                flight_iata: callsignTrimmed,
              });
              throw error; // Re-throw to trigger fallback immediately
            }
            logger.debug('AviationStack search by flight_iata failed', { 
              flight_iata: callsignTrimmed,
              error: error.message,
              status: statusCode,
            });
          }
        }

        // 3. Fallback: Extract airline code + flight number and try combinations
        if (!routeData) {
          const airlineMatch = callsignTrimmed.match(/^([A-Z0-9]{2,3})(\d+)$/);
          if (airlineMatch) {
            const airlineCode = airlineMatch[1];
            const flightNumber = airlineMatch[2];
            
            // Try airline_icao + flight_num
            logger.info('Trying AviationStack with airline_icao + flight_num', { 
              airline_icao: airlineCode,
              flight_num: flightNumber,
            });
            try {
              const response = await axios.get(`${this.baseUrl}/flights`, {
                params: {
                  access_key: this.apiKey,
                  airline_icao: airlineCode,
                  flight_number: flightNumber,
                  flight_status: 'active', // Real-time active flights
                  limit: 5,
                },
                timeout: 5000,
              });

              if (response.data?.data && response.data.data.length > 0) {
                // Prefer active flights, otherwise use first result
                routeData = response.data.data.find(f => f.flight_status === 'active') || response.data.data[0];
                logger.info('Found route from AviationStack using airline_icao + flight_num', { 
                  airline_icao: airlineCode,
                  flight_num: flightNumber,
                  departure: routeData.departure?.icao || routeData.departure?.iata,
                  arrival: routeData.arrival?.icao || routeData.arrival?.iata,
                });
              }
            } catch (error) {
              const statusCode = error.response?.status;
              if (statusCode === 429) {
                rateLimited = true;
                logger.warn('AviationStack rate limit (429) reached on airline_icao search - skipping remaining attempts', {
                  airline_icao: airlineCode,
                });
                throw error; // Re-throw to trigger fallback immediately
              }
              logger.debug('AviationStack search by airline_icao failed', { 
                airline_icao: airlineCode,
                error: error.message,
                status: statusCode,
              });
            }
          }
          
          // 4. If still no results, try without flight_status filter (might be scheduled or landed)
          if (!routeData && airlineMatch) {
            const airlineCode = airlineMatch[1];
            const flightNumber = airlineMatch[2];
            
            // Try without flight_status filter (may catch scheduled/landed flights from today)
            logger.info('Trying AviationStack without flight_status filter', { 
              airline_icao: airlineCode,
              flight_num: flightNumber,
            });
            try {
              const response = await axios.get(`${this.baseUrl}/flights`, {
                params: {
                  access_key: this.apiKey,
                  airline_icao: airlineCode,
                  flight_number: flightNumber,
                  limit: 10, // Get more results to find the right one
                },
                timeout: 5000,
              });

              if (response.data?.data && response.data.data.length > 0) {
                // Prioritize active, then scheduled, then most recent
                routeData = response.data.data.find(f => f.flight_status === 'active') 
                  || response.data.data.find(f => f.flight_status === 'scheduled')
                  || response.data.data[0];
                logger.info('Found route from AviationStack (without status filter)', { 
                  airline_icao: airlineCode,
                  flight_num: flightNumber,
                  status: routeData.flight_status,
                  departure: routeData.departure?.icao || routeData.departure?.iata,
                  arrival: routeData.arrival?.icao || routeData.arrival?.iata,
                });
              }
            } catch (error) {
              const statusCode = error.response?.status;
              if (statusCode === 429) {
                rateLimited = true;
                logger.warn('AviationStack rate limit (429) reached on search without status filter - aborting', {
                  airline_icao: airlineCode,
                });
                throw error; // Re-throw to trigger fallback immediately
              }
              logger.debug('AviationStack search without status filter failed', { 
                airline_icao: airlineCode,
                error: error.message,
                status: statusCode,
              });
            }
          }
        }
      }

      // Last resort: Search active flights by airline and filter by aircraft.icao24
      // This is the WORKING strategy: airline_icao + flight_status=active, then filter by aircraft.icao24
      // AviationStack doesn't have a direct icao24 search parameter, but includes it in response
      if (!routeData && icao24 && callsign) {
        const icao24Lower = icao24.toLowerCase().trim();
        logger.info('Searching AviationStack active flights and filtering by aircraft.icao24', { icao24: icao24Lower, callsign });
        
        try {
          // Extract airline code from callsign (e.g., "AAL445" -> "AAL")
          const airlineMatch = callsign.trim().match(/^([A-Z0-9]{2,3})/);
          if (airlineMatch) {
            const airlineCode = airlineMatch[1];
            
            // Build search params: use airline_icao if 3-letter, airline_iata if 2-letter
            const searchParams = {
              access_key: this.apiKey,
              flight_status: 'active', // Required for this API key tier
              limit: 100, // Get more results to increase chance of finding our aircraft
            };
            
            if (airlineCode.length === 3) {
              searchParams.airline_icao = airlineCode;
            } else if (airlineCode.length === 2) {
              searchParams.airline_iata = airlineCode;
            }
            
            logger.info('Querying active flights from airline and filtering by ICAO24', { 
              airlineCode, 
              icao24: icao24Lower,
              param: airlineCode.length === 3 ? 'airline_icao' : 'airline_iata',
            });
            
            const response = await axios.get(`${this.baseUrl}/flights`, {
              params: searchParams,
              timeout: 8000, // Longer timeout for larger result sets
            });

            if (response.data?.data && response.data.data.length > 0) {
              // Filter results by matching aircraft.icao24
              const matchingFlight = response.data.data.find(
                (flight) => flight.aircraft?.icao24?.toLowerCase() === icao24Lower
              );
              
              if (matchingFlight) {
                routeData = matchingFlight;
                logger.info('Found route from AviationStack by filtering active flights by ICAO24', { 
                  icao24: icao24Lower,
                  airlineCode,
                  flight_iata: routeData.flight?.iata,
                  flight_icao: routeData.flight?.icao,
                  departure: routeData.departure?.icao || routeData.departure?.iata,
                  arrival: routeData.arrival?.icao || routeData.arrival?.iata,
                });
              } else {
                logger.debug('ICAO24 not found in active flights', { 
                  icao24: icao24Lower,
                  airlineCode,
                  totalResults: response.data.data.length,
                  flightsWithIcao24: response.data.data.filter(f => f.aircraft?.icao24).length,
                });
              }
            }
          }
             } catch (error) {
               const statusCode = error.response?.status;
               if (statusCode === 429) {
                 rateLimited = true;
                 logger.warn('AviationStack rate limit (429) reached on ICAO24 filter search - aborting', {
                   icao24: icao24Lower,
                 });
                 throw error; // Re-throw to trigger fallback immediately
               }
               logger.debug('AviationStack search by filtering active flights failed', { 
                 icao24: icao24Lower,
                 error: error.message,
                 status: statusCode,
               });
             }
           }

      if (!routeData) {
        logger.warn('No route data found from AviationStack /flights API', { icao24, callsign });
        return null;
      }

      // Map AviationStack /flights response format to our internal format
      return {
        departureAirport: {
          iata: routeData.departure?.iata || null,
          icao: routeData.departure?.icao || null,
          name: routeData.departure?.airport || null,
        },
        arrivalAirport: {
          iata: routeData.arrival?.iata || null,
          icao: routeData.arrival?.icao || null,
          name: routeData.arrival?.airport || null,
        },
      };
    } catch (error) {
      const statusCode = error.response?.status;
      if (statusCode === 429) {
        logger.warn('AviationStack rate limit (429) - returning null to trigger OpenSky fallback', { 
          icao24, 
          callsign,
        });
      } else {
        logger.error('Error fetching route from AviationStack API', { 
          icao24, 
          callsign,
          error: error.message,
          status: statusCode,
          statusText: error.response?.statusText,
        });
      }
      throw error; // Re-throw to trigger fallback in calling function
    }
  }

  /**
   * Fetch route from FlightAware AeroAPI
   * Provides real-time flight tracking with excellent coverage
   */
  async fetchRouteFromFlightAware(callsign) {
    try {
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      
      logger.info('Querying FlightAware AeroAPI', { callsign, date: today });
      
      const response = await axios.get(`${this.flightAwareBaseUrl}/flights/${callsign}`, {
        params: {
          start: today,
        },
        headers: {
          'Accept': 'application/json; charset=UTF-8',
          'x-apikey': this.flightAwareApiKey,
        },
        timeout: 8000,
      });

      if (!response.data?.flights || response.data.flights.length === 0) {
        logger.debug('FlightAware returned no flights', { callsign });
        return null;
      }

      // Get the most recent/active flight (first one is usually the current or most recent)
      const flight = response.data.flights[0];
      
      if (!flight.origin || !flight.destination) {
        logger.debug('FlightAware flight missing origin or destination', { callsign });
        return null;
      }

      logger.info('Found route from FlightAware', {
        callsign,
        departure: flight.origin.code_icao || flight.origin.code,
        arrival: flight.destination.code_icao || flight.destination.code,
      });

      // Map FlightAware response format to our internal format
      return {
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
          // FlightAware doesn't provide Unix timestamps in the same format
          // We can extract scheduled/actual times if needed
          scheduledDeparture: flight.scheduled_out ? new Date(flight.scheduled_out).getTime() / 1000 : null,
          scheduledArrival: flight.scheduled_in ? new Date(flight.scheduled_in).getTime() / 1000 : null,
          actualDeparture: flight.actual_out ? new Date(flight.actual_out).getTime() / 1000 : null,
          actualArrival: flight.actual_in ? new Date(flight.actual_in).getTime() / 1000 : null,
        },
      };
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
   * Fallback: Infer route from flight position history
   * Uses first and last known positions to find nearest airports
   */
  async inferRouteFromPosition(icao24) {
    try {
      const history = await postgresRepository.findAircraftHistory(icao24);
      
      if (history.length < 2) {
        return null;
      }

      // Get first and last positions
      const firstPos = history[0];
      const lastPos = history[history.length - 1];

      // Find nearest airports (you'd need an airport database for this)
      // For now, return null and let frontend orchestrator handle it
      return {
        departureAirport: {
          iata: null,
          icao: null,
          name: null,
          inferred: true,
          location: firstPos.latitude && firstPos.longitude 
            ? { lat: firstPos.latitude, lng: firstPos.longitude }
            : null,
        },
        arrivalAirport: {
          iata: null,
          icao: null,
          name: null,
          inferred: true,
          location: lastPos.latitude && lastPos.longitude
            ? { lat: lastPos.latitude, lng: lastPos.longitude }
            : null,
        },
      };
    } catch (error) {
      logger.error('Error inferring route from position', { icao24, error: error.message });
      return null;
    }
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
      })
    );

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
  }
}

module.exports = new FlightRouteService();

