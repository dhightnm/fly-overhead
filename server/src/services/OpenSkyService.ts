import axios, { AxiosError } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import rateLimitManager from './RateLimitManager';

interface OpenSkyResponse {
  time: number;
  states: any[][];
}

interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

interface RateLimitError extends Error {
  rateLimited: boolean;
  retryAfter?: number | null;
}

/**
 * Service for interacting with OpenSky Network API
 * Handles all external API communication with rate limit awareness
 */
class OpenSkyService {
  private baseUrl: string;
  private user?: string;
  private pass?: string;

  constructor() {
    this.baseUrl = config.external.opensky.baseUrl;
    this.user = config.external.opensky.user;
    this.pass = config.external.opensky.pass;
  }

  /**
   * Get basic auth header
   */
  private getAuthHeader(): { Authorization: string } {
    if (!this.user || !this.pass) {
      throw new Error('OpenSky credentials not configured');
    }
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    return { Authorization: `Basic ${auth}` };
  }

  /**
   * Fetch all aircraft states
   */
  async getAllStates(): Promise<OpenSkyResponse> {
    // Check if we're rate limited
    if (rateLimitManager.isRateLimited()) {
      const secondsRemaining = rateLimitManager.getSecondsUntilRetry();
      const error: RateLimitError = new Error(`OpenSky API rate limited. Retry in ${secondsRemaining} seconds.`) as RateLimitError;
      error.rateLimited = true;
      error.retryAfter = secondsRemaining;
      throw error;
    }

    try {
      const response = await axios.get<OpenSkyResponse>(`${this.baseUrl}/states/all`, {
        params: {
          extended: 1, // Include category field (index 17) - use 1 instead of true
        },
        headers: this.getAuthHeader(),
      });
      
      // Record successful request
      rateLimitManager.recordSuccess();
      
      // Log sample state structure if available (use info level for visibility)
      if (response.data.states && response.data.states.length > 0) {
        const sample = response.data.states[0];
        logger.info('OpenSky state sample', {
          length: sample.length,
          hasCategory: sample[17] !== undefined,
          categoryValue: sample[17],
          firstFewItems: sample.slice(0, 5),
        });
      }
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      // Handle rate limiting
      if (axiosError.response && axiosError.response.status === 429) {
        const retryAfter = axiosError.response.headers['x-rate-limit-retry-after-seconds'];
        rateLimitManager.recordRateLimit(retryAfter ? parseInt(String(retryAfter), 10) : null);
        
        const rateLimitError: RateLimitError = new Error('OpenSky API rate limited') as RateLimitError;
        rateLimitError.rateLimited = true;
        rateLimitError.retryAfter = retryAfter ? parseInt(String(retryAfter), 10) : rateLimitManager.getSecondsUntilRetry();
        logger.error('OpenSky rate limit detected', {
          retryAfter: rateLimitError.retryAfter,
          retryAt: new Date(Date.now() + (rateLimitError.retryAfter || 0) * 1000).toISOString(),
        });
        throw rateLimitError;
      }
      
      logger.error('Error fetching all states from OpenSky', { error: axiosError.message });
      throw error;
    }
  }

  /**
   * Fetch aircraft states within bounding box
   */
  async getStatesInBounds(bounds: BoundingBox): Promise<OpenSkyResponse> {
    const { lamin, lomin, lamax, lomax } = bounds;
    
    // Check if we're rate limited
    if (rateLimitManager.isRateLimited()) {
      const secondsRemaining = rateLimitManager.getSecondsUntilRetry();
      const error: RateLimitError = new Error(`OpenSky API rate limited. Retry in ${secondsRemaining} seconds.`) as RateLimitError;
      error.rateLimited = true;
      error.retryAfter = secondsRemaining;
      throw error;
    }

    try {
      const response = await axios.get<OpenSkyResponse>(`${this.baseUrl}/states/all`, {
        params: {
          extended: 1, // Include category field (index 17) - use 1 instead of true
          lamin, lomin, lamax, lomax,
        },
        headers: this.getAuthHeader(),
      });
      
      // Record successful request
      rateLimitManager.recordSuccess();
      
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      // Handle rate limiting
      if (axiosError.response && axiosError.response.status === 429) {
        const retryAfter = axiosError.response.headers['x-rate-limit-retry-after-seconds'];
        rateLimitManager.recordRateLimit(retryAfter ? parseInt(String(retryAfter), 10) : null);
        
        const rateLimitError: RateLimitError = new Error('OpenSky API rate limited') as RateLimitError;
        rateLimitError.rateLimited = true;
        rateLimitError.retryAfter = retryAfter ? parseInt(String(retryAfter), 10) : rateLimitManager.getSecondsUntilRetry();
        logger.error('OpenSky rate limit detected (bounded query)', {
          bounds: { lamin, lomin, lamax, lomax },
          retryAfter: rateLimitError.retryAfter,
        });
        throw rateLimitError;
      }
      
      logger.error('Error fetching bounded states from OpenSky', {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
        error: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get flights by aircraft (includes departure/arrival airports)
   * Note: Only returns flights from previous day or earlier (updated by batch process at night)
   */
  async getFlightsByAircraft(icao24: string, begin: number, end: number): Promise<any[]> {
    try {
      // OpenSky requires lowercase icao24
      const lowerIcao24 = icao24.toLowerCase();

      const response = await axios.get(`${this.baseUrl}/flights/aircraft`, {
        params: {
          icao24: lowerIcao24,
          begin,
          end,
        },
        headers: this.getAuthHeader(),
      });

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response && axiosError.response.status === 404) {
        // No flights found for this time period
        logger.debug('No flights found in OpenSky for aircraft (404)', {
          icao24,
          begin,
          end,
          beginDate: new Date(begin * 1000).toISOString(),
          endDate: new Date(end * 1000).toISOString(),
        });
        return [];
      }
      if (axiosError.response?.status === 400) {
        // Bad request - likely invalid time range or current flight (not historical)
        logger.debug('Invalid request to OpenSky (likely current flight)', { icao24, begin, end });
        return [];
      }
      logger.debug('Error fetching flights by aircraft from OpenSky (rate limited)', {
        icao24,
        error: axiosError.message,
      });
      // Return empty array instead of throwing - allows fallback to other sources
      return [];
    }
  }

  /**
   * Validate and prepare state data for database
   * OpenSky extended format: 18 items (0-17), where 17 is category
   * We append created_at as index 18
   */
  prepareStateForDatabase(state: any[]): any[] {
    // OpenSky API with extended=true returns 18 items (0-17)
    // Index 17 is category (may be null if not broadcast by aircraft)
    // Append created_at as index 18
    let category: number | null = state[17] !== undefined ? state[17] : null;
    
    // Validate category: must be between 0 and 19 (OpenSky valid range)
    // Some data sources may return invalid values (e.g., 20), so clamp to valid range
    if (category !== null && (typeof category !== 'number' || category < 0 || category > 19)) {
      logger.warn('Invalid category value from OpenSky, setting to null', {
        icao24: state[0],
        invalidCategory: category,
      });
      category = null;
    }
    
    const stateWithDate = [...state.slice(0, 17), category, new Date()];
    return stateWithDate;
  }
}

// Export singleton instance
const openSkyService = new OpenSkyService();
export default openSkyService;

