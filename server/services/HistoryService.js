const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');

/**
 * Service layer for historical flight data
 * Provides methods to query and analyze historical flight paths
 */
class HistoryService {
  /**
   * Get historical flight path for a specific aircraft
   */
  async getAircraftHistory(icao24, startTime = null, endTime = null) {
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
      logger.error('Error fetching aircraft history', {
        icao24,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get flight path trajectory data for visualization
   */
  async getFlightPath(icao24, startTime = null, endTime = null) {
    try {
      const history = await this.getAircraftHistory(icao24, startTime, endTime);

      // Format for map visualization
      const flightPath = history.map((point) => ({
        lat: point.latitude,
        lng: point.longitude,
        altitude: point.baro_altitude,
        velocity: point.velocity,
        heading: point.true_track,
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
      logger.error('Error generating flight path', {
        icao24,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get statistics about historical data
   */
  async getHistoryStats(icao24 = null) {
    try {
      let query = 'SELECT COUNT(*) as total_records, COUNT(DISTINCT icao24) as unique_aircraft, MIN(created_at) as earliest, MAX(created_at) as latest FROM aircraft_states_history';
      const params = [];

      if (icao24) {
        query += ' WHERE icao24 = $1';
        params.push(icao24);
      }

      const stats = await postgresRepository.getDb().one(query, params);
      return stats;
    } catch (error) {
      logger.error('Error fetching history stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Search for historical flights by time range
   */
  async searchFlightsByTimeRange(startTime, endTime, limit = 100) {
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
      logger.error('Error searching flights by time range', {
        startTime,
        endTime,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new HistoryService();
