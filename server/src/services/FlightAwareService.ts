import axios, { AxiosError } from 'axios';
import config from '../config';
import logger from '../utils/logger';

interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

interface FlightAwareResponse {
  states: any[][];
  time: number;
}

/**
 * Service for fetching aircraft data from FlightAware AeroAPI
 * Used as fallback when OpenSky is rate-limited
 */
class FlightAwareService {
  private baseUrl: string | undefined;

  private apiKey: string | undefined;

  constructor() {
    this.baseUrl = config.external.flightAware?.baseUrl;
    this.apiKey = config.external.flightAware?.apiKey;
  }

  /**
   * Get authentication headers
   */
  getAuthHeader(): { 'x-apikey': string; Accept: string } {
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
   */
  async getStatesInBounds(bounds: BoundingBox): Promise<FlightAwareResponse> {
    if (!this.apiKey) {
      throw new Error('FlightAware API key not configured');
    }

    const {
      lamin, lomin, lamax, lomax,
    } = bounds;

    try {
      logger.info('Querying FlightAware AeroAPI for flights in bounds', {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
      });

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
            max_pages: 1,
          },
          headers: this.getAuthHeader(),
          timeout: 15000,
        });
      } catch (apiError) {
        const err = apiError as AxiosError;
        logger.error('FlightAware /flights/search endpoint failed', {
          error: err.message,
          status: err.response?.status,
          statusText: err.response?.statusText,
          query,
        });
        return { states: [], time: Date.now() };
      }

      const flights = response.data?.flights || response.data?.results || [];

      logger.info(`FlightAware search returned ${flights.length} flights in bounds`, {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
        query,
        hasFlights: flights.length > 0,
        numPages: response.data?.num_pages || 0,
      });

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
      const err = error as AxiosError;
      const statusCode = err.response?.status;

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
          error: err.message,
        });
        throw new Error('FlightAware authentication failed');
      }

      logger.warn('FlightAware search endpoint failed, trying alternative', {
        error: err.message,
        status: statusCode,
      });

      return this.getStatesInBoundsFallback({
        lamin, lomin, lamax, lomax,
      });
    }
  }

  /**
   * Fallback method: Get flights near center of bounds
   */
  async getStatesInBoundsFallback(bounds: BoundingBox): Promise<FlightAwareResponse> {
    const {
      lamin, lomin, lamax, lomax,
    } = bounds;

    try {
      const centerLat = (lamin + lamax) / 2;
      const centerLon = (lomin + lomax) / 2;
      const latRange = lamax - lamin;
      const lonRange = lomax - lomin;
      const maxRange = Math.max(latRange, lonRange);

      logger.info('Trying FlightAware fallback: center point search', {
        center: { lat: centerLat, lon: centerLon },
        radius: maxRange,
      });

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
      const err = error as AxiosError;
      logger.error('FlightAware fallback also failed', {
        error: err.message,
        status: err.response?.status,
      });
      return { states: [], time: Date.now() };
    }
  }

  /**
   * Convert FlightAware flight data to OpenSky state vector format
   */
  convertFlightAwareToOpenSkyFormat(flights: any[], bounds: BoundingBox): any[][] {
    const states: any[][] = [];

    for (const flight of flights) {
      const position = flight.last_position;

      if (!position || position.latitude === undefined || position.longitude === undefined) {
        continue;
      }

      const lat = position.latitude;
      const lon = position.longitude;

      if (lat < bounds.lamin || lat > bounds.lamax
          || lon < bounds.lomin || lon > bounds.lomax) {
        continue;
      }

      let icao24: string | null = null;

      if (flight.registration) {
        const reg = flight.registration.replace(/-/g, '').toLowerCase();
        if (reg.length === 6 && /^[0-9a-f]{6}$/.test(reg)) {
          icao24 = reg;
        }
      }

      if (!icao24) {
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

      const altitudeMeters = position.altitude ? position.altitude * 0.3048 : null;
      const velocityMs = position.groundspeed ? position.groundspeed * 0.514444 : null;
      const timestamp = position.timestamp
        ? Math.floor(new Date(position.timestamp).getTime() / 1000)
        : null;
      const onGround = (altitudeMeters !== null && altitudeMeters < 15.24)
        || (position.groundspeed !== null && position.groundspeed < 5);

      const state = [
        icao24,
        flight.ident || null,
        null,
        timestamp,
        timestamp,
        lon,
        lat,
        altitudeMeters,
        onGround,
        velocityMs,
        position.heading || null,
        null,
        null,
        altitudeMeters,
        null,
        false,
        null,
        null,
      ];

      states.push(state);
    }

    return states;
  }

  /**
   * Prepare state for database (same format as OpenSky)
   */
  prepareStateForDatabase(state: any[]): any[] {
    const stateWithDate = [...state.slice(0, 17), state[17] || null, new Date()];
    return stateWithDate;
  }
}

export default new FlightAwareService();
