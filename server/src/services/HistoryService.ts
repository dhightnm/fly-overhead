import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

/**
 * Service layer for historical flight data
 * Provides methods to query and analyze historical flight paths
 */
class HistoryService {
  /**
   * Get historical flight path for a specific aircraft
   */
  async getAircraftHistory(
    icao24: string,
    startTime: Date | null = null,
    endTime: Date | null = null,
  ): Promise<any[]> {
    try {
      logger.info('Fetching historical flight data', { icao24, startTime, endTime });

      const history = await postgresRepository.findAircraftHistory(
        icao24,
        startTime,
        endTime,
      );

      logger.info(`Found ${history.length} historical data points for ${icao24}`);
      return history;
    } catch (error) {
      const err = error as Error;
      logger.error('Error fetching aircraft history', {
        icao24,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get flight path trajectory data for visualization
   */
  async getFlightPath(
    icao24: string,
    startTime: Date | null = null,
    endTime: Date | null = null,
  ): Promise<any> {
    try {
      const history = await this.getAircraftHistory(icao24, startTime, endTime);

      // Format for map visualization with all available fields
      const flightPath = history.map((point: any) => ({
        lat: point.latitude,
        lng: point.longitude,
        altitude: point.baro_altitude,
        geoAltitude: point.geo_altitude,
        velocity: point.velocity,
        heading: point.true_track,
        verticalRate: point.vertical_rate,
        squawk: point.squawk,
        onGround: point.on_ground,
        timestamp: point.created_at,
      }));

      return {
        icao24: history[0]?.icao24,
        callsign: history[0]?.callsign,
        dataPoints: history.length,
        startTime: history[0]?.created_at,
        endTime: history[history.length - 1]?.created_at,
        flightPath,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Error generating flight path', {
        icao24,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get statistics about historical data
   */
  async getHistoryStats(icao24: string | null = null): Promise<any> {
    try {
      let query = 'SELECT COUNT(*) as total_records, COUNT(DISTINCT icao24) as unique_aircraft, MIN(created_at) as earliest, MAX(created_at) as latest FROM aircraft_states_history';
      const params: any[] = [];

      if (icao24) {
        query += ' WHERE icao24 = $1';
        params.push(icao24);
      }

      const stats = await postgresRepository.getDb().one(query, params);
      return stats;
    } catch (error) {
      const err = error as Error;
      logger.error('Error fetching history stats', { error: err.message });
      throw error;
    }
  }

  /**
   * Search for historical flights by time range
   */
  async searchFlightsByTimeRange(
    startTime: Date,
    endTime: Date,
    limit: number = 100,
  ): Promise<any[]> {
    try {
      const query = `
        SELECT * FROM aircraft_states_history 
        WHERE created_at BETWEEN $1 AND $2
        ORDER BY created_at DESC
        LIMIT $3
      `;

      const results = await postgresRepository.getDb().any(query, [startTime, endTime, limit]);
      logger.info(`Found ${results.length} historical records in time range`);
      return results;
    } catch (error) {
      const err = error as Error;
      logger.error('Error searching flights by time range', {
        startTime,
        endTime,
        error: err.message,
      });
      throw error;
    }
  }
}

// Export singleton instance
const historyService = new HistoryService();
export default historyService;
