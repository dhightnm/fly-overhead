const logger = require('../utils/logger');

/**
 * Repository for feeder operations
 */
class FeederRepository {
  constructor(db) {
    this.db = db;
  }

  async getFeederById(feederId) {
    const query = 'SELECT * FROM feeders WHERE feeder_id = $1';
    return this.db.oneOrNone(query, [feederId]);
  }

  async registerFeeder(feederData) {
    const {
      feeder_id, api_key_hash, name, latitude, longitude, metadata,
    } = feederData;

    // Use ST_SetSRID with ST_MakePoint for safe parameterized queries
    const query = (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined)
      ? `
        INSERT INTO feeders (feeder_id, api_key_hash, name, location, metadata)
        VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)
        RETURNING *
      `
      : `
        INSERT INTO feeders (feeder_id, api_key_hash, name, location, metadata)
        VALUES ($1, $2, $3, NULL, $4)
        RETURNING *
      `;

    const params = (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined)
      ? [feeder_id, api_key_hash, name || null, longitude, latitude, metadata || {}]
      : [feeder_id, api_key_hash, name || null, metadata || {}];

    return this.db.one(query, params);
  }

  async updateFeederLastSeen(feederId) {
    const query = 'UPDATE feeders SET last_seen_at = NOW() WHERE feeder_id = $1';
    await this.db.query(query, [feederId]);
  }

  async upsertFeederStats(feederId, messagesReceived, uniqueAircraft) {
    const query = `
      INSERT INTO feeder_stats (feeder_id, date, messages_received, unique_aircraft)
      VALUES ($1, CURRENT_DATE, $2, $3)
      ON CONFLICT (feeder_id, date)
      DO UPDATE SET
        messages_received = feeder_stats.messages_received + $2,
        unique_aircraft = GREATEST(feeder_stats.unique_aircraft, $3)
    `;
    await this.db.query(query, [feederId, messagesReceived, uniqueAircraft]);
  }

  async getFeederByApiKey(apiKey) {
    try {
      const bcrypt = require('bcryptjs');

      // Get all active feeders
      const query = `
        SELECT id, feeder_id, api_key_hash, name, status,
               ST_Y(location::geometry) as latitude,
               ST_X(location::geometry) as longitude,
               created_at, updated_at, last_seen_at
        FROM feeders
        WHERE status IN ('active', 'inactive', 'suspended');
      `;

      const feeders = await this.db.manyOrNone(query);

      // Check each feeder's API key hash
      for (const feeder of feeders) {
        const isValid = await bcrypt.compare(apiKey, feeder.api_key_hash);
        if (isValid) {
          return {
            id: feeder.id,
            feeder_id: feeder.feeder_id,
            api_key_hash: feeder.api_key_hash,
            name: feeder.name,
            status: feeder.status,
            latitude: feeder.latitude,
            longitude: feeder.longitude,
            created_at: feeder.created_at,
            updated_at: feeder.updated_at,
            last_seen_at: feeder.last_seen_at,
          };
        }
      }

      return null;
    } catch (error) {
      logger.error('Error getting feeder by API key', { error: error.message });
      throw error;
    }
  }
}

module.exports = FeederRepository;
