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
    this.cache = new Map(); // In-memory cache for current session
  }

  /**
   * Get flight route information for an aircraft
   * Priority: Cache -> OpenSky (FREE) -> Aviation Edge (paid) -> Position inference
   */
  async getFlightRoute(icao24, callsign) {
    // 1. Check in-memory cache
    const cacheKey = `${callsign || icao24}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 2. Check database cache
    const cachedRoute = await postgresRepository.getCachedRoute(cacheKey);
    if (cachedRoute) {
      this.cache.set(cacheKey, cachedRoute);
      return cachedRoute;
    }

    // 3. Try OpenSky Network API (FREE!) - only for historical flights
    try {
      const route = await this.fetchRouteFromOpenSky(icao24);
      if (route) {
        await this.cacheRoute(cacheKey, route, callsign, icao24);
        return route;
      }
    } catch (error) {
      logger.debug('OpenSky flight route not available (may be current flight)', { 
        icao24, 
        error: error.message,
      });
    }

    // 4. Fallback to Aviation Edge (for current flights)
    if (this.apiKey) {
      try {
        const route = await this.fetchRouteFromAPI(icao24, callsign);
        if (route) {
          await this.cacheRoute(cacheKey, route, callsign, icao24);
          return route;
        }
      } catch (error) {
        logger.warn('Error fetching route from Aviation Edge API', { error: error.message });
      }
    }

    // 5. Last resort: Position-based inference
    return this.inferRouteFromPosition(icao24);
  }

  /**
   * Fetch route from OpenSky Network (FREE!)
   * Note: Only works for flights from previous day or earlier
   */
  async fetchRouteFromOpenSky(icao24) {
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

      for (const range of timeRanges) {
        const flights = await openSkyService.getFlightsByAircraft(icao24, range.begin, range.end);

        if (flights && flights.length > 0) {
          // Get most recent flight (last in array should be most recent based on lastSeen)
          // Sort by lastSeen to be sure
          const sortedFlights = flights.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
          const flight = sortedFlights[0];

          logger.info('Found OpenSky flight route', { 
            icao24, 
            callsign: flight.callsign,
            departure: flight.estDepartureAirport,
            arrival: flight.estArrivalAirport,
          });

          // OpenSky flight object contains: estDepartureAirport (ICAO like "KJFK"), estArrivalAirport, firstSeen, lastSeen, etc.
          return {
            departureAirport: {
              iata: null, // OpenSky provides ICAO codes, can convert later if needed
              icao: flight.estDepartureAirport || null,
              name: flight.estDepartureAirport || null,
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
          };
        }
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
  async cacheRoute(cacheKey, route, callsign, icao24) {
    await postgresRepository.cacheRoute(cacheKey, {
      ...route,
      callsign,
      icao24,
    });
    this.cache.set(cacheKey, route);
  }

  /**
   * Fetch route from Aviation Edge API
   */
  async fetchRouteFromAPI(icao24, callsign) {
    try {
      let routeData = null;

      // Try callsign first (more reliable)
      if (callsign) {
        const response = await axios.get(`${this.baseUrl}/routes`, {
          params: {
            key: this.apiKey,
            iataFlight: callsign.trim(),
          },
          timeout: 5000,
        });

        if (response.data && response.data.length > 0) {
          routeData = response.data[0];
        }
      }

      // Fallback to ICAO24 if callsign didn't work
      if (!routeData && icao24) {
        const response = await axios.get(`${this.baseUrl}/flights`, {
          params: {
            key: this.apiKey,
            icao24: icao24.trim(),
          },
          timeout: 5000,
        });

        if (response.data && response.data.length > 0) {
          const flight = response.data[0];
          routeData = {
            departure: {
              iataCode: flight.departure?.iataCode,
              icaoCode: flight.departure?.icaoCode,
              airport: flight.departure?.airport,
            },
            arrival: {
              iataCode: flight.arrival?.iataCode,
              icaoCode: flight.arrival?.icaoCode,
              airport: flight.arrival?.airport,
            },
          };
        }
      }

      if (routeData) {
        return {
          departureAirport: {
            iata: routeData.departure?.iataCode || routeData.departureIata || null,
            icao: routeData.departure?.icaoCode || routeData.departureIcao || null,
            name: routeData.departure?.airport || routeData.departureAirport || null,
          },
          arrivalAirport: {
            iata: routeData.arrival?.iataCode || routeData.arrivalIata || null,
            icao: routeData.arrival?.icaoCode || routeData.arrivalIcao || null,
            name: routeData.arrival?.airport || routeData.arrivalAirport || null,
          },
        };
      }

      return null;
    } catch (error) {
      logger.error('Error fetching route from Aviation Edge API', { 
        icao24, 
        callsign,
        error: error.message,
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

