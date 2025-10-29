const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Service for satellite data
 */
class SatelliteService {
  constructor() {
    this.baseUrl = config.external.n2yo.baseUrl;
    this.apiKey = config.external.n2yo.apiKey;
  }

  /**
   * Get satellites above observer
   */
  async getSatellitesAbove(observerLat, observerLng, observerAlt) {
    try {
      const url = `${this.baseUrl}/satellite/above/${observerLat}/${observerLng}/${observerAlt}/45/52&apiKey=${this.apiKey}`;
      const response = await axios.get(url);

      logger.info(`Fetched satellite data for observer at ${observerLat}, ${observerLng}`);
      return response.data;
    } catch (error) {
      logger.error('Error fetching satellite data', {
        observer: { observerLat, observerLng, observerAlt },
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new SatelliteService();
