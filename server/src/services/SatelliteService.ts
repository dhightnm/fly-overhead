import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';

/**
 * Service for satellite data
 */
class SatelliteService {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor() {
    this.baseUrl = config.external.n2yo?.baseUrl || '';
    this.apiKey = config.external.n2yo?.apiKey;
  }

  /**
   * Get satellites above observer
   */
  async getSatellitesAbove(
    observerLat: number,
    observerLng: number,
    observerAlt: number
  ): Promise<any> {
    try {
      const url = `${this.baseUrl}/satellite/above/${observerLat}/${observerLng}/${observerAlt}/45/52&apiKey=${this.apiKey}`;
      const response = await axios.get(url);

      logger.info(`Fetched satellite data for observer at ${observerLat}, ${observerLng}`);
      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Error fetching satellite data', {
        observer: { observerLat, observerLng, observerAlt },
        error: err.message,
      });
      throw error;
    }
  }
}

export default new SatelliteService();

