const pgp = require('pg-promise')();
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const PostGISService = require('../services/PostGISService');
const { mapAircraftType } = require('../utils/aircraftCategoryMapper');

/**
 * Repository pattern for PostgreSQL data access
 * Encapsulates all database queries
 */
class PostgresRepository {
  constructor() {
    const connectionString = config.database.postgres.url;
    this.db = pgp(connectionString);
    this.postgis = new PostGISService(this.db);
    this.initConnection();
  }

  async initConnection() {
    try {
      const obj = await this.db.connect();
      logger.info('Database connection established');
      obj.done();

      // Initialize PostGIS after connection is established
      await this.initializePostGIS();
    } catch (error) {
      logger.error('Database connection error', { error });
      process.exit(1);
    }
  }

  /**
   * Initialize PostGIS extension and spatial features
   */
  async initializePostGIS() {
    try {
      await this.postgis.initialize();
      await this.postgis.createGeometryTriggers();
      logger.info('PostGIS initialized successfully');
    } catch (error) {
      logger.warn('PostGIS initialization failed (may already be initialized)', {
        error: error.message,
      });
    }
  }

  /**
   * Create main aircraft_states table
   */
  async createMainTable() {
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await this.db.query(query);
    logger.info('Main table created or already exists');
  }

  /**
   * Create history table
   */
  async createHistoryTable() {
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await this.db.query(query);
    logger.info('History table created or already exists');
  }

  /**
   * Create flight routes cache table
   */
  async createFlightRoutesTable() {
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
    `;
    await this.db.query(cacheQuery);

    // History table: Stores ALL routes with timestamps (historical tracking)
    const historyQuery = `
      CREATE TABLE IF NOT EXISTS flight_routes_history (
        id SERIAL PRIMARY KEY,
        callsign TEXT,
        icao24 TEXT,
        -- Deterministic identifiers
        flight_key TEXT,
        route_key TEXT,
        aircraft_type TEXT,
        aircraft_model TEXT,
        departure_iata TEXT,
        departure_icao TEXT,
        departure_name TEXT,
        arrival_iata TEXT,
        arrival_icao TEXT,
        arrival_name TEXT,
        source TEXT,
        scheduled_flight_start TIMESTAMPTZ,
        scheduled_flight_end TIMESTAMPTZ,
        actual_flight_start TIMESTAMPTZ,
        actual_flight_end TIMESTAMPTZ,
        scheduled_ete INT,
        actual_ete INT,
        first_seen BIGINT,
        last_seen BIGINT,
        -- FlightAware additional fields
        registration TEXT,
        flight_status TEXT,
        route TEXT,
        route_distance INT,
        baggage_claim TEXT,
        gate_origin TEXT,
        gate_destination TEXT,
        terminal_origin TEXT,
        terminal_destination TEXT,
        actual_runway_off TEXT,
        actual_runway_on TEXT,
        progress_percent INT,
        filed_airspeed INT,
        blocked BOOLEAN,
        diverted BOOLEAN,
        cancelled BOOLEAN,
        departure_delay INT,
        arrival_delay INT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(icao24, callsign, first_seen, last_seen)
      );
      
      -- Add source column if it doesn't exist (for existing tables)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='flight_routes_history' AND column_name='source'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN source TEXT;
        END IF;
      END $$;
      
      -- Add timing/ETE columns if they don't exist (for existing tables)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='scheduled_flight_start'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN scheduled_flight_start TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='scheduled_flight_end'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN scheduled_flight_end TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_flight_start'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_flight_start TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_flight_end'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_flight_end TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='scheduled_ete'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN scheduled_ete INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_ete'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_ete INT;
        END IF;
      END $$;
      
      -- Add key columns if they don't exist
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
      END $$;

      -- Add aircraft fields if they don't exist
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='aircraft_type'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN aircraft_type TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='aircraft_model'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN aircraft_model TEXT;
        END IF;
      END $$;

      -- Add FlightAware additional fields if they don't exist
      DO $$
      BEGIN
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
          ALTER TABLE flight_routes_history ADD COLUMN route_distance INT;
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
          ALTER TABLE flight_routes_history ADD COLUMN actual_runway_off TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='actual_runway_on'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN actual_runway_on TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='progress_percent'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN progress_percent INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='filed_airspeed'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN filed_airspeed INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='blocked'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN blocked BOOLEAN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='diverted'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN diverted BOOLEAN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='cancelled'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN cancelled BOOLEAN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='departure_delay'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN departure_delay INT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='flight_routes_history' AND column_name='arrival_delay'
        ) THEN
          ALTER TABLE flight_routes_history ADD COLUMN arrival_delay INT;
        END IF;
      END $$;

