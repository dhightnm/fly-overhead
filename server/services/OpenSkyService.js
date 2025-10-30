const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Service for interacting with OpenSky Network API
 * Handles all external API communication
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
    try {
      const response = await axios.get(`${this.baseUrl}/states/all`, {
        headers: this.getAuthHeader(),
      });
      return response.data;
    } catch (error) {
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
    try {
      const response = await axios.get(`${this.baseUrl}/states/all`, {
        params: {
          lamin, lomin, lamax, lomax,
        },
        headers: this.getAuthHeader(),
      });
      return response.data;
    } catch (error) {
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
      logger.warn('Error fetching flights by aircraft from OpenSky', {
        icao24,
        error: error.message,
      });
      // Return empty array instead of throwing - allows fallback to other sources
      return [];
    }
  }

  /**
   * Validate and prepare state data for database
   */
  // eslint-disable-next-line class-methods-use-this
  prepareStateForDatabase(state) {
    // OpenSky API returns 17 items, add null for category, then Date
    const stateWithCategory = [...state, null];
    const stateWithDate = [...stateWithCategory, new Date()];
    return stateWithDate;
  }
}

module.exports = new OpenSkyService();
