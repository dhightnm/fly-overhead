import pgPromise from 'pg-promise';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger';
import type { Feeder } from '../types/database.types';

interface FeederRegistrationData {
  feeder_id: string;
  api_key_hash: string;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, any> | null;
}

/**
 * Repository for feeder operations
 */
class FeederRepository {
  private db: pgPromise.IDatabase<any>;

  constructor(db: pgPromise.IDatabase<any>) {
    this.db = db;
  }

  async getFeederById(feederId: string): Promise<Feeder | null> {
    const query = 'SELECT * FROM feeders WHERE feeder_id = $1';
    return this.db.oneOrNone<Feeder>(query, [feederId]);
  }

  async registerFeeder(feederData: FeederRegistrationData): Promise<Feeder> {
    const {
      feeder_id: feederId,
      api_key_hash: apiKeyHash,
      name,
      latitude,
      longitude,
      metadata,
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
      ? [feederId, apiKeyHash, name || null, longitude, latitude, metadata || {}]
      : [feederId, apiKeyHash, name || null, metadata || {}];

    return this.db.one<Feeder>(query, params);
  }

  async updateFeederLastSeen(feederId: string): Promise<void> {
    const query = 'UPDATE feeders SET last_seen_at = NOW() WHERE feeder_id = $1';
    await this.db.query(query, [feederId]);
  }

  async upsertFeederStats(
    feederId: string,
    messagesReceived: number,
    uniqueAircraft: number,
  ): Promise<void> {
    // Use date column to match existing table schema
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

  async getFeederByApiKey(apiKey: string): Promise<Feeder | null> {
    try {
      // Get all active feeders
      const query = `
        SELECT id, feeder_id, api_key_hash, name, status,
               ST_Y(location::geometry) as latitude,
               ST_X(location::geometry) as longitude,
               created_at, updated_at, last_seen_at
        FROM feeders
        WHERE status IN ('active', 'inactive', 'suspended');
      `;

      const feeders = await this.db.manyOrNone<Feeder>(query);

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
          } as Feeder;
        }
      }

      return null;
    } catch (error) {
      const err = error as Error;
      logger.error('Error getting feeder by API key', { error: err.message });
      throw error;
    }
  }
}

export default FeederRepository;