      -- Add a unique constraint on flight_key (if present)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uniq_flight_routes_history_flight_key'
        ) THEN
          ALTER TABLE flight_routes_history
            ADD CONSTRAINT uniq_flight_routes_history_flight_key UNIQUE (flight_key);
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_routes_history_icao24 ON flight_routes_history(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_history_callsign ON flight_routes_history(callsign);
      CREATE INDEX IF NOT EXISTS idx_routes_history_dates ON flight_routes_history(actual_flight_start, actual_flight_end);
    `;
    await this.db.query(historyQuery);

    logger.info('Flight routes tables (cache + history) created or already exist');
  }

  /**
   * Insert or update aircraft state (with history)
   */
  async upsertAircraftState(state) {
    // History insert (no created_at needed, has DEFAULT)
    const historyState = [
      state[0], state[1], state[2], state[3], state[4],
      state[5], state[6], state[7], state[8], state[9],
      state[10], state[11], state[12], state[13], state[14],
      state[15], state[16], state[17],
    ];

    const insertHistoryQuery = `
      INSERT INTO aircraft_states_history (
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);
    `;
    await this.db.query(insertHistoryQuery, historyState);

    // Main table upsert
    const upsertQuery = `
      INSERT INTO aircraft_states(
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, created_at
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT(icao24) DO UPDATE SET
        callsign = TRIM(EXCLUDED.callsign),
        origin_country = EXCLUDED.origin_country,
        time_position = EXCLUDED.time_position,
        last_contact = EXCLUDED.last_contact,
        longitude = EXCLUDED.longitude,
        latitude = EXCLUDED.latitude,
        baro_altitude = EXCLUDED.baro_altitude,
        on_ground = EXCLUDED.on_ground,
        velocity = EXCLUDED.velocity,
        true_track = EXCLUDED.true_track,
        vertical_rate = EXCLUDED.vertical_rate,
        sensors = EXCLUDED.sensors,
        geo_altitude = EXCLUDED.geo_altitude,
        squawk = EXCLUDED.squawk,
        spi = EXCLUDED.spi,
        position_source = EXCLUDED.position_source,
        category = EXCLUDED.category;
    `;
    await this.db.query(upsertQuery, state);
  }

  /**
   * Find aircraft by icao24 or callsign
   */
  async findAircraftByIdentifier(identifier) {
    const query = `
      SELECT *
      FROM aircraft_states
      WHERE LOWER(icao24) = LOWER($1)
         OR LOWER(callsign) = LOWER($1)
      ORDER BY last_contact DESC NULLS LAST, created_at DESC
    `;
    const results = await this.db.any(query, [identifier.trim()]);
    return results;
  }

  /**
   * Find aircraft within bounding box with recent contact
   * Uses PostGIS spatial queries for better performance with spatial indexes
   * Falls back to BETWEEN if geom column not populated yet
   */
  async findAircraftInBounds(latmin, lonmin, latmax, lonmax, recentContactThreshold) {
    // Try PostGIS spatial query first (faster with GIST spatial index on large datasets)
    // ST_Contains with ST_MakeEnvelope handles bounding box queries efficiently
    // Falls back to BETWEEN if geom is NULL (for backwards compatibility)
    // LEFT JOIN with flight_routes_cache to get route data immediately (no API call needed)
    const query = `
      SELECT 
        a.*,
        c.departure_iata,
        c.departure_icao,
        c.departure_name,
        c.arrival_iata,
        c.arrival_icao,
        c.arrival_name,
        c.aircraft_type,
        c.source as route_source,
        c.created_at as route_created_at
      FROM aircraft_states a
      LEFT JOIN LATERAL (
        SELECT *
        FROM flight_routes_cache
        WHERE (
          -- Prefer callsign match (most specific)
          (cache_key = a.callsign AND a.callsign IS NOT NULL AND a.callsign != '')
          OR 
          -- Fallback to icao24
          cache_key = a.icao24
        )
        -- Get the most recent cache entry with complete data
        ORDER BY 
          CASE WHEN cache_key = a.callsign THEN 0 ELSE 1 END, -- Prefer callsign
          CASE WHEN arrival_icao IS NOT NULL THEN 0 ELSE 1 END, -- Prefer complete routes
          created_at DESC -- Most recent first
        LIMIT 1
      ) c ON true
      WHERE a.last_contact >= $1
        AND (
          -- Use PostGIS spatial query when geom is available (preferred, uses spatial index)
          (a.geom IS NOT NULL 
           AND ST_Contains(
             ST_MakeEnvelope($4, $2, $5, $3, 4326), -- lonmin, latmin, lonmax, latmax
             a.geom
           ))
          OR
          -- Fallback to BETWEEN when geom is NULL (backwards compatibility)
          (a.geom IS NULL
           AND a.latitude BETWEEN $2 AND $3
           AND a.longitude BETWEEN $4 AND $5)
        )
      ORDER BY a.last_contact DESC
    `;
    return this.db.manyOrNone(query, [recentContactThreshold, latmin, latmax, lonmin, lonmax]);
  }

  /**
   * Update aircraft category based on aircraft type/model
   * Called when we get aircraft type information from APIs
   */
  async updateAircraftCategory(icao24, category) {
    if (!icao24 || category === null || category === undefined) {
      return;
    }
    const query = `
      UPDATE aircraft_states
      SET category = $1
      WHERE icao24 = $2
        AND (category IS NULL OR category = 0)
    `;
    await this.db.query(query, [category, icao24]);
  }

  /**
   * Get historical flight path for an aircraft
   */
  async findAircraftHistory(icao24, startTime = null, endTime = null) {
    let query = `
      SELECT * FROM aircraft_states_history 
      WHERE icao24 = $1
    `;
    const params = [icao24];

    if (startTime) {
      query += ' AND created_at >= $2';
      params.push(startTime);
      if (endTime) {
        query += ' AND created_at <= $3';
        params.push(endTime);
      }
    } else if (endTime) {
      query += ' AND created_at <= $2';
      params.push(endTime);
    }

    query += ' ORDER BY created_at ASC';

    const results = await this.db.any(query, params);
    return results;
  }

  /**
   * Get historical positions for multiple aircraft
   */
  async findMultipleAircraftHistory(icao24s, startTime = null, endTime = null) {
    const placeholders = icao24s.map((_, i) => `$${i + 1}`).join(', ');

    let query = `
      SELECT * FROM aircraft_states_history 
      WHERE icao24 IN (${placeholders})
    `;
    const params = [...icao24s];

    if (startTime) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startTime);
      if (endTime) {
        query += ` AND created_at <= $${params.length + 1}`;
        params.push(endTime);
      }
    } else if (endTime) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endTime);
    }

    query += ' ORDER BY created_at ASC';

    const results = await this.db.any(query, params);
    return results;
  }

  /**
   * Cache flight route information
   */
  async cacheRoute(cacheKey, routeData) {
    try {
      // Log source for debugging
      logger.info('Caching route with source', {
        cacheKey,
        callsign: routeData.callsign,
        source: routeData.source,
        hasSource: !!routeData.source,
        routeDataKeys: Object.keys(routeData),
      });

      const query = `
        INSERT INTO flight_routes_cache (
          cache_key, callsign, icao24,
          departure_iata, departure_icao, departure_name,
          arrival_iata, arrival_icao, arrival_name,
          source, aircraft_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (cache_key) DO UPDATE SET
          last_used = CURRENT_TIMESTAMP,
          departure_iata = EXCLUDED.departure_iata,
          departure_icao = EXCLUDED.departure_icao,
          departure_name = EXCLUDED.departure_name,
          arrival_iata = EXCLUDED.arrival_iata,
          arrival_icao = EXCLUDED.arrival_icao,
          arrival_name = EXCLUDED.arrival_name,
          source = EXCLUDED.source,
          aircraft_type = EXCLUDED.aircraft_type;
      `;

      const sourceValue = routeData.source || null;
      // Prefer model over type - "A321" is more useful than "Plane"
      const aircraftType = routeData.aircraft?.model 
        || routeData.aircraft?.type 
        || routeData.aircraft_type 
        || null;
      
      logger.info('About to insert route with source value', {
        cacheKey,
        sourceValue,
        sourceType: typeof sourceValue,
        aircraftType,
        hasModel: !!routeData.aircraft?.model,
        hasType: !!routeData.aircraft?.type,
      });

      await this.db.query(query, [
        cacheKey,
        routeData.callsign || null,
        routeData.icao24 || null,
        routeData.departureAirport?.iata || null,
        routeData.departureAirport?.icao || null,
        routeData.departureAirport?.name || null,
        routeData.arrivalAirport?.iata || null,
        routeData.arrivalAirport?.icao || null,
        routeData.arrivalAirport?.name || null,
        sourceValue, // Use explicit variable instead of inline
        aircraftType,
      ]);

      // Update aircraft category if we have aircraft_type (Option 3: Store category)
      // This ensures icons are correct on load even without route data
      if (routeData.icao24 && aircraftType) {
        const aircraftInfo = mapAircraftType(aircraftType);
        if (aircraftInfo.category !== null) {
          // Update asynchronously to not block route caching
          this.updateAircraftCategory(routeData.icao24, aircraftInfo.category)
            .catch((err) => {
              logger.debug('Failed to update aircraft category when caching route', {
                icao24: routeData.icao24,
                error: err.message,
              });
            });
        }
      }

      logger.info('Route cached successfully', { cacheKey, source: sourceValue });
    } catch (error) {
      logger.error('Error caching route', {
        cacheKey,
        callsign: routeData.callsign,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get cached route information
   */
  async getCachedRoute(cacheKey) {
    // Different TTLs based on route completeness:
    // - Complete routes (has arrival): 24 hours
    // - Incomplete routes (no arrival, inference): 30 minutes
    // This allows re-fetching when in-flight aircraft land
    const query = `
      SELECT 
        callsign,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source, aircraft_type,
        created_at
      FROM flight_routes_cache
      WHERE cache_key = $1
        AND (
          -- Complete routes: 24h cache
          (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL) 
          AND created_at > NOW() - INTERVAL '24 hours'
          OR
          -- Incomplete inferred routes: 30min cache
          (arrival_icao IS NULL AND arrival_iata IS NULL AND source = 'inference')
          AND created_at > NOW() - INTERVAL '30 minutes'
          OR
          -- Incomplete non-inference routes: 2h cache (APIs might have data later)
          (arrival_icao IS NULL AND arrival_iata IS NULL AND source != 'inference')
          AND created_at > NOW() - INTERVAL '2 hours'
        )
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [cacheKey]);

    if (!result) return null;

    return {
      departureAirport: {
        iata: result.departure_iata,
        icao: result.departure_icao,
        name: result.departure_name,
      },
      arrivalAirport: {
        iata: result.arrival_iata,
        icao: result.arrival_icao,
        name: result.arrival_name,
      },
      source: result.source,
      aircraft: result.aircraft_type ? {
        type: result.aircraft_type,
      } : undefined,
    };
  }

  /**
   * Find historical route for a given callsign and departure airport
   * Used for inferring arrival airport based on previous flights
   */
  async findHistoricalRoute(callsign, departureIcao) {
    const query = `
      SELECT 
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        created_at
      FROM flight_routes_history
      WHERE UPPER(TRIM(callsign)) = UPPER($1)
        AND (UPPER(departure_icao) = UPPER($2) OR UPPER(departure_iata) = UPPER($2))
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [callsign, departureIcao]);

    if (!result) return null;

    return {
      departure_iata: result.departure_iata,
      departure_icao: result.departure_icao,
      departure_name: result.departure_name,
      arrival_iata: result.arrival_iata,
      arrival_icao: result.arrival_icao,
      arrival_name: result.arrival_name,
      source: result.source,
      created_at: result.created_at,
    };
  }

  async findHistoricalRouteByIcao24(icao24, departureIcao) {
    const query = `
      SELECT 
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        created_at
      FROM flight_routes_history
      WHERE LOWER(TRIM(icao24)) = LOWER($1)
        AND (UPPER(departure_icao) = UPPER($2) OR UPPER(departure_iata) = UPPER($2))
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [icao24, departureIcao]);

    if (!result) return null;

    return {
      departure_iata: result.departure_iata,
      departure_icao: result.departure_icao,
      departure_name: result.departure_name,
      arrival_iata: result.arrival_iata,
      arrival_icao: result.arrival_icao,
      arrival_name: result.arrival_name,
      source: result.source,
      created_at: result.created_at,
    };
  }

  /**
   * Store route in history table (stores ALL routes for historical tracking)
   */
  async storeRouteHistory(routeData) {
    // First, check if this is a recent flight that might need updating
    // (e.g., a flight that was "En Route" and is now "Arrived")
    const callsignNorm = routeData.callsign ? String(routeData.callsign).trim().toUpperCase() : '';
    const icao24Norm = routeData.icao24 ? String(routeData.icao24).trim().toLowerCase() : '';
    
    // legacy mapping replaced: actual_* will carry real times; first/last seen remain raw seconds
    const scheduledStart = routeData.flightData?.scheduledDeparture
      ? new Date(routeData.flightData.scheduledDeparture * 1000)
      : null;
    const scheduledEnd = routeData.flightData?.scheduledArrival
      ? new Date(routeData.flightData.scheduledArrival * 1000)
      : null;
    const actualStart = routeData.flightData?.actualDeparture
      ? new Date(routeData.flightData.actualDeparture * 1000)
      : null;
    const actualEnd = routeData.flightData?.actualArrival
      ? new Date(routeData.flightData.actualArrival * 1000)
      : null;

    // Check for existing recent flight with same departure time (within 48 hours)
    // This handles cases where a flight was "En Route" and is now "Arrived"
    const departureTime = actualStart || scheduledStart;
    let existingFlightId = null;
    
    if (icao24Norm && callsignNorm && departureTime) {
      // Match flights by departure time (within 5 minutes tolerance) and same callsign/icao24
      const recentFlightQuery = `
        SELECT id, actual_flight_end, flight_status, actual_flight_start, scheduled_flight_start
        FROM flight_routes_history
        WHERE icao24 = $1
          AND callsign = $2
          AND (
            ($3 IS NOT NULL AND actual_flight_start IS NOT NULL 
             AND ABS(EXTRACT(EPOCH FROM (actual_flight_start - $3::timestamp))) < 300)
            OR ($4 IS NOT NULL AND scheduled_flight_start IS NOT NULL AND actual_flight_start IS NULL
             AND ABS(EXTRACT(EPOCH FROM (scheduled_flight_start - $4::timestamp))) < 300)
          )
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const existingFlight = await this.db.oneOrNone(recentFlightQuery, [
        icao24Norm,
        callsignNorm,
        actualStart,
        scheduledStart,
      ]);
      
      if (existingFlight) {
        existingFlightId = existingFlight.id;
        
        // Check if this is truly a duplicate (same flight) vs. just similar departure time
        // For completed flights, also check arrival time
        const isSameFlight = !actualEnd || !existingFlight.actual_flight_end 
          || Math.abs((actualEnd.getTime() - existingFlight.actual_flight_end.getTime()) / 1000) < 300; // within 5 min
        
        // Always update if:
        // 1. It's the same flight (same departure AND arrival if both exist)
        // 2. Existing flight doesn't have arrival time but new data does
        // 3. Status changed (e.g., "En Route" -> "Arrived")
        // 4. Existing flight has empty/malformed flight_key but we have valid times
        const hasMoreCompleteData = actualEnd && !existingFlight.actual_flight_end;
        const statusChanged = existingFlight.flight_status !== routeData.flightStatus && routeData.flightStatus;
        const needsFlightKeyFix = (!existingFlight.flight_key || existingFlight.flight_key.includes('||')) 
          && departureTime && (actualEnd || scheduledEnd);
        const needsUpdate = (isSameFlight && (hasMoreCompleteData || statusChanged || needsFlightKeyFix))
          || (needsFlightKeyFix && departureTime);
        
        if (needsUpdate && existingFlightId) {
          logger.info('Updating existing recent flight with completed data', {
            flightId: existingFlightId,
            callsign: callsignNorm,
            icao24: icao24Norm,
            oldStatus: existingFlight.flight_status,
            newStatus: routeData.flightStatus,
            hasNewArrival: !!actualEnd,
            hadArrival: !!existingFlight.actual_flight_end,
          });
          
          // Update the existing record instead of creating a new one
          const updateFields = {};
          // Also update flight_key if it's empty or malformed (old format or missing)
          if (needsFlightKeyFix) {
            const startKey = departureTime ? departureTime.toISOString() : 'null';
            const endKey = (actualEnd || scheduledEnd) ? (actualEnd || scheduledEnd).toISOString() : 'null';
            const flightKeyComponents = [
              icao24Norm,
              callsignNorm,
              startKey,
              endKey,
            ].join('|');
            updateFields.flight_key = crypto.createHash('md5').update(flightKeyComponents).digest('hex');
          }
          if (actualEnd) updateFields.actual_flight_end = actualEnd;
          if (actualStart && !existingFlight.actual_flight_start) updateFields.actual_flight_start = actualStart;
          if (scheduledEnd) updateFields.scheduled_flight_end = scheduledEnd;
          if (scheduledStart && !existingFlight.scheduled_flight_start) updateFields.scheduled_flight_start = scheduledStart;
          if (routeData.flightStatus) updateFields.flight_status = routeData.flightStatus;
          if (routeData.registration) updateFields.registration = routeData.registration;
          if (routeData.route) updateFields.route = routeData.route;
          if (routeData.routeDistance !== undefined) updateFields.route_distance = routeData.routeDistance;
          if (routeData.baggageClaim) updateFields.baggage_claim = routeData.baggageClaim;
          if (routeData.gateOrigin) updateFields.gate_origin = routeData.gateOrigin;
          if (routeData.gateDestination) updateFields.gate_destination = routeData.gateDestination;
          if (routeData.terminalOrigin) updateFields.terminal_origin = routeData.terminalOrigin;
          if (routeData.terminalDestination) updateFields.terminal_destination = routeData.terminalDestination;
          if (routeData.actualRunwayOff) updateFields.actual_runway_off = routeData.actualRunwayOff;
          if (routeData.actualRunwayOn) updateFields.actual_runway_on = routeData.actualRunwayOn;
          if (routeData.progressPercent !== undefined) updateFields.progress_percent = routeData.progressPercent;
          if (routeData.filedAirspeed !== undefined) updateFields.filed_airspeed = routeData.filedAirspeed;
          if (routeData.blocked !== undefined) updateFields.blocked = routeData.blocked;
          if (routeData.diverted !== undefined) updateFields.diverted = routeData.diverted;
          if (routeData.cancelled !== undefined) updateFields.cancelled = routeData.cancelled;
          if (routeData.departureDelay !== undefined) updateFields.departure_delay = routeData.departureDelay;
          if (routeData.arrivalDelay !== undefined) updateFields.arrival_delay = routeData.arrivalDelay;
          if (actualStart && actualEnd) {
            updateFields.actual_ete = Math.max(0, Math.floor((actualEnd.getTime() - actualStart.getTime()) / 1000));
          }
          
          return await this.updateFlightHistoryById(existingFlightId, updateFields);
        }
      }
    }

    // Build deterministic keys for new flights
    // Use MD5 hash of key components for a clean, fixed-length identifier
    // This ensures same flight always gets same key, even if some fields are null
    const startKey = departureTime ? departureTime.toISOString() : '';
    const endKey = (actualEnd || scheduledEnd) ? (actualEnd || scheduledEnd).toISOString() : '';
    const depIcao = routeData.departureAirport?.icao ? String(routeData.departureAirport.icao).trim().toUpperCase() : '';
    const arrIcao = routeData.arrivalAirport?.icao ? String(routeData.arrivalAirport.icao).trim().toUpperCase() : '';

    // Generate deterministic hash-based flight_key (32 char hex string)
    const flightKeyComponents = [
      icao24Norm,
      callsignNorm,
      startKey || 'null',
      endKey || 'null',
    ].join('|');
    const flightKey = crypto.createHash('md5').update(flightKeyComponents).digest('hex');
    const routeKey = [depIcao, arrIcao].join('>');

    // Calculate ETEs
    let eteSeconds = null;
    if (typeof routeData.flightData?.duration === 'number') {
      eteSeconds = routeData.flightData.duration;
    } else if (typeof routeData.flightData?.filedEte === 'number') {
      eteSeconds = routeData.flightData.filedEte;
    }

    // Compute ETEs from timestamps when available (seconds)
    const scheduledEte = (scheduledStart && scheduledEnd)
      ? Math.max(0, Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000))
      : null;
    const actualEte = (actualStart && actualEnd)
      ? Math.max(0, Math.floor((actualEnd.getTime() - actualStart.getTime()) / 1000))
      : null;

    const query = `
      INSERT INTO flight_routes_history (
        callsign, icao24,
        flight_key, route_key,
        aircraft_type, aircraft_model,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        first_seen, last_seen,
        scheduled_flight_start, scheduled_flight_end,
        actual_flight_start, actual_flight_end,
        scheduled_ete, actual_ete,
        registration, flight_status, route, route_distance,
        baggage_claim, gate_origin, gate_destination,
        terminal_origin, terminal_destination,
        actual_runway_off, actual_runway_on,
        progress_percent, filed_airspeed,
        blocked, diverted, cancelled,
        departure_delay, arrival_delay
      )
      VALUES (
        $1, $2,
        $3, $4,
        $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13,
        $14, $15,
        $16, $17,
        $18, $19,
        $20, $21,
        $22, $23, $24, $25,
        $26, $27, $28,
        $29, $30,
        $31, $32,
        $33, $34,
        $35, $36, $37,
        $38, $39
      )
      ON CONFLICT ON CONSTRAINT uniq_flight_routes_history_flight_key DO NOTHING;
    `;

    try {
      await this.db.query(query, [
        routeData.callsign || null,
        routeData.icao24 || null,
        flightKey || null,
        routeKey || null,
        routeData.aircraft?.type || routeData.aircraft_type || null,
        routeData.aircraft?.model || routeData.aircraft_model || null,
        routeData.departureAirport?.iata || null,
        routeData.departureAirport?.icao || null,
        routeData.departureAirport?.name || null,
        routeData.arrivalAirport?.iata || null,
        routeData.arrivalAirport?.icao || null,
        routeData.arrivalAirport?.name || null,
        routeData.source || null,
        routeData.flightData?.firstSeen || null,
        routeData.flightData?.lastSeen || null,
        scheduledStart,
        scheduledEnd,
        actualStart,
        actualEnd,
        scheduledEte,
        actualEte,
        // FlightAware additional fields
        routeData.registration || null,
        routeData.flightStatus || null,
        routeData.route || null,
        routeData.routeDistance || null,
        routeData.baggageClaim || null,
        routeData.gateOrigin || null,
        routeData.gateDestination || null,
        routeData.terminalOrigin || null,
        routeData.terminalDestination || null,
        routeData.actualRunwayOff || null,
        routeData.actualRunwayOn || null,
        routeData.progressPercent || null,
        routeData.filedAirspeed || null,
        routeData.blocked || false,
        routeData.diverted || false,
        routeData.cancelled || false,
        routeData.departureDelay || null,
        routeData.arrivalDelay || null,
      ]);
    } catch (error) {
      // Ignore duplicate key errors (expected when same flight already stored)
      if (error.message?.includes('duplicate key') || error.message?.includes('uniq_flight_routes_history_flight_key')) {
        logger.debug('Flight already exists in history (duplicate key)', {
          callsign: callsignNorm,
          icao24: icao24Norm,
          flightKey,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Find flights needing backfill (older than 24h, missing times or aircraft info)
   */
  async findFlightsNeedingBackfill(limit = 20) {
    const query = `
      SELECT id, icao24, callsign, created_at,
             actual_flight_start, actual_flight_end,
             scheduled_flight_start, scheduled_flight_end,
             actual_flight_start, actual_flight_end,
             first_seen, last_seen,
             aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE created_at < NOW() - INTERVAL '24 hours'
        AND (
          (actual_flight_start IS NULL AND first_seen IS NULL AND scheduled_flight_start IS NULL)
          OR (actual_flight_end IS NULL AND last_seen IS NULL AND scheduled_flight_end IS NULL)
          OR aircraft_type IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    return this.db.any(query, [limit]);
  }

  /**
   * Find flights needing backfill within a created_at date range [startDate, endDate]
   * Dates should be strings 'YYYY-MM-DD'
   */
  async findFlightsNeedingBackfillInRange(startDate, endDate, limit = 50) {
    const query = `
      SELECT id, icao24, callsign, created_at,
             actual_flight_start, actual_flight_end,
             scheduled_flight_start, scheduled_flight_end,
             actual_flight_start, actual_flight_end,
             first_seen, last_seen,
             aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE created_at >= $1::date
        AND created_at < ($2::date + INTERVAL '1 day')
        AND (
          (actual_flight_start IS NULL AND first_seen IS NULL AND scheduled_flight_start IS NULL)
          OR (actual_flight_end IS NULL AND last_seen IS NULL AND scheduled_flight_end IS NULL)
          OR aircraft_type IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $3;
    `;
    return this.db.any(query, [startDate, endDate, limit]);
  }

  /**
   * Find flights (last 5 days) with all actual and scheduled fields missing
   */
  async findFlightsMissingAllRecent(limit = 50) {
    const query = `
      SELECT id, icao24, callsign, created_at
      FROM flight_routes_history
      WHERE created_at >= NOW() - INTERVAL '5 days'
        AND (
          actual_flight_start IS NULL
          AND actual_flight_end IS NULL
          AND scheduled_flight_start IS NULL
          AND scheduled_flight_end IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    return this.db.any(query, [limit]);
  }

  /**
   * Update specific fields for a flight history row by id (partial update)
   */
  async updateFlightHistoryById(id, fields) {
    const sets = [];
    const values = [];
    let idx = 1;

    const push = (col, val) => {
      sets.push(`${col} = $${idx}`);
      values.push(val);
      idx += 1;
    };

    // legacy fields removed
    if (fields.flight_key !== undefined) push('flight_key', fields.flight_key);
    if (fields.first_seen !== undefined) push('first_seen', fields.first_seen);
    if (fields.last_seen !== undefined) push('last_seen', fields.last_seen);
    if (fields.scheduled_flight_start !== undefined) push('scheduled_flight_start', fields.scheduled_flight_start);
    if (fields.scheduled_flight_end !== undefined) push('scheduled_flight_end', fields.scheduled_flight_end);
    if (fields.actual_flight_start !== undefined) push('actual_flight_start', fields.actual_flight_start);
    if (fields.actual_flight_end !== undefined) push('actual_flight_end', fields.actual_flight_end);
    if (fields.scheduled_ete !== undefined) push('scheduled_ete', fields.scheduled_ete);
    if (fields.actual_ete !== undefined) push('actual_ete', fields.actual_ete);
    if (fields.aircraft_type !== undefined) push('aircraft_type', fields.aircraft_type);
    if (fields.aircraft_model !== undefined) push('aircraft_model', fields.aircraft_model);
    if (fields.registration !== undefined) push('registration', fields.registration);
    if (fields.flight_status !== undefined) push('flight_status', fields.flight_status);
    if (fields.route !== undefined) push('route', fields.route);
    if (fields.route_distance !== undefined) push('route_distance', fields.route_distance);
    if (fields.baggage_claim !== undefined) push('baggage_claim', fields.baggage_claim);
    if (fields.gate_origin !== undefined) push('gate_origin', fields.gate_origin);
    if (fields.gate_destination !== undefined) push('gate_destination', fields.gate_destination);
    if (fields.terminal_origin !== undefined) push('terminal_origin', fields.terminal_origin);
    if (fields.terminal_destination !== undefined) push('terminal_destination', fields.terminal_destination);
    if (fields.actual_runway_off !== undefined) push('actual_runway_off', fields.actual_runway_off);
    if (fields.actual_runway_on !== undefined) push('actual_runway_on', fields.actual_runway_on);
    if (fields.progress_percent !== undefined) push('progress_percent', fields.progress_percent);
    if (fields.filed_airspeed !== undefined) push('filed_airspeed', fields.filed_airspeed);
    if (fields.blocked !== undefined) push('blocked', fields.blocked);
    if (fields.diverted !== undefined) push('diverted', fields.diverted);
    if (fields.cancelled !== undefined) push('cancelled', fields.cancelled);
    if (fields.departure_delay !== undefined) push('departure_delay', fields.departure_delay);
    if (fields.arrival_delay !== undefined) push('arrival_delay', fields.arrival_delay);

    if (sets.length === 0) return;

    const query = `UPDATE flight_routes_history SET ${sets.join(', ')} WHERE id = $${idx}`;
    values.push(id);
    await this.db.none(query, values);
  }

  /**
   * Get historical routes for an aircraft
   */
  async getHistoricalRoutes(icao24, startDate, endDate, limit = 100) {
    let query = `
      SELECT 
        callsign,
        departure_icao, departure_iata, departure_name,
        arrival_icao, arrival_iata, arrival_name,
        source,
        actual_flight_start, actual_flight_end, first_seen, last_seen,
        created_at
      FROM flight_routes_history
      WHERE icao24 = $1
    `;
    const params = [icao24];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND actual_flight_start >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND actual_flight_end <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY actual_flight_start DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const results = await this.db.query(query, params);

    return results.map((row) => ({
      callsign: row.callsign,
      departureAirport: {
        iata: row.departure_iata,
        icao: row.departure_icao,
        name: row.departure_name,
      },
      arrivalAirport: {
        iata: row.arrival_iata,
        icao: row.arrival_icao,
        name: row.arrival_name,
      },
      flightData: {
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        actualStart: row.actual_flight_start,
        actualEnd: row.actual_flight_end,
      },
      recordedAt: row.created_at,
    }));
  }

  /**
   * Get latest route history for an aircraft (to extract aircraft type/model)
   */
  async getLatestRouteHistory(icao24, callsign) {
    const query = `
      SELECT aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE icao24 = $1
        AND (callsign = $2 OR $2 IS NULL)
        AND (aircraft_type IS NOT NULL OR aircraft_model IS NOT NULL)
      ORDER BY created_at DESC, actual_flight_start DESC
      LIMIT 1
    `;
    
    const result = await this.db.oneOrNone(query, [icao24, callsign]);
    return result;
  }

  /**
   * Get database connection
   */
  getDb() {
    return this.db;
  }

  // ==================== PostGIS Spatial Query Methods ====================

  /**
   * Find aircraft near a point (radius in meters)
   */
  async findAircraftNearPoint(latitude, longitude, radiusMeters = 5000) {
    return this.postgis.findAircraftNearPoint(latitude, longitude, radiusMeters);
  }

  /**
   * Find aircraft within a polygon
   */
  async findAircraftInPolygon(polygonCoordinates) {
    return this.postgis.findAircraftInPolygon(polygonCoordinates);
  }

  /**
   * Get flight path as GeoJSON
   */
  async getFlightPathGeoJSON(icao24, startTime = null, endTime = null) {
    return this.postgis.getFlightPathGeoJSON(icao24, startTime, endTime);
  }

  /**
   * Get traffic density heatmap data
   */
  async getTrafficDensity(bounds, cellSizeDegrees = 0.01) {
    return this.postgis.getTrafficDensity(bounds, cellSizeDegrees);
  }

  /**
   * Find potential plane spotting locations near an airport
   */
  async findSpottingLocations(airportLat, airportLon, radiusKm = 20) {
    return this.postgis.findSpottingLocations(airportLat, airportLon, radiusKm);
  }

  // ==================== Airport Data Query Methods ====================

  /**
   * Find airports near a point
   */
  async findAirportsNearPoint(latitude, longitude, radiusKm = 50, airportType = null) {
    let query = `
      SELECT *,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000 as distance_km
      FROM airports
      WHERE geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
    `;

    const params = [latitude, longitude, radiusKm * 1000];

    if (airportType) {
      query += ' AND type = $4';
      params.push(airportType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    return this.db.query(query, params);
  }

  /**
   * Find airport by IATA or ICAO code (includes runways and frequencies)
   */
  async findAirportByCode(code) {
    const query = `
      SELECT * FROM airports
      WHERE UPPER(iata_code) = UPPER($1)
         OR UPPER(gps_code) = UPPER($1)
         OR UPPER(ident) = UPPER($1)
      LIMIT 1;
    `;
    return this.db.oneOrNone(query, [code]);
  }

  /**
   * Find airports within bounding box (for map viewport)
   */
  async findAirportsInBounds(latmin, lonmin, latmax, lonmax, airportType = null, limit = 100) {
    let query = `
      SELECT
        id,
        airport_id,
        ident,
        type,
        name,
        latitude_deg,
        longitude_deg,
        elevation_ft,
        iso_country,
        iso_region,
        municipality,
        iata_code,
        gps_code,
        runways,
        frequencies,
        ST_X(geom::geometry) as lon,
        ST_Y(geom::geometry) as lat
      FROM airports
      WHERE geom IS NOT NULL
        AND latitude_deg BETWEEN $1 AND $3
        AND longitude_deg BETWEEN $2 AND $4
    `;

    const params = [latmin, lonmin, latmax, lonmax];

    if (airportType) {
      query += ' AND type = $5';
      params.push(airportType);
      query += ' ORDER BY type, name LIMIT $6';
      params.push(limit);
    } else {
      query += ' ORDER BY type, name LIMIT $5';
      params.push(limit);
    }

    return this.db.query(query, params);
  }

  /**
   * Find navaids near a point
   */
  async findNavaidsNearPoint(latitude, longitude, radiusKm = 50, navaidType = null) {
    let query = `
      SELECT *,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000 as distance_km
      FROM navaids
      WHERE geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
    `;

    const params = [latitude, longitude, radiusKm * 1000];

    if (navaidType) {
      query += ' AND type = $4';
      params.push(navaidType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    return this.db.query(query, params);
  }

  /**
   * Search airports by name or code (includes runways and frequencies)
   */
  async searchAirports(searchTerm, limit = 10) {
    const query = `
      SELECT * FROM airports
      WHERE UPPER(name) LIKE UPPER($1)
         OR UPPER(iata_code) LIKE UPPER($1)
         OR UPPER(gps_code) LIKE UPPER($1)
         OR UPPER(ident) LIKE UPPER($1)
         OR UPPER(municipality) LIKE UPPER($1)
      ORDER BY 
        CASE 
          WHEN UPPER(iata_code) = UPPER($2) THEN 1
          WHEN UPPER(ident) = UPPER($2) THEN 2
          WHEN UPPER(gps_code) = UPPER($2) THEN 3
          ELSE 4
        END,
        name
      LIMIT $3;
    `;
    return this.db.query(query, [`%${searchTerm}%`, searchTerm, limit]);
  }

  /**
   * Find recent aircraft that don't have cached route data
   * Used by background job to populate route database
   */
  async findRecentAircraftWithoutRoutes(minLastContact, limit = 10) {
    const query = `
      SELECT DISTINCT ON (a.icao24) 
        a.icao24, 
        a.callsign,
        a.last_contact
      FROM aircraft_states a
      LEFT JOIN flight_routes_cache c ON (c.cache_key = a.callsign OR c.cache_key = a.icao24)
      WHERE a.last_contact > $1
        AND a.callsign IS NOT NULL
        AND a.callsign != ''
        AND a.on_ground = false
        AND a.velocity > 50
        AND (c.cache_key IS NULL OR c.created_at < NOW() - INTERVAL '6 hours')
      ORDER BY a.icao24, a.last_contact DESC
      LIMIT $2;
    `;
    return this.db.query(query, [minLastContact, limit]);
  }

  /**
   * Get statistics for routes: totals and with both dep/arr present
   */
  async getRouteStats() {
    const query = `
      SELECT
        (SELECT COUNT(*) FROM flight_routes_history) as history_total,
        (SELECT COUNT(*) FROM flight_routes_history
         WHERE (departure_icao IS NOT NULL OR departure_iata IS NOT NULL)
           AND (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL)) as history_complete,
        (SELECT COUNT(*) FROM flight_routes_cache) as cache_total,
        (SELECT COUNT(*) FROM flight_routes_cache
         WHERE (departure_icao IS NOT NULL OR departure_iata IS NOT NULL)
           AND (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL)) as cache_complete
    `;
    return this.db.one(query);
  }

  /**
   * Create feeders table
   */
  async createFeedersTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS feeders (
        id SERIAL PRIMARY KEY,
        feeder_id TEXT UNIQUE NOT NULL,
        api_key_hash TEXT NOT NULL,
        name TEXT,
        location GEOGRAPHY(POINT, 4326),
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ,
        CONSTRAINT status_check CHECK (status IN ('active', 'inactive', 'suspended'))
      );

      CREATE INDEX IF NOT EXISTS idx_feeders_status ON feeders(status);
      CREATE INDEX IF NOT EXISTS idx_feeders_location ON feeders USING GIST(location);
      CREATE INDEX IF NOT EXISTS idx_feeders_last_seen ON feeders(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_feeders_feeder_id ON feeders(feeder_id);
    `;
    await this.db.query(query);
    logger.info('Feeders table created or already exists');
  }

  /**
   * Create feeder_stats table
   */
  async createFeederStatsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS feeder_stats (
        id SERIAL PRIMARY KEY,
        feeder_id TEXT NOT NULL REFERENCES feeders(feeder_id) ON DELETE CASCADE,
        date DATE NOT NULL,
        messages_received BIGINT DEFAULT 0,
        unique_aircraft INT DEFAULT 0,
        data_quality_score FLOAT,
        avg_latency_ms FLOAT,
        error_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(feeder_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_feeder_stats_date ON feeder_stats(date);
      CREATE INDEX IF NOT EXISTS idx_feeder_stats_feeder_id ON feeder_stats(feeder_id);
    `;
    await this.db.query(query);
    logger.info('Feeder stats table created or already exists');
  }

  /**
   * Add feeder columns to aircraft_states table
   */
  async addFeederColumnsToAircraftStates() {
    const query = `
      DO $$
      BEGIN
        -- Add data_source column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN data_source TEXT DEFAULT 'opensky';
        END IF;

        -- Add feeder_id column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN feeder_id TEXT REFERENCES feeders(feeder_id);
        END IF;

        -- Add source_priority column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN source_priority INT DEFAULT 10;
        END IF;

        -- Add ingestion_timestamp column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states' AND column_name='ingestion_timestamp'
        ) THEN
          ALTER TABLE aircraft_states ADD COLUMN ingestion_timestamp TIMESTAMPTZ DEFAULT NOW();
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_aircraft_states_feeder_id ON aircraft_states(feeder_id);
      CREATE INDEX IF NOT EXISTS idx_aircraft_states_data_source ON aircraft_states(data_source);
      CREATE INDEX IF NOT EXISTS idx_aircraft_states_source_priority ON aircraft_states(source_priority);
    `;
    await this.db.query(query);
    logger.info('Feeder columns added to aircraft_states table');
  }

  /**
   * Add feeder columns to aircraft_states_history table
   */
  async addFeederColumnsToAircraftStatesHistory() {
    const query = `
      DO $$
      BEGIN
        -- Add data_source column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='data_source'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN data_source TEXT DEFAULT 'opensky';
        END IF;

        -- Add feeder_id column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='feeder_id'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN feeder_id TEXT REFERENCES feeders(feeder_id);
        END IF;

        -- Add source_priority column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='aircraft_states_history' AND column_name='source_priority'
        ) THEN
          ALTER TABLE aircraft_states_history ADD COLUMN source_priority INT DEFAULT 10;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_aircraft_states_history_feeder_id ON aircraft_states_history(feeder_id);
      CREATE INDEX IF NOT EXISTS idx_aircraft_states_history_data_source ON aircraft_states_history(data_source);
    `;
    await this.db.query(query);
    logger.info('Feeder columns added to aircraft_states_history table');
  }

  /**
   * Create users table
   */
  async createUsersTable() {
    // First, create the table if it doesn't exist (without google_id initially for compatibility)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        is_premium BOOLEAN DEFAULT false,
        premium_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `;
    await this.db.query(createTableQuery);
    
    // Now run migrations to add google_id support
    try {
      // Check if google_id column exists
      const columnCheck = await this.db.oneOrNone(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'google_id'
      `);
      
      if (!columnCheck) {
        logger.info('Adding google_id column to users table');
        // Make password nullable first (in case it's NOT NULL)
        await this.db.query(`
          ALTER TABLE users 
          ALTER COLUMN password DROP NOT NULL;
        `);
        
        // Add google_id column
        await this.db.query(`
          ALTER TABLE users 
          ADD COLUMN google_id TEXT UNIQUE;
        `);
        
        // Create index
        await this.db.query(`
          CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
        `);
        
        // Add constraint
        await this.db.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'password_or_google'
            ) THEN
              ALTER TABLE users ADD CONSTRAINT password_or_google 
              CHECK (password IS NOT NULL OR google_id IS NOT NULL);
            END IF;
          END $$;
        `);
        
        logger.info('Successfully migrated users table to support Google OAuth');
      } else {
        logger.info('Users table already has google_id column');
      }
    } catch (error) {
      logger.error('Error migrating users table for Google OAuth', { error: error.message });
      // Don't throw - allow server to continue, but log the error
      // The migration can be run manually if needed
    }
    
    logger.info('Users table created or already exists');
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    return this.db.oneOrNone(query, [email]);
  }

  /**
   * Get user by Google ID
   */
  async getUserByGoogleId(googleId) {
    const query = 'SELECT * FROM users WHERE google_id = $1';
    return this.db.oneOrNone(query, [googleId]);
  }

  /**
   * Get user by ID
   */
  async getUserById(id) {
    const query = 'SELECT id, email, name, is_premium, premium_expires_at, created_at FROM users WHERE id = $1';
    return this.db.oneOrNone(query, [id]);
  }

  /**
   * Create new user
   */
  async createUser(userData) {
    const { email, password, name, isPremium, googleId } = userData;
    const query = `
      INSERT INTO users (email, password, name, is_premium, google_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, name, is_premium, created_at
    `;
    return this.db.one(query, [email, password || null, name, isPremium || false, googleId || null]);
  }

  /**
   * Create or update user from Google OAuth
   */
  async createOrUpdateGoogleUser(googleProfile) {
    const { id: googleId, email, name, picture } = googleProfile;
    
    // Check if user exists by Google ID
    let user = await this.getUserByGoogleId(googleId);
    
    if (user) {
      // Update existing user
      const query = `
        UPDATE users 
        SET email = $1, name = $2, updated_at = CURRENT_TIMESTAMP
        WHERE google_id = $3
        RETURNING id, email, name, is_premium, created_at
      `;
      return this.db.one(query, [email, name, googleId]);
    }
    
    // Check if user exists by email (account linking)
    user = await this.getUserByEmail(email);
    if (user) {
      // Link Google account to existing user
      const query = `
        UPDATE users 
        SET google_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE email = $2
        RETURNING id, email, name, is_premium, created_at
      `;
      return this.db.one(query, [googleId, email]);
    }
    
    // Create new user
    return this.createUser({
      email,
      name,
      googleId,
      isPremium: false,
    });
  }

  /**
   * Update user premium status
   */
  async updateUserPremiumStatus(userId, isPremium, expiresAt = null) {
    const query = `
      UPDATE users 
      SET is_premium = $1, premium_expires_at = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, email, name, is_premium, premium_expires_at
    `;
    return this.db.one(query, [isPremium, expiresAt, userId]);
  }

  /**
   * Get feeder by feeder_id
   */
  async getFeederById(feederId) {
    const query = `
      SELECT * FROM feeders WHERE feeder_id = $1
    `;
    return this.db.oneOrNone(query, [feederId]);
  }

  /**
   * Register a new feeder
   */
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

  /**
   * Update feeder last seen timestamp
   */
  async updateFeederLastSeen(feederId) {
    const query = `
      UPDATE feeders
      SET last_seen_at = NOW()
      WHERE feeder_id = $1
    `;
    await this.db.query(query, [feederId]);
  }

  /**
   * Upsert feeder statistics
   */
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

  /**
   * Get feeder by API key (validates the key hash)
   * @param {string} apiKey - The API key to validate
   * @returns {Promise<Object|null>} Feeder data or null if not found/invalid
   */
  async getFeederByApiKey(apiKey) {
    try {
      const bcrypt = require('bcryptjs');
      
      // Get all active feeders (you may want to optimize this with an index)
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

  /**
   * Upsert aircraft state with priority-based logic
   * Only updates if new priority is higher or equal to existing priority
   */
  async upsertAircraftStateWithPriority(state, feederId, ingestionTimestamp, dataSource = 'opensky', sourcePriority = 30) {
    // Insert into history first
    // Priority: Lower number = higher priority
    // Feeder: 10 (high priority - local data, don't overwrite)
    // OpenSky: 30 (default, lower priority - can be overridden by feeder)
    const historyState = [
      state[0], state[1], state[2], state[3], state[4],
      state[5], state[6], state[7], state[8], state[9],
      state[10], state[11], state[12], state[13], state[14],
      state[15], state[16], state[17],
      dataSource, // data_source
      feederId, // feeder_id
      sourcePriority, // source_priority
    ];

    const insertHistoryQuery = `
      INSERT INTO aircraft_states_history (
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, data_source, feeder_id, source_priority
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21);
    `;
    await this.db.query(insertHistoryQuery, historyState);

    // Main table upsert with priority check and smart merge for incomplete data
    // Strategy:
    // 1. Higher priority sources (lower number) can overwrite position data
    // 2. BUT: If higher priority data is incomplete (missing callsign, etc.), preserve complete data from lower priority
    // 3. Once we have complete data, prevent incomplete data from overwriting it
    // 4. STALENESS CHECK: If existing data is >10 minutes old, allow fresher data from ANY source (regardless of priority)
    //    This ensures we don't get stuck with stale high-priority data when fresh low-priority data is available
    const upsertQuery = `
      INSERT INTO aircraft_states(
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, created_at, data_source, feeder_id, source_priority, ingestion_timestamp
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT(icao24) DO UPDATE SET
        -- Smart merge for callsign: Always use non-empty callsign regardless of priority
        -- This ensures OpenSky's callsign can fill in gaps from incomplete feeder data
        -- Priority doesn't matter for callsign - complete data always wins
        callsign = CASE
          WHEN NULLIF(TRIM(EXCLUDED.callsign), '') IS NOT NULL THEN TRIM(EXCLUDED.callsign)
          WHEN aircraft_states.callsign IS NOT NULL AND NULLIF(TRIM(aircraft_states.callsign), '') IS NOT NULL THEN aircraft_states.callsign
          ELSE NULL
        END,
        -- Position data: Update if higher priority OR if existing data is stale (>10 minutes)
        -- This ensures we get fresh data even from lower-priority sources when high-priority sources go silent
        origin_country = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.origin_country
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.origin_country
          ELSE aircraft_states.origin_country 
        END,
        time_position = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.time_position IS NOT NULL THEN EXCLUDED.time_position
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.time_position IS NULL THEN aircraft_states.time_position
          ELSE aircraft_states.time_position
        END,
        last_contact = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.last_contact IS NOT NULL THEN EXCLUDED.last_contact
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.last_contact IS NULL THEN aircraft_states.last_contact
          ELSE aircraft_states.last_contact
        END,
        longitude = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.longitude IS NOT NULL THEN EXCLUDED.longitude
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.longitude IS NULL THEN aircraft_states.longitude
          ELSE aircraft_states.longitude
        END,
        latitude = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.latitude IS NOT NULL THEN EXCLUDED.latitude
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.latitude IS NULL THEN aircraft_states.latitude
          ELSE aircraft_states.latitude
        END,
        baro_altitude = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.baro_altitude IS NOT NULL THEN EXCLUDED.baro_altitude
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.baro_altitude IS NULL THEN aircraft_states.baro_altitude
          ELSE aircraft_states.baro_altitude
        END,
        on_ground = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.on_ground
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.on_ground
          ELSE aircraft_states.on_ground 
        END,
        velocity = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.velocity IS NOT NULL THEN EXCLUDED.velocity
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.velocity IS NULL THEN aircraft_states.velocity
          ELSE aircraft_states.velocity
        END,
        true_track = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.true_track IS NOT NULL THEN EXCLUDED.true_track
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.true_track IS NULL THEN aircraft_states.true_track
          ELSE aircraft_states.true_track
        END,
        vertical_rate = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.vertical_rate IS NOT NULL THEN EXCLUDED.vertical_rate
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.vertical_rate IS NULL THEN aircraft_states.vertical_rate
          ELSE aircraft_states.vertical_rate
        END,
        sensors = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.sensors
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.sensors
          ELSE aircraft_states.sensors 
        END,
        geo_altitude = CASE
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.geo_altitude IS NOT NULL THEN EXCLUDED.geo_altitude
          WHEN (EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600) AND EXCLUDED.geo_altitude IS NULL THEN aircraft_states.geo_altitude
          ELSE aircraft_states.geo_altitude
        END,
        -- Smart merge for squawk: Preserve complete data even from lower priority
        squawk = CASE
          WHEN NULLIF(EXCLUDED.squawk, '') IS NOT NULL THEN EXCLUDED.squawk
          WHEN aircraft_states.squawk IS NOT NULL AND NULLIF(aircraft_states.squawk, '') IS NOT NULL THEN aircraft_states.squawk
          ELSE NULL
        END,
        spi = CASE WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.spi ELSE aircraft_states.spi END,
        position_source = CASE WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.position_source ELSE aircraft_states.position_source END,
        -- Smart merge for category: Preserve complete data
        category = CASE
          WHEN EXCLUDED.category IS NOT NULL AND EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.category
          WHEN aircraft_states.category IS NOT NULL THEN aircraft_states.category
          ELSE EXCLUDED.category
        END,
        -- Metadata: Update if higher priority OR existing data is stale
        data_source = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.data_source
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.data_source
          ELSE aircraft_states.data_source 
        END,
        feeder_id = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.feeder_id
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.feeder_id
          ELSE aircraft_states.feeder_id 
        END,
        source_priority = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.source_priority
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.source_priority
          ELSE aircraft_states.source_priority 
        END,
        ingestion_timestamp = CASE 
          WHEN EXCLUDED.source_priority <= COALESCE(aircraft_states.source_priority, 99) THEN EXCLUDED.ingestion_timestamp
          WHEN (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600 THEN EXCLUDED.ingestion_timestamp
          ELSE aircraft_states.ingestion_timestamp 
        END;
    `;

    const stateArray = [
      state[0], state[1], state[2], state[3], state[4],
      state[5], state[6], state[7], state[8], state[9],
      state[10], state[11], state[12], state[13], state[14],
      state[15], state[16], state[17],
      state[18] ? new Date(state[18]) : new Date(), // created_at
      dataSource, // data_source
      feederId, // feeder_id
      sourcePriority, // source_priority
      ingestionTimestamp, // ingestion_timestamp
    ];

    await this.db.query(upsertQuery, stateArray);
  }

  /**
   * ============================================
   * API KEY MANAGEMENT (MVP)
   * ============================================
   */

  /**
   * Create a new API key
   * @param {object} data - API key data
   * @param {string} data.keyHash - Bcrypt hash of the API key
   * @param {string} data.prefix - Key prefix (sk_dev_ or sk_live_)
   * @param {string} data.name - Human-readable name
   * @param {string} data.description - Optional description
   * @param {number} data.userId - Optional user ID
   * @param {array} data.scopes - Optional scopes array
   * @param {number} data.createdBy - Optional creator user ID
   * @param {Date} data.expiresAt - Optional expiration date
   * @returns {Promise<object>} - Created API key record
   */
  async createApiKey(data) {
    const {
      keyHash,
      prefix,
      name,
      description = null,
      userId = null,
      scopes = ['read'],
      createdBy = null,
      expiresAt = null,
    } = data;

    const query = `
      INSERT INTO api_keys(
        key_hash, key_prefix, name, description,
        user_id, scopes, created_by, expires_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING 
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by;
    `;

    const result = await this.db.one(query, [
      keyHash,
      prefix,
      name,
      description,
      userId,
      scopes,
      createdBy,
      expiresAt,
    ]);

    logger.info('API key created', {
      keyId: result.key_id,
      name: result.name,
      prefix: result.key_prefix,
      userId: result.user_id,
    });

    return result;
  }

  /**
   * Get API key by hash (for authentication)
   * @param {string} keyHash - Bcrypt hash to search for
   * @returns {Promise<object|null>} - API key record or null
   */
  async getApiKeyByHash(keyHash) {
    const query = `
      SELECT 
        id, key_id, key_hash, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      WHERE key_hash = $1
        AND status = 'active';
    `;

    return this.db.oneOrNone(query, [keyHash]);
  }

  /**
   * Validate API key and check status
   * @param {string} plainKey - Plain text API key
   * @returns {Promise<object|null>} - API key record if valid, null otherwise
   */
  async validateApiKey(plainKey) {
    try {
      const bcrypt = require('bcryptjs');

      // Get all active keys (in MVP, this is acceptable; can optimize later with key_id lookup)
      const query = `
        SELECT 
          id, key_id, key_hash, key_prefix, name, description,
          user_id, scopes, status, last_used_at, usage_count,
          created_at, updated_at, expires_at
        FROM api_keys
        WHERE status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);
      `;

      const keys = await this.db.manyOrNone(query);

      // Check each key hash (bcrypt compare)
      for (const key of keys) {
        const isValid = await bcrypt.compare(plainKey, key.key_hash);
        if (isValid) {
          // Update last used (fire and forget)
          this.updateApiKeyLastUsed(key.id).catch((err) => {
            logger.warn('Failed to update API key last_used_at', {
              keyId: key.key_id,
              error: err.message,
            });
          });

          return key;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error validating API key', { error: error.message });
      throw error;
    }
  }

  /**
   * Get API key by key_id
   * @param {string} keyId - UUID key_id
   * @returns {Promise<object|null>} - API key record or null
   */
  async getApiKeyById(keyId) {
    const query = `
      SELECT 
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      WHERE key_id = $1;
    `;

    return this.db.oneOrNone(query, [keyId]);
  }

  /**
   * List API keys with optional filters
   * @param {object} filters - Optional filters
   * @param {number} filters.userId - Filter by user_id
   * @param {string} filters.status - Filter by status
   * @param {string} filters.keyPrefix - Filter by key_prefix
   * @param {number} filters.limit - Limit results (default: 100)
   * @param {number} filters.offset - Offset for pagination (default: 0)
   * @returns {Promise<array>} - Array of API key records
   */
  async listApiKeys(filters = {}) {
    const {
      userId = null,
      status = null,
      keyPrefix = null,
      limit = 100,
      offset = 0,
    } = filters;

    let whereClause = [];
    let params = [];
    let paramIndex = 1;

    if (userId !== null) {
      whereClause.push(`user_id = $${paramIndex++}`);
      params.push(userId);
    }

    if (status !== null) {
      whereClause.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (keyPrefix !== null) {
      whereClause.push(`key_prefix = $${paramIndex++}`);
      params.push(keyPrefix);
    }

    const query = `
      SELECT 
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      ${whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex};
    `;

    params.push(limit, offset);

    return this.db.manyOrNone(query, params);
  }

  /**
   * Update API key last_used_at and increment usage_count
   * @param {number} id - API key ID
   * @returns {Promise<void>}
   */
  async updateApiKeyLastUsed(id) {
    const query = `
      UPDATE api_keys
      SET 
        last_used_at = CURRENT_TIMESTAMP,
        usage_count = usage_count + 1
      WHERE id = $1;
    `;

    await this.db.query(query, [id]);
  }

  /**
   * Revoke an API key
   * @param {string} keyId - UUID key_id
   * @param {number} revokedBy - User ID who revoked the key
   * @param {string} reason - Reason for revocation
   * @returns {Promise<object>} - Updated API key record
   */
  async revokeApiKey(keyId, revokedBy = null, reason = null) {
    const query = `
      UPDATE api_keys
      SET 
        status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        revoked_by = $2,
        revoked_reason = $3
      WHERE key_id = $1
      RETURNING 
        id, key_id, key_prefix, name, status,
        revoked_at, revoked_by, revoked_reason;
    `;

    const result = await this.db.one(query, [keyId, revokedBy, reason]);

    logger.info('API key revoked', {
      keyId: result.key_id,
      name: result.name,
      revokedBy: result.revoked_by,
      reason: result.revoked_reason,
    });

    return result;
  }

  /**
   * Update API key metadata
   * @param {string} keyId - UUID key_id
   * @param {object} updates - Fields to update
   * @param {string} updates.name - New name
   * @param {string} updates.description - New description
   * @param {array} updates.scopes - New scopes
   * @returns {Promise<object>} - Updated API key record
   */
  async updateApiKey(keyId, updates) {
    const { name, description, scopes } = updates;

    const fields = [];
    const params = [];
    let paramIndex = 2; // Start at 2 because $1 is keyId

    if (name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      params.push(name);
    }

    if (description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      params.push(description);
    }

    if (scopes !== undefined) {
      fields.push(`scopes = $${paramIndex++}`);
      params.push(scopes);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    const query = `
      UPDATE api_keys
      SET ${fields.join(', ')}
      WHERE key_id = $1
      RETURNING 
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at;
    `;

    const result = await this.db.one(query, [keyId, ...params]);

    logger.info('API key updated', {
      keyId: result.key_id,
      name: result.name,
      updates: Object.keys(updates),
    });

    return result;
  }
}

module.exports = new PostgresRepository();
