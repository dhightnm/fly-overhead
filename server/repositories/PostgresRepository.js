const pgp = require('pg-promise')();
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Repository pattern for PostgreSQL data access
 * Encapsulates all database queries
 */
class PostgresRepository {
  constructor() {
    const connectionString = config.database.postgres.url;
    this.db = pgp(connectionString);
    this.initConnection();
  }

  initConnection() {
    this.db.connect()
      .then((obj) => {
        logger.info('Database connection established');
        obj.done();
      })
      .catch((error) => {
        logger.error('Database connection error', { error });
        process.exit(1);
      });
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
    const query = `
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_routes_cache_key ON flight_routes_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_routes_icao24 ON flight_routes_cache(icao24);
      CREATE INDEX IF NOT EXISTS idx_routes_callsign ON flight_routes_cache(callsign);
    `;
    await this.db.query(query);
    logger.info('Flight routes cache table created or already exists');
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
    const query = 'SELECT * FROM aircraft_states WHERE LOWER(icao24) = LOWER($1) OR LOWER(callsign) = LOWER($1)';
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
      query += ` AND created_at >= $2`;
      params.push(startTime);
      if (endTime) {
        query += ` AND created_at <= $3`;
        params.push(endTime);
      }
    } else if (endTime) {
      query += ` AND created_at <= $2`;
      params.push(endTime);
    }

    query += ` ORDER BY created_at ASC`;
    
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

    query += ` ORDER BY created_at ASC`;
    
    const results = await this.db.any(query, params);
    return results;
  }

  /**
   * Cache flight route information
   */
  async cacheRoute(cacheKey, routeData) {
    const query = `
      INSERT INTO flight_routes_cache (
        cache_key, callsign, icao24,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (cache_key) DO UPDATE SET
        last_used = CURRENT_TIMESTAMP,
        departure_iata = EXCLUDED.departure_iata,
        departure_icao = EXCLUDED.departure_icao,
        departure_name = EXCLUDED.departure_name,
        arrival_iata = EXCLUDED.arrival_iata,
        arrival_icao = EXCLUDED.arrival_icao,
        arrival_name = EXCLUDED.arrival_name;
    `;

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
    ]);
  }

  /**
   * Get cached route information
   */
  async getCachedRoute(cacheKey) {
    const query = `
      SELECT 
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name
      FROM flight_routes_cache
      WHERE cache_key = $1
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
    };
  }

  /**
   * Get database connection
   */
  getDb() {
    return this.db;
  }
}

module.exports = new PostgresRepository();
