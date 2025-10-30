const pgp = require('pg-promise')();
const config = require('../config');
const logger = require('../utils/logger');
const PostGISService = require('../services/PostGISService');

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
      END $$;
      
      CREATE INDEX IF NOT EXISTS idx_routes_cache_key ON flight_routes_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_routes_icao24 ON flight_routes_cache(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_callsign ON flight_routes_cache(callsign);
    `;
    await this.db.query(cacheQuery);

    // History table: Stores ALL routes with timestamps (historical tracking)
    const historyQuery = `
      CREATE TABLE IF NOT EXISTS flight_routes_history (
        id SERIAL PRIMARY KEY,
        callsign TEXT,
        icao24 TEXT,
        departure_iata TEXT,
        departure_icao TEXT,
        departure_name TEXT,
        arrival_iata TEXT,
        arrival_icao TEXT,
        arrival_name TEXT,
        source TEXT,
        flight_start TIMESTAMPTZ,
        flight_end TIMESTAMPTZ,
        first_seen BIGINT,
        last_seen BIGINT,
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
      
      CREATE INDEX IF NOT EXISTS idx_routes_history_icao24 ON flight_routes_history(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_history_callsign ON flight_routes_history(callsign);
      CREATE INDEX IF NOT EXISTS idx_routes_history_dates ON flight_routes_history(flight_start, flight_end);
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
   */
  async findAircraftInBounds(latmin, lonmin, latmax, lonmax, recentContactThreshold) {
    const query = `
      SELECT * 
      FROM aircraft_states
      WHERE last_contact >= $1
        AND latitude BETWEEN $2 AND $3
        AND longitude BETWEEN $4 AND $5
    `;
    return this.db.manyOrNone(query, [recentContactThreshold, latmin, latmax, lonmin, lonmax]);
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
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (cache_key) DO UPDATE SET
          last_used = CURRENT_TIMESTAMP,
          departure_iata = EXCLUDED.departure_iata,
          departure_icao = EXCLUDED.departure_icao,
          departure_name = EXCLUDED.departure_name,
          arrival_iata = EXCLUDED.arrival_iata,
          arrival_icao = EXCLUDED.arrival_icao,
          arrival_name = EXCLUDED.arrival_name,
          source = EXCLUDED.source;
      `;

      const sourceValue = routeData.source || null;
      logger.info('About to insert route with source value', {
        cacheKey,
        sourceValue,
        sourceType: typeof sourceValue,
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
      ]);

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
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
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

  /**
   * Store route in history table (stores ALL routes for historical tracking)
   */
  async storeRouteHistory(routeData) {
    const query = `
      INSERT INTO flight_routes_history (
        callsign, icao24,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        flight_start, flight_end, first_seen, last_seen
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (icao24, callsign, first_seen, last_seen) DO NOTHING;
    `;

    const flightStart = routeData.flightData?.firstSeen
      ? new Date(routeData.flightData.firstSeen * 1000)
      : null;
    const flightEnd = routeData.flightData?.lastSeen
      ? new Date(routeData.flightData.lastSeen * 1000)
      : null;

    await this.db.query(query, [
      routeData.callsign || null,
      routeData.icao24 || null,
      routeData.departureAirport?.iata || null,
      routeData.departureAirport?.icao || null,
      routeData.departureAirport?.name || null,
      routeData.arrivalAirport?.iata || null,
      routeData.arrivalAirport?.icao || null,
      routeData.arrivalAirport?.name || null,
      routeData.source || null,
      flightStart,
      flightEnd,
      routeData.flightData?.firstSeen || null,
      routeData.flightData?.lastSeen || null,
    ]);
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
        flight_start, flight_end, first_seen, last_seen,
        created_at
      FROM flight_routes_history
      WHERE icao24 = $1
    `;
    const params = [icao24];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND flight_start >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND flight_end <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY flight_start DESC LIMIT $${paramIndex}`;
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
        flightStart: row.flight_start,
        flightEnd: row.flight_end,
      },
      recordedAt: row.created_at,
    }));
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
  async findRecentAircraftWithoutRoutes(limit = 10, minLastContact) {
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
}

module.exports = new PostgresRepository();
