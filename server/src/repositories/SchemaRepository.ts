import pgPromise from 'pg-promise';
import logger from '../utils/logger';
import { getConnection } from './DatabaseConnection';
import initializeAirportSchema from '../database/airportSchema';

/**
 * Repository for database schema creation and migrations
 */
class SchemaRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  /**
   * Create main aircraft_states table
   */
  async createMainTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS aircraft_states (
        id SERIAL PRIMARY KEY,
        icao24 TEXT NOT NULL UNIQUE, 
        callsign TEXT,
        origin_country TEXT,
        time_position INT,
        last_contact INT,
        longitude FLOAT8,
        latitude FLOAT8,
        baro_altitude FLOAT8,
        on_ground BOOLEAN,
        velocity FLOAT8,
        true_track FLOAT8,
        vertical_rate FLOAT8,
        sensors INT[],
        geo_altitude FLOAT8,
        squawk TEXT,
        spi BOOLEAN,
        position_source INT CHECK (position_source BETWEEN 0 AND 3),
        category INT CHECK (category BETWEEN 0 AND 19) NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        feeder_id TEXT,
        ingestion_timestamp TIMESTAMPTZ,
        data_source TEXT,
        source_priority INT,
        aircraft_type TEXT,
        aircraft_description TEXT,
        registration TEXT,
        emergency_status TEXT,
        nav_qnh FLOAT8,
        nav_altitude_mcp FLOAT8,
        nav_heading FLOAT8,
        owner_operator TEXT,
        year_built TEXT
      );
      
      -- Add missing columns to existing table (for migrations)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN feeder_id TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='ingestion_timestamp'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN ingestion_timestamp TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN data_source TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN source_priority INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='aircraft_type'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN aircraft_type TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='aircraft_description'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN aircraft_description TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='registration'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN registration TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='emergency_status'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN emergency_status TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='nav_qnh'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN nav_qnh FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='nav_altitude_mcp'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN nav_altitude_mcp FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='nav_heading'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN nav_heading FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='owner_operator'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN owner_operator TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='year_built'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN year_built TEXT;
        END IF;
      END $$;
    `;
    await this.db.query(query);
    logger.info('Main table created or already exists');
  }

  /**
   * Create critical performance indexes on aircraft_states table
   * These indexes are essential for query performance
   */
  async createAircraftStatesIndexes(): Promise<void> {
    const indexes = [
      // Critical: Index on last_contact for time-based filtering
      // DESC order optimizes for ORDER BY last_contact DESC queries
      `CREATE INDEX IF NOT EXISTS idx_aircraft_states_last_contact 
       ON aircraft_states(last_contact DESC)`,

      // Composite index on lat/lon for spatial queries (fallback when PostGIS not available)
      // Partial index only for rows without geometry to keep index small
      `CREATE INDEX IF NOT EXISTS idx_aircraft_states_lat_lon 
       ON aircraft_states(latitude, longitude) 
       WHERE geom IS NULL`,

      // Partial index for time filtering when geometry is available
      // Helps optimize queries that check both time and spatial constraints
      `CREATE INDEX IF NOT EXISTS idx_aircraft_states_last_contact_geom 
       ON aircraft_states(last_contact) 
       WHERE geom IS NOT NULL`,

      // Index on callsign for lookups
      `CREATE INDEX IF NOT EXISTS idx_aircraft_states_callsign 
       ON aircraft_states(callsign) 
       WHERE callsign IS NOT NULL AND callsign != ''`,
    ];

    for (const indexQuery of indexes) {
      try {
        await this.db.query(indexQuery);
      } catch (error) {
        // Index might already exist or other non-critical error
        const err = error as Error;
        logger.debug('Index creation info', { error: err.message });
      }
    }

    logger.info('Aircraft states indexes created or verified');
  }

  /**
   * Create history table
   */
  async createHistoryTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS aircraft_states_history (
        id SERIAL PRIMARY KEY,
        icao24 TEXT NOT NULL,
        callsign TEXT,
        origin_country TEXT,
        time_position INT,
        last_contact INT,
        longitude FLOAT8,
        latitude FLOAT8,
        baro_altitude FLOAT8,
        on_ground BOOLEAN,
        velocity FLOAT8,
        true_track FLOAT8,
        vertical_rate FLOAT8,
        sensors INT[],
        geo_altitude FLOAT8,
        squawk TEXT,
        spi BOOLEAN,
        position_source INT CHECK (position_source BETWEEN 0 AND 3),
        category INT CHECK (category BETWEEN 0 AND 19) NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        feeder_id TEXT,
        ingestion_timestamp TIMESTAMPTZ,
        data_source TEXT,
        source_priority INT,
        aircraft_type TEXT,
        aircraft_description TEXT,
        registration TEXT,
        emergency_status TEXT,
        nav_qnh FLOAT8,
        nav_altitude_mcp FLOAT8,
        nav_heading FLOAT8,
        owner_operator TEXT,
        year_built TEXT
      );
      
      -- Add missing columns to existing table (for migrations)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN feeder_id TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='ingestion_timestamp'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN ingestion_timestamp TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN data_source TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN source_priority INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='aircraft_type'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN aircraft_type TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='aircraft_description'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN aircraft_description TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='registration'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN registration TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='emergency_status'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN emergency_status TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='nav_qnh'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN nav_qnh FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='nav_altitude_mcp'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN nav_altitude_mcp FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='nav_heading'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN nav_heading FLOAT8;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='owner_operator'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN owner_operator TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='year_built'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN year_built TEXT;
        END IF;
      END $$;
    `;
    await this.db.query(query);
    logger.info('History table created or already exists');
  }

  /**
   * Create performance indexes on aircraft_states_history table
   * Uses CONCURRENTLY to avoid blocking and handles disk space errors gracefully
   */
  async createHistoryTableIndexes(): Promise<void> {
    interface IndexDefinition {
      name: string;
      query: string;
      description: string;
      optional: boolean;
    }

    const indexes: IndexDefinition[] = [
      {
        name: 'idx_aircraft_states_history_icao24_contact',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_history_icao24_contact 
                ON aircraft_states_history(icao24, last_contact DESC)`,
        description: 'Composite index for history queries by aircraft',
        optional: true, // Large table, can skip if disk space is low
      },
      {
        name: 'idx_aircraft_states_history_created_at',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_history_created_at 
                ON aircraft_states_history(created_at DESC)`,
        description: 'Index on created_at for time-based queries',
        optional: true, // Large table, can skip if disk space is low
      },
      {
        name: 'idx_aircraft_states_history_callsign',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_history_callsign 
                ON aircraft_states_history(callsign) 
                WHERE callsign IS NOT NULL AND callsign != ''`,
        description: 'Index on callsign for lookups',
        optional: true, // Partial index, smaller but still optional
      },
    ];

    for (const index of indexes) {
      try {
        // Check if index already exists to avoid unnecessary work
        const exists = await this.db.oneOrNone<{ count: number }>(
          `
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = 'public' 
            AND indexname = $1
        `,
          [index.name],
        );

        if (!exists) {
          logger.info(`Creating ${index.description}...`);
          await this.db.query(index.query);
          logger.info(`${index.name} created successfully`);
        } else {
          logger.debug(`${index.name} already exists`);
        }
      } catch (error) {
        const err = error as Error;
        // Handle disk space errors gracefully
        if (err.message.includes('No space left on device')) {
          if (index.optional) {
            logger.warn(`${index.description} skipped due to disk space (optional index)`);
          } else {
            logger.warn(`${index.description} creation skipped due to disk space`, {
              error: err.message,
            });
          }
        } else {
          // Log other errors but don't throw - allow server to continue
          logger.debug(`${index.description} creation info`, { error: err.message });
        }
      }
    }

    logger.info('History table indexes creation completed');
  }

  /**
   * Create flight routes cache table
   */
  async createFlightRoutesTable(): Promise<void> {
    // Cache table: Stores most recent route per callsign/icao24 (fast lookups)
    const cacheQuery = `
      CREATE TABLE IF NOT EXISTS flight_routes_cache (
        id SERIAL PRIMARY KEY,
        callsign TEXT,
        icao24 TEXT,
        cache_key TEXT UNIQUE NOT NULL,
        departure_iata TEXT,
        departure_icao TEXT,
        departure_name TEXT,
        arrival_iata TEXT,
        arrival_icao TEXT,
        arrival_name TEXT,
        source TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Add source column if it doesn't exist (for existing tables)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='flight_routes_cache' AND column_name='source'
        ) THEN
          ALTER TABLE flight_routes_cache ADD COLUMN source TEXT;
        END IF;
        -- Add aircraft_type column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='flight_routes_cache' AND column_name='aircraft_type'
        ) THEN
          ALTER TABLE flight_routes_cache ADD COLUMN aircraft_type TEXT;
        END IF;
      END $$;
      
      CREATE INDEX IF NOT EXISTS idx_routes_cache_key ON flight_routes_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_routes_icao24 ON flight_routes_cache(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_callsign ON flight_routes_cache(callsign);
      CREATE INDEX IF NOT EXISTS idx_routes_cache_aircraft_type ON flight_routes_cache(aircraft_type);
      
      -- Critical composite index for LATERAL join optimization
      -- This index is essential for the optimized findAircraftInBounds query
      CREATE INDEX IF NOT EXISTS idx_flight_routes_cache_created_at 
      ON flight_routes_cache(cache_key, created_at DESC);
    `;
    await this.db.query(cacheQuery);

    // History table: Stores all historical route data
    const historyQuery = `
      CREATE TABLE IF NOT EXISTS flight_routes_history (
        id SERIAL PRIMARY KEY,
        icao24 TEXT NOT NULL,
        callsign TEXT,
        flight_key TEXT,
        route_key TEXT,
        departure_iata TEXT,
        departure_icao TEXT,
        departure_name TEXT,
        departure_city TEXT,
        departure_country TEXT,
        arrival_iata TEXT,
        arrival_icao TEXT,
        arrival_name TEXT,
        arrival_city TEXT,
        arrival_country TEXT,
        aircraft_type TEXT,
        aircraft_model TEXT,
        scheduled_flight_start TIMESTAMPTZ,
        scheduled_flight_end TIMESTAMPTZ,
        actual_flight_start TIMESTAMPTZ,
        actual_flight_end TIMESTAMPTZ,
        first_seen TIMESTAMPTZ,
        last_seen TIMESTAMPTZ,
        source TEXT,
        registration TEXT,
        flight_status TEXT,
        route TEXT,
        route_distance NUMERIC,
        baggage_claim TEXT,
        gate_origin TEXT,
        gate_destination TEXT,
        terminal_origin TEXT,
        terminal_destination TEXT,
        actual_runway_off TIMESTAMPTZ,
        actual_runway_on TIMESTAMPTZ,
        progress_percent NUMERIC,
        filed_airspeed NUMERIC,
        blocked BOOLEAN DEFAULT false,
        diverted BOOLEAN DEFAULT false,
        cancelled BOOLEAN DEFAULT false,
        departure_delay INTEGER,
        arrival_delay INTEGER,
        scheduled_ete NUMERIC,
        actual_ete NUMERIC,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Add missing columns to existing table
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='flight_key'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN flight_key TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='route_key'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN route_key TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='registration'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN registration TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='flight_status'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN flight_status TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='route'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN route TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='route_distance'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN route_distance NUMERIC;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='baggage_claim'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN baggage_claim TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='gate_origin'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN gate_origin TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='gate_destination'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN gate_destination TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='terminal_origin'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN terminal_origin TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='terminal_destination'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN terminal_destination TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_runway_off'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_runway_off TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_runway_on'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_runway_on TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='progress_percent'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN progress_percent NUMERIC;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='filed_airspeed'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN filed_airspeed NUMERIC;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='blocked'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN blocked BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='diverted'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN diverted BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='cancelled'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN cancelled BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='departure_delay'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN departure_delay INTEGER;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='arrival_delay'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN arrival_delay INTEGER;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='scheduled_ete'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN scheduled_ete NUMERIC;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_ete'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_ete NUMERIC;
        END IF;
      END $$;
      
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_flight_routes_history_flight_key ON flight_routes_history(flight_key);
      CREATE INDEX IF NOT EXISTS idx_routes_history_icao24 ON flight_routes_history(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_history_callsign ON flight_routes_history(callsign);
      CREATE INDEX IF NOT EXISTS idx_routes_history_created_at ON flight_routes_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_routes_history_departure_icao ON flight_routes_history(departure_icao);
      CREATE INDEX IF NOT EXISTS idx_routes_history_arrival_icao ON flight_routes_history(arrival_icao);
    `;
    await this.db.query(historyQuery);

    logger.info('Flight routes tables created or already exist');
  }

  /**
   * Create feeders table
   */
  async createFeedersTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS feeders (
        id SERIAL PRIMARY KEY,
        feeder_id TEXT UNIQUE NOT NULL,
        name TEXT,
        location TEXT,
        latitude FLOAT8,
        longitude FLOAT8,
        api_key_hash TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true
      );
      
      CREATE INDEX IF NOT EXISTS idx_feeders_feeder_id ON feeders(feeder_id);
      CREATE INDEX IF NOT EXISTS idx_feeders_api_key_hash ON feeders(api_key_hash);
    `;
    await this.db.query(query);
    logger.info('Feeders table created or already exists');
  }

  /**
   * Create feeder stats table
   */
  async createFeederStatsTable(): Promise<void> {
    // Create table - match existing schema which uses 'date' column
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS feeder_stats (
        id SERIAL PRIMARY KEY,
        feeder_id TEXT NOT NULL REFERENCES feeders(feeder_id) ON DELETE CASCADE,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        messages_received INT DEFAULT 0,
        unique_aircraft INT DEFAULT 0,
        data_quality_score FLOAT,
        avg_latency_ms FLOAT,
        error_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(feeder_id, date)
      );
    `;
    await this.db.query(createTableQuery);

    // Add any missing columns for existing tables
    const addColumnsQuery = `
      DO $$
      BEGIN
        -- Add data_quality_score if missing
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='feeder_stats' AND column_name='data_quality_score'
        ) THEN
          ALTER TABLE feeder_stats ADD COLUMN data_quality_score FLOAT;
        END IF;
        
        -- Add avg_latency_ms if missing
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='feeder_stats' AND column_name='avg_latency_ms'
        ) THEN
          ALTER TABLE feeder_stats ADD COLUMN avg_latency_ms FLOAT;
        END IF;
        
        -- Add error_count if missing
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='feeder_stats' AND column_name='error_count'
        ) THEN
          ALTER TABLE feeder_stats ADD COLUMN error_count INT DEFAULT 0;
        END IF;
      END $$;
    `;
    await this.db.query(addColumnsQuery);

    // Create indexes
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_feeder_stats_feeder_id ON feeder_stats(feeder_id)',
      'CREATE INDEX IF NOT EXISTS idx_feeder_stats_date ON feeder_stats(date DESC)',
    ];

    for (const indexQuery of indexQueries) {
      try {
        await this.db.query(indexQuery);
      } catch (error) {
        const err = error as Error;
        logger.warn('Index creation warning (may already exist)', { error: err.message });
      }
    }

    logger.info('Feeder stats table created or already exists');
  }

  /**
   * Add feeder columns to aircraft_states table
   */
  async addFeederColumnsToAircraftStates(): Promise<void> {
    const queries = [
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN feeder_id TEXT;
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states' AND column_name='ingestion_timestamp'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN ingestion_timestamp TIMESTAMPTZ;
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN data_source TEXT DEFAULT 'opensky';
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN source_priority INT DEFAULT 30;
        END IF;
      END $$;`,
    ];

    for (const query of queries) {
      await this.db.query(query);
    }

    logger.info('Feeder columns added to aircraft_states table');
  }

  /**
   * Add feeder columns to aircraft_states_history table
   */
  async addFeederColumnsToAircraftStatesHistory(): Promise<void> {
    const queries = [
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states_history' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN feeder_id TEXT;
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states_history' AND column_name='ingestion_timestamp'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN ingestion_timestamp TIMESTAMPTZ;
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states_history' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN data_source TEXT DEFAULT 'opensky';
        END IF;
      END $$;`,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='aircraft_states_history' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN source_priority INT DEFAULT 30;
        END IF;
      END $$;`,
    ];

    for (const query of queries) {
      await this.db.query(query);
    }

    logger.info('Feeder columns added to aircraft_states_history table');
  }

  /**
   * Create users table
   */
  async createUsersTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        google_id TEXT UNIQUE,
        name TEXT,
        picture TEXT,
        is_premium BOOLEAN DEFAULT false,
        premium_expires_at TIMESTAMPTZ,
        is_feeder_provider BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
      CREATE INDEX IF NOT EXISTS idx_users_is_feeder_provider ON users(is_feeder_provider);
    `;
    await this.db.query(query);
    logger.info('Users table created or already exists');
  }

  /**
   * Add password column to existing users table (migration)
   */
  async addPasswordColumnToUsers(): Promise<void> {
    try {
      // Check if column exists
      const columnExists = await this.db.oneOrNone(
        `SELECT 1 FROM information_schema.columns 
         WHERE table_name = 'users' AND column_name = 'password'`,
      );

      if (!columnExists) {
        await this.db.query(`
          ALTER TABLE users 
          ADD COLUMN password TEXT;
        `);
        logger.info('Added password column to users table');
      } else {
        logger.info('Password column already exists in users table');
      }
    } catch (error) {
      const err = error as Error;
      logger.warn('Password column migration issue', { error: err.message });
      // Try with IF NOT EXISTS syntax (PostgreSQL 9.6+)
      try {
        await this.db.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS password TEXT;
        `);
        logger.info('Added password column to users table (using IF NOT EXISTS)');
      } catch (innerErr) {
        const innerError = innerErr as Error;
        logger.warn('Password column may already exist', { error: innerError.message });
      }
    }
  }

  /**
   * Add is_feeder_provider column to existing users table (migration)
   */
  async addFeederProviderColumnToUsers(): Promise<void> {
    const query = `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'is_feeder_provider'
        ) THEN
          ALTER TABLE users ADD COLUMN is_feeder_provider BOOLEAN DEFAULT false;
          CREATE INDEX IF NOT EXISTS idx_users_is_feeder_provider ON users(is_feeder_provider);
          logger.info('Added is_feeder_provider column to users table');
        END IF;
      END $$;
    `;
    try {
      await this.db.query(query);
      logger.info('Feeder provider column migration completed');
    } catch (error) {
      // If the DO block doesn't work, try direct ALTER
      try {
        await this.db.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS is_feeder_provider BOOLEAN DEFAULT false;
        `);
        await this.db.query(`
          CREATE INDEX IF NOT EXISTS idx_users_is_feeder_provider ON users(is_feeder_provider);
        `);
        logger.info('Added is_feeder_provider column to users table');
      } catch (innerErr) {
        const innerError = innerErr as Error;
        logger.warn('Feeder provider column may already exist', { error: innerError.message });
      }
    }
  }

  /**
   * Webhook subscription registry
   */
  async createWebhookSubscriptionsTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        subscriber_id TEXT NOT NULL,
        callback_url TEXT NOT NULL,
        event_types TEXT[] NOT NULL,
        signing_secret TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        rate_limit_per_minute INT DEFAULT 120,
        delivery_max_attempts INT DEFAULT 6,
        delivery_backoff_ms INT DEFAULT 15000,
        metadata JSONB,
        last_success_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'webhook_subscriptions'
          AND indexname = 'idx_webhook_subscriptions_event_types'
        ) THEN
          CREATE INDEX idx_webhook_subscriptions_event_types ON webhook_subscriptions USING GIN (event_types);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'webhook_subscriptions'
          AND indexname = 'idx_webhook_subscriptions_status'
        ) THEN
          CREATE INDEX idx_webhook_subscriptions_status ON webhook_subscriptions (status);
        END IF;
      END $$;
    `;

    await this.db.query(query);
    logger.info('Webhook subscriptions table initialized');
  }

  /**
   * Webhook events table (append-only)
   */
  async createWebhookEventsTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version TEXT DEFAULT 'v1',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'webhook_events' AND indexname = 'idx_webhook_events_type'
        ) THEN
          CREATE INDEX idx_webhook_events_type ON webhook_events (event_type);
        END IF;
      END $$;
    `;

    await this.db.query(query);
    logger.info('Webhook events table initialized');
  }

  /**
   * Webhook deliveries table (per-subscriber delivery tracking)
   */
  async createWebhookDeliveriesTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        delivery_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES webhook_events(event_id) ON DELETE CASCADE,
        subscription_id INT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        response_status INT,
        response_body TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'webhook_deliveries'
          AND indexname = 'idx_webhook_deliveries_status_next_attempt'
        ) THEN
          CREATE INDEX idx_webhook_deliveries_status_next_attempt ON webhook_deliveries (status, next_attempt_at);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'webhook_deliveries' AND indexname = 'idx_webhook_deliveries_event'
        ) THEN
          CREATE INDEX idx_webhook_deliveries_event ON webhook_deliveries (event_id);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'webhook_deliveries'
          AND indexname = 'idx_webhook_deliveries_subscription'
        ) THEN
          CREATE INDEX idx_webhook_deliveries_subscription ON webhook_deliveries (subscription_id);
        END IF;
      END $$;
    `;

    await this.db.query(query);
    logger.info('Webhook deliveries table initialized');
  }

  /**
   * Initialize webhook schema
   */
  async initializeWebhookSchema(): Promise<void> {
    await this.createWebhookSubscriptionsTable();
    await this.createWebhookEventsTable();
    await this.createWebhookDeliveriesTable();
  }

  /**
   * Initialize all database schemas
   */
  async initializeAll(): Promise<void> {
    await this.createMainTable();
    await this.createAircraftStatesIndexes();
    await this.createHistoryTable();
    await this.createHistoryTableIndexes();
    await this.createFlightRoutesTable();
    await this.createUsersTable();
    await this.addPasswordColumnToUsers(); // Migration for existing tables
    await this.createFeedersTable();
    await this.createFeederStatsTable();
    await this.addFeederColumnsToAircraftStates();
    await this.addFeederColumnsToAircraftStatesHistory();

    // Airport schema tables (airports, runways, frequencies, navaids)
    // Wrap in try-catch to allow server to start even if airport init fails
    try {
      await initializeAirportSchema(this.db);
      logger.info('Airport schema initialized successfully');
    } catch (error) {
      const err = error as Error;
      logger.warn('Airport schema initialization failed (tables may already exist)', {
        error: err.message,
      });
      // Don't throw - allow server to continue
    }

    await this.initializeWebhookSchema();

    logger.info('Database initialized successfully with performance indexes');
  }
}

export default SchemaRepository;
