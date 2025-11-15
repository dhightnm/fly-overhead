const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Service for fetching aircraft data from FlightAware AeroAPI
 * Used as fallback when OpenSky is rate-limited
 */
class FlightAwareService {
  constructor() {
    this.baseUrl = config.external.flightAware?.baseUrl;
    this.apiKey = config.external.flightAware?.apiKey;
  }

  /**
   * Get authentication headers
   */
  getAuthHeader() {
    if (!this.apiKey) {
      throw new Error('FlightAware API key not configured');
    }
    return {
      'x-apikey': this.apiKey,
      Accept: 'application/json; charset=UTF-8',
    };
  }

  /**
   * Fetch aircraft states within bounding box
   * Uses FlightAware's search endpoint with geographic bounds
   *
   * @param {Object} bounds - { lamin, lomin, lamax, lomax }
   * @returns {Promise<Object>} - { states: Array, time: number }
   */
  async getStatesInBounds({
    lamin, lomin, lamax, lomax,
  }) {
    if (!this.apiKey) {
      throw new Error('FlightAware API key not configured');
    }

    try {
      // FlightAware AeroAPI search endpoint
      // Note: AeroAPI doesn't have a direct bounds endpoint, so we use search with filters
      // We'll search for active flights and filter by position client-side
      // Alternative: Use FlightXML2 SearchBirdseyeInFlight if available

      logger.info('Querying FlightAware AeroAPI for flights in bounds', {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
      });

      // Use FlightAware /flights/search endpoint with -latlong parameter
      // Format: -latlong "MINLAT MINLON MAXLAT MAXLON"
      // Note: lat comes first, then lon, for both min and max
      const query = `-latlong "${lamin} ${lomin} ${lamax} ${lomax}"`;

      logger.debug('FlightAware search query', {
        query,
        bounds: {
          lamin, lomin, lamax, lomax,
        },
      });

      let response;
      try {
        response = await axios.get(`${this.baseUrl}/flights/search`, {
          params: {
            query,
            max_pages: 1, // Limit to first page to avoid excessive API usage
          },
          headers: this.getAuthHeader(),
          timeout: 15000,
        });
      } catch (apiError) {
        logger.error('FlightAware /flights/search endpoint failed', {
          error: apiError.message,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          query,
        });
        // Return empty states
        return { states: [], time: Date.now() };
      }

      // FlightAware search endpoint returns { flights: [...], links: {...}, num_pages: ... }
      // Note: The response uses 'flights' not 'results'
      const flights = response.data?.flights || response.data?.results || [];

      logger.info(`FlightAware search returned ${flights.length} flights in bounds`, {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
        query,
        hasFlights: flights.length > 0,
        numPages: response.data?.num_pages || 0,
      });

      // Log sample flight structure for debugging
      if (flights.length > 0 && flights[0]) {
        logger.debug('Sample FlightAware flight structure', {
          ident: flights[0].ident,
          registration: flights[0].registration,
          hasLastPosition: !!flights[0].last_position,
          lastPosition: flights[0].last_position ? {
            lat: flights[0].last_position.latitude,
            lon: flights[0].last_position.longitude,
            alt: flights[0].last_position.altitude,
          } : null,
        });
      }

      if (flights.length === 0) {
        logger.debug('FlightAware returned no flights in bounds');
        return { states: [], time: Date.now() };
      }

      // Convert FlightAware format to OpenSky-like format
      const states = this.convertFlightAwareToOpenSkyFormat(flights, {
        lamin, lomin, lamax, lomax,
      });

      logger.info(`FlightAware returned ${states.length} aircraft in bounds`, {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
        totalResults: flights.length,
        filteredStates: states.length,
      });

      return {
        states,
        time: Date.now(),
      };
    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429) {
        logger.warn('FlightAware rate limit reached', {
          bounds: {
            lamin, lomin, lamax, lomax,
          },
        });
        throw new Error('FlightAware rate limit exceeded');
      }

      if (statusCode === 401 || statusCode === 403) {
        logger.error('FlightAware authentication failed', {
          error: error.message,
        });
        throw new Error('FlightAware authentication failed');
      }

      // If search endpoint doesn't work, try alternative approach
      logger.warn('FlightAware search endpoint failed, trying alternative', {
        error: error.message,
        status: statusCode,
      });

      // Fallback: Try to get flights by querying a center point
      return this.getStatesInBoundsFallback({
        lamin, lomin, lamax, lomax,
      });
    }
  }

  /**
   * Fallback method: Get flights near center of bounds
   * This is less precise but may work if the search endpoint isn't available
   */
  async getStatesInBoundsFallback({
    lamin, lomin, lamax, lomax,
  }) {
    try {
      // Calculate center point
      const centerLat = (lamin + lamax) / 2;
      const centerLon = (lomin + lomax) / 2;

      // Calculate approximate radius in degrees (rough conversion)
      const latRange = lamax - lamin;
      const lonRange = lomax - lomin;
      const maxRange = Math.max(latRange, lonRange);

      logger.info('Trying FlightAware fallback: center point search', {
        center: { lat: centerLat, lon: centerLon },
        radius: maxRange,
      });

      // Fallback: Use the same query format
      const query = `{range lat ${lamin} ${lamax}} {range lon ${lomin} ${lomax}}`;

      const response = await axios.get(`${this.baseUrl}/flights/search`, {
        params: {
          query,
          max_pages: 1,
        },
        headers: this.getAuthHeader(),
        timeout: 10000,
      });

      if (!response.data?.results || response.data.results.length === 0) {
        return { states: [], time: Date.now() };
      }

      const states = this.convertFlightAwareToOpenSkyFormat(response.data.results, {
        lamin, lomin, lamax, lomax,
      });

      return {
        states,
        time: Date.now(),
      };
    } catch (error) {
      logger.error('FlightAware fallback also failed', {
        error: error.message,
        status: error.response?.status,
      });
      return { states: [], time: Date.now() };
    }
  }

  /**
   * Convert FlightAware flight data to OpenSky state vector format
   * OpenSky format: [icao24, callsign, origin_country, time_position, last_contact,
   *                  longitude, latitude, baro_altitude, on_ground, velocity,
   *                  true_track, vertical_rate, sensors, geo_altitude, squawk,
   *                  spi, position_source, category]
   */
  convertFlightAwareToOpenSkyFormat(flights, bounds) {
    const states = [];

    for (const flight of flights) {
      // FlightAware AeroAPI response format uses 'last_position' not 'position'
      const position = flight.last_position;

      if (!position || position.latitude === undefined || position.longitude === undefined) {
        continue; // Skip flights without position
      }

      // Filter by bounds (FlightAware may return flights outside bounds)
      const lat = position.latitude;
      const lon = position.longitude;

      if (lat < bounds.lamin || lat > bounds.lamax
          || lon < bounds.lomin || lon > bounds.lomax) {
        continue; // Skip flights outside bounds
      }

      // Extract ICAO24 from registration
      // FlightAware search results may not include registration
      // We can't query flight details for every flight (too slow), so we skip flights without icao24
      let icao24 = null;

      // Try registration (if available in search results)
      if (flight.registration) {
        const reg = flight.registration.replace(/-/g, '').toLowerCase();
        // ICAO24 should be 6 hex characters
        if (reg.length === 6 && /^[0-9a-f]{6}$/.test(reg)) {
          icao24 = reg;
        }
      }

      // Skip flights without valid icao24 (required for database)
      // Note: FlightAware search endpoint doesn't always provide registration,
      // so we may skip some flights. This is acceptable for a backup data source.
      if (!icao24) {
        // Log first few skipped flights for debugging
        if (states.length < 3) {
          logger.info('Skipping FlightAware flight without valid icao24', {
            ident: flight.ident,
            registration: flight.registration,
            hasRegistration: !!flight.registration,
            flightKeys: Object.keys(flight).slice(0, 10),
          });
        }
        continue;
      }

      // Convert altitude from feet to meters
      const altitudeMeters = position.altitude ? position.altitude * 0.3048 : null;

      // Convert groundspeed from knots to m/s (1 knot = 0.514444 m/s)
      const velocityMs = position.groundspeed ? position.groundspeed * 0.514444 : null;

      // Get timestamp
      const timestamp = position.timestamp
        ? Math.floor(new Date(position.timestamp).getTime() / 1000)
        : null;

      // Determine if on ground (altitude < 50 feet or groundspeed < 5 knots)
      const onGround = (altitudeMeters !== null && altitudeMeters < 15.24)
        || (position.groundspeed !== null && position.groundspeed < 5);

      // Convert to OpenSky format
      const state = [
        icao24, // icao24 (0)
        flight.ident || null, // callsign (1)
        null, // origin_country (2) - not available in FlightAware
        timestamp, // time_position (3)
        timestamp, // last_contact (4)
        lon, // longitude (5)
        lat, // latitude (6)
        altitudeMeters, // baro_altitude in meters (7)
        onGround, // on_ground (8)
        velocityMs, // velocity in m/s (9)
        position.heading || null, // true_track (10)
        null, // vertical_rate (11) - not directly available in AeroAPI
        null, // sensors (12) - not available
        altitudeMeters, // geo_altitude (13) - same as baro for now
        null, // squawk (14) - not available in basic response
        false, // spi (15)
        null, // position_source (16)
        null, // category (17) - would need to infer from aircraft_type
      ];

      states.push(state);
    }

    return states;
  }

  /**
   * Prepare state for database (same format as OpenSky)
   * Adds created_at timestamp as index 18
   */
  prepareStateForDatabase(state) {
    // OpenSky format is 18 items (0-17), we append created_at as 18
    const stateWithDate = [...state.slice(0, 17), state[17] || null, new Date()];
    return stateWithDate;
  }
}

module.exports = new FlightAwareService();
