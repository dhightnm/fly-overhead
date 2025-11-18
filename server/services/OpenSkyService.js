const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const rateLimitManager = require('./RateLimitManager');

/**
 * Service for interacting with OpenSky Network API
 * Handles all external API communication with rate limit awareness
 */
class OpenSkyService {
  constructor() {
    this.baseUrl = config.external.opensky.baseUrl;
    this.user = config.external.opensky.user;
    this.pass = config.external.opensky.pass;
  }

  /**
   * Get basic auth header
   */
  getAuthHeader() {
    if (!this.user || !this.pass) {
      throw new Error('OpenSky credentials not configured');
    }
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    return { Authorization: `Basic ${auth}` };
  }

  /**
   * Fetch all aircraft states
   */
  async getAllStates() {
    // Check if we're rate limited
    if (rateLimitManager.isRateLimited()) {
      const secondsRemaining = rateLimitManager.getSecondsUntilRetry();
      const error = new Error(`OpenSky API rate limited. Retry in ${secondsRemaining} seconds.`);
      error.rateLimited = true;
      error.retryAfter = secondsRemaining;
      throw error;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/states/all`, {
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
      // Handle rate limiting
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['x-rate-limit-retry-after-seconds'];
        rateLimitManager.recordRateLimit(retryAfter ? parseInt(retryAfter, 10) : null);

        const rateLimitError = new Error('OpenSky API rate limited');
        rateLimitError.rateLimited = true;
        rateLimitError.retryAfter = retryAfter || rateLimitManager.getSecondsUntilRetry();
        logger.error('OpenSky rate limit detected', {
          retryAfter: rateLimitError.retryAfter,
          retryAt: new Date(Date.now() + rateLimitError.retryAfter * 1000).toISOString(),
        });
        throw rateLimitError;
      }

      logger.error('Error fetching all states from OpenSky', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch aircraft states within bounding box
   */
  async getStatesInBounds({
    lamin, lomin, lamax, lomax,
  }) {
    // Check if we're rate limited
    if (rateLimitManager.isRateLimited()) {
      const secondsRemaining = rateLimitManager.getSecondsUntilRetry();
      const error = new Error(`OpenSky API rate limited. Retry in ${secondsRemaining} seconds.`);
      error.rateLimited = true;
      error.retryAfter = secondsRemaining;
      throw error;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/states/all`, {
        params: {
          extended: 1, // Include category field (index 17) - use 1 instead of true
          lamin,
          lomin,
          lamax,
          lomax,
        },
        headers: this.getAuthHeader(),
      });

      // Record successful request
      rateLimitManager.recordSuccess();

      return response.data;
    } catch (error) {
      // Handle rate limiting
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['x-rate-limit-retry-after-seconds'];
        rateLimitManager.recordRateLimit(retryAfter ? parseInt(retryAfter, 10) : null);

        const rateLimitError = new Error('OpenSky API rate limited');
        rateLimitError.rateLimited = true;
        rateLimitError.retryAfter = retryAfter || rateLimitManager.getSecondsUntilRetry();
        logger.error('OpenSky rate limit detected (bounded query)', {
          bounds: {
            lamin, lomin, lamax, lomax,
          },
          retryAfter: rateLimitError.retryAfter,
        });
        throw rateLimitError;
      }

      logger.error('Error fetching bounded states from OpenSky', {
        bounds: {
          lamin, lomin, lamax, lomax,
        },
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get flights by aircraft (includes departure/arrival airports)
   * Note: Only returns flights from previous day or earlier (updated by batch process at night)
   */
  async getFlightsByAircraft(icao24, begin, end) {
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
      if (error.response && error.response.status === 404) {
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
      if (error.response?.status === 400) {
        // Bad request - likely invalid time range or current flight (not historical)
        logger.debug('Invalid request to OpenSky (likely current flight)', { icao24, begin, end });
        return [];
      }
      logger.debug('Error fetching flights by aircraft from OpenSky (rate limited)', {
        icao24,
        error: error.message,
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
  // eslint-disable-next-line class-methods-use-this
  prepareStateForDatabase(state) {
    // OpenSky API with extended=true returns 18 items (0-17)
    // Index 17 is category (may be null if not broadcast by aircraft)
    // Append created_at as index 18
    let category = state[17] !== undefined ? state[17] : null;

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

module.exports = new OpenSkyService();
