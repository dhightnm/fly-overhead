// Note: logger and mapAircraftType may be needed when extracting more methods

/**
 * Repository for aircraft states and history operations
 */
class AircraftRepository {
  constructor(db, postgis) {
    this.db = db;
    this.postgis = postgis;
  }

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

  async findAircraftInBounds(latmin, lonmin, latmax, lonmax, recentContactThreshold) {
    // Optimized query with LIMIT to prevent timeouts on large result sets
    // Uses PostGIS spatial index for fast bounding box queries
    // Uses LATERAL join for efficient cache lookups (only queries cache for matching aircraft)
    // LIMIT of 1000 aircraft prevents timeouts on large datasets
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
      FROM (
        SELECT *
        FROM aircraft_states
        WHERE last_contact >= $1
          AND (
            -- Use PostGIS spatial query when geom is available (preferred, uses spatial index)
            (geom IS NOT NULL 
             AND ST_Contains(
               ST_MakeEnvelope($4, $2, $5, $3, 4326), -- lonmin, latmin, lonmax, latmax
               geom
             ))
            OR
            -- Fallback to BETWEEN when geom is NULL (backwards compatibility)
            (geom IS NULL
             AND latitude BETWEEN $2 AND $3
             AND longitude BETWEEN $4 AND $5)
          )
        ORDER BY last_contact DESC
        LIMIT 1000
      ) a
      LEFT JOIN LATERAL (
        SELECT 
          departure_iata,
          departure_icao,
          departure_name,
          arrival_iata,
          arrival_icao,
          arrival_name,
          aircraft_type,
          source,
          created_at
        FROM (
          SELECT 
            departure_iata,
            departure_icao,
            departure_name,
            arrival_iata,
            arrival_icao,
            arrival_name,
            aircraft_type,
            source,
            created_at
          FROM flight_routes_cache
          WHERE cache_key = a.icao24
          UNION ALL
          SELECT 
            departure_iata,
            departure_icao,
            departure_name,
            arrival_iata,
            arrival_icao,
            arrival_name,
            aircraft_type,
            source,
            created_at
          FROM flight_routes_cache
          WHERE cache_key = a.callsign 
            AND a.callsign IS NOT NULL 
            AND a.callsign != ''
        ) combined
        ORDER BY created_at DESC
        LIMIT 1
      ) c ON true
      ORDER BY a.last_contact DESC
    `;
    return this.db.manyOrNone(query, [recentContactThreshold, latmin, latmax, lonmin, lonmax]);
  }

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

  async findMultipleAircraftHistory(icao24s, startTime = null, endTime = null) {
    let query = `
      SELECT * FROM aircraft_states_history 
      WHERE icao24 = ANY($1)
    `;
    const params = [icao24s];

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

    query += ' ORDER BY icao24, created_at ASC';

    const results = await this.db.any(query, params);
    return results;
  }

  async findRecentAircraftWithoutRoutes(minLastContact, limit = 10) {
    const query = `
      SELECT a.*
      FROM aircraft_states a
      LEFT JOIN flight_routes_cache c ON (
        c.cache_key = a.icao24 
        OR (a.callsign IS NOT NULL AND a.callsign != '' AND c.cache_key = a.callsign)
      )
      WHERE a.last_contact >= $1
        AND c.id IS NULL
      ORDER BY a.last_contact DESC
      LIMIT $2
    `;
    return this.db.any(query, [minLastContact, limit]);
  }

  // This method is complex and references routeRepository - keeping it here for now
  // but it could be moved to a service layer
  async upsertAircraftStateWithPriority(state, feederId, ingestionTimestamp, dataSource = 'opensky', sourcePriority = 30) {
    // Extract from old implementation - keeping for now
    // TODO: Refactor to use RouteRepository
    const historyState = [
      state[0], state[1], state[2], state[3], state[4],
      state[5], state[6], state[7], state[8], state[9],
      state[10], state[11], state[12], state[13], state[14],
      state[15], state[16], state[17], feederId, ingestionTimestamp, dataSource, sourcePriority,
    ];

    const insertHistoryQuery = `
      INSERT INTO aircraft_states_history (
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, feeder_id, ingestion_timestamp, data_source, source_priority
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22);
    `;
    await this.db.query(insertHistoryQuery, historyState);

    // Main table upsert with priority handling
    const upsertQuery = `
      INSERT INTO aircraft_states(
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, created_at, feeder_id, ingestion_timestamp, data_source, source_priority
      )
      VALUES($1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT(icao24) DO UPDATE SET
        callsign = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN TRIM(EXCLUDED.callsign)
          ELSE aircraft_states.callsign
        END,
        origin_country = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.origin_country
          ELSE aircraft_states.origin_country
        END,
        time_position = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.time_position
          ELSE aircraft_states.time_position
        END,
        last_contact = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.last_contact
          ELSE aircraft_states.last_contact
        END,
        longitude = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.longitude
          ELSE aircraft_states.longitude
        END,
        latitude = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.latitude
          ELSE aircraft_states.latitude
        END,
        baro_altitude = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.baro_altitude
          ELSE aircraft_states.baro_altitude
        END,
        on_ground = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.on_ground
          ELSE aircraft_states.on_ground
        END,
        velocity = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.velocity
          ELSE aircraft_states.velocity
        END,
        true_track = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.true_track
          ELSE aircraft_states.true_track
        END,
        vertical_rate = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.vertical_rate
          ELSE aircraft_states.vertical_rate
        END,
        sensors = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.sensors
          ELSE aircraft_states.sensors
        END,
        geo_altitude = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.geo_altitude
          ELSE aircraft_states.geo_altitude
        END,
        squawk = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.squawk
          ELSE aircraft_states.squawk
        END,
        spi = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.spi
          ELSE aircraft_states.spi
        END,
        position_source = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.position_source
          ELSE aircraft_states.position_source
        END,
        category = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.category
          ELSE aircraft_states.category
        END,
        feeder_id = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.feeder_id
          ELSE aircraft_states.feeder_id
        END,
        ingestion_timestamp = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.ingestion_timestamp
          ELSE aircraft_states.ingestion_timestamp
        END,
        data_source = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.data_source
          ELSE aircraft_states.data_source
        END,
        source_priority = CASE 
          WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
            OR (EXCLUDED.source_priority = aircraft_states.source_priority AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
          THEN EXCLUDED.source_priority
          ELSE aircraft_states.source_priority
        END;
    `;
    await this.db.query(upsertQuery, [
      state[0], state[1], state[2], state[3], state[4],
      state[5], state[6], state[7], state[8], state[9],
      state[10], state[11], state[12], state[13], state[14],
      state[15], state[16], state[17], state[18],
      feederId, ingestionTimestamp, dataSource, sourcePriority,
    ]);
  }
}

module.exports = AircraftRepository;
