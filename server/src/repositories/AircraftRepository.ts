import pgPromise from 'pg-promise';
import type { AircraftState } from '../types/database.types';
import PostGISService from '../services/PostGISService';
import logger from '../utils/logger';

/**
 * Aircraft state array format from OpenSky API + enriched data:
 * [0] icao24, [1] callsign, [2] origin_country, [3] time_position, [4] last_contact,
 * [5] longitude, [6] latitude, [7] baro_altitude, [8] on_ground, [9] velocity,
 * [10] true_track, [11] vertical_rate, [12] sensors, [13] geo_altitude, [14] squawk,
 * [15] spi, [16] position_source, [17] category, [18] created_at (optional)
 * Enriched fields (optional, from airplanes.live):
 * [19] aircraft_type, [20] aircraft_description, [21] registration, [22] emergency_status,
 * [23] nav_qnh, [24] nav_altitude_mcp, [25] nav_heading, [26] owner_operator, [27] year_built
 */
type AircraftStateArray = any[];

/**
 * Repository for aircraft states and history operations
 */
class AircraftRepository {
  private db: pgPromise.IDatabase<any>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore - postgis reserved for future use
  private _postgis: PostGISService;

  constructor(db: pgPromise.IDatabase<any>, postgis: PostGISService) {
    this.db = db;
    this._postgis = postgis;
  }

  async upsertAircraftState(state: AircraftStateArray): Promise<void> {
    // History insert (no created_at needed, has DEFAULT)
    const historyState = [
      state[0],
      state[1],
      state[2],
      state[3],
      state[4],
      state[5],
      state[6],
      state[7],
      state[8],
      state[9],
      state[10],
      state[11],
      state[12],
      state[13],
      state[14],
      state[15],
      state[16],
      state[17],
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

  async findAircraftByIdentifier(identifier: string): Promise<AircraftState[]> {
    const query = `
      SELECT *
      FROM aircraft_states
      WHERE LOWER(icao24) = LOWER($1)
         OR LOWER(callsign) = LOWER($1)
      ORDER BY last_contact DESC NULLS LAST, created_at DESC
    `;
    const results = await this.db.any<AircraftState>(query, [identifier.trim()]);
    return results;
  }

  async findAircraftInBounds(
    latmin: number,
    lonmin: number,
    latmax: number,
    lonmax: number,
    recentContactThreshold: number,
  ): Promise<any[]> {
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

  async updateAircraftCategory(icao24: string, category: number | null): Promise<void> {
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

  async updateAircraftCallsign(icao24: string, callsign: string | null): Promise<void> {
    if (!icao24 || !callsign) {
      return;
    }
    const query = `
      UPDATE aircraft_states
      SET callsign = TRIM($1)
      WHERE icao24 = $2
        AND (callsign IS NULL OR callsign = '')
    `;
    await this.db.query(query, [callsign, icao24]);
  }

  async findAircraftHistory(
    icao24: string,
    startTime: Date | null = null,
    endTime: Date | null = null,
  ): Promise<AircraftState[]> {
    let query = `
      SELECT * FROM aircraft_states_history 
      WHERE icao24 = $1
    `;
    const params: any[] = [icao24];

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

    const results = await this.db.any<AircraftState>(query, params);
    return results;
  }

  async findMultipleAircraftHistory(
    icao24s: string[],
    startTime: Date | null = null,
    endTime: Date | null = null,
  ): Promise<AircraftState[]> {
    let query = `
      SELECT * FROM aircraft_states_history 
      WHERE icao24 = ANY($1)
    `;
    const params: any[] = [icao24s];

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

    const results = await this.db.any<AircraftState>(query, params);
    return results;
  }

  async findRecentAircraftWithoutRoutes(minLastContact: number, limit: number = 10): Promise<AircraftState[]> {
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
    return this.db.any<AircraftState>(query, [minLastContact, limit]);
  }

  // This method is complex and references routeRepository - keeping it here for now
  // but it could be moved to a service layer
  async upsertAircraftStateWithPriority(
    state: AircraftStateArray,
    feederId: string | null,
    ingestionTimestamp: Date | null,
    dataSource: string = 'opensky',
    sourcePriority: number = 30,
    skipHistory: boolean = false, // Skip history writes for background polling to prevent disk fill
  ): Promise<void> {
    // Extract from old implementation - keeping for now
    // TODO: Refactor to use RouteRepository
    // Enriched fields: indices 19-27 from airplanes.live (optional)
    const aircraftType = state[19] || null;
    const aircraftDescription = state[20] || null;
    const registration = state[21] || null;
    const emergencyStatus = state[22] || null;
    const navQnh = state[23] || null;
    const navAltitudeMcp = state[24] || null;
    const navHeading = state[25] || null;
    const ownerOperator = state[26] || null;
    const yearBuilt = state[27] || null;

    // Only write history if not skipped (skip for background polling)
    if (!skipHistory) {
      const historyState = [
        state[0],
        state[1],
        state[2],
        state[3],
        state[4],
        state[5],
        state[6],
        state[7],
        state[8],
        state[9],
        state[10],
        state[11],
        state[12],
        state[13],
        state[14],
        state[15],
        state[16],
        state[17],
        feederId,
        ingestionTimestamp,
        dataSource,
        sourcePriority,
        aircraftType,
        aircraftDescription,
        registration,
        emergencyStatus,
        navQnh,
        navAltitudeMcp,
        navHeading,
        ownerOperator,
        yearBuilt,
      ];

      const insertHistoryQuery = `
        INSERT INTO aircraft_states_history (
          icao24, callsign, origin_country, time_position, last_contact,
          longitude, latitude, baro_altitude, on_ground, velocity,
          true_track, vertical_rate, sensors, geo_altitude, squawk,
          spi, position_source, category, feeder_id, ingestion_timestamp, data_source, source_priority,
          aircraft_type, aircraft_description, registration, emergency_status,
          nav_qnh, nav_altitude_mcp, nav_heading, owner_operator, year_built
        )
        VALUES(
          $1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          $23, $24, $25, $26, $27, $28, $29, $30, $31
        );
      `;
      await this.db.query(insertHistoryQuery, historyState);

      const insertRawQuery = `
        INSERT INTO aircraft_states_raw (
          icao24, callsign, origin_country, time_position, last_contact,
          longitude, latitude, baro_altitude, on_ground, velocity,
          true_track, vertical_rate, sensors, geo_altitude, squawk,
          spi, position_source, category, feeder_id, ingestion_timestamp, data_source, source_priority,
          aircraft_type, aircraft_description, registration, emergency_status,
          nav_qnh, nav_altitude_mcp, nav_heading, owner_operator, year_built, created_at
        )
        VALUES(
          $1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
        );
      `;
      const lastContactSeconds = typeof state[4] === 'number'
        ? state[4] as number
        : null;
      const rawCreatedAt = ingestionTimestamp
        || (lastContactSeconds ? new Date(lastContactSeconds * 1000) : new Date());
      const rawStatePayload = [...historyState, rawCreatedAt];
      try {
        await this.db.query(insertRawQuery, rawStatePayload);
      } catch (error) {
        const err = error as Error;
        logger.debug('Failed to insert into aircraft_states_raw', { error: err.message });
      }
    }

    // Upsert with priority handling: higher priority or fresher data overwrites existing records
    const fresherDataCondition = `
      EXCLUDED.source_priority < aircraft_states.source_priority
      OR (
        EXCLUDED.source_priority = aircraft_states.source_priority
        AND (
          EXCLUDED.last_contact > COALESCE(aircraft_states.last_contact, 0)
          OR (
            EXCLUDED.last_contact = COALESCE(aircraft_states.last_contact, 0)
            AND COALESCE(EXCLUDED.ingestion_timestamp, TO_TIMESTAMP(0))
              > COALESCE(aircraft_states.ingestion_timestamp, TO_TIMESTAMP(0))
          )
        )
      )
      OR (EXTRACT(EPOCH FROM NOW())::bigint - COALESCE(aircraft_states.last_contact, 0)) > 600
    `;

    const upsertQuery = `
      INSERT INTO aircraft_states(
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, category, created_at, feeder_id, ingestion_timestamp, data_source, source_priority,
        aircraft_type, aircraft_description, registration, emergency_status,
        nav_qnh, nav_altitude_mcp, nav_heading, owner_operator, year_built
      )
      VALUES(
        $1, TRIM($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29, $30, $31, $32
      )
      ON CONFLICT(icao24) DO UPDATE SET
        callsign = CASE 
          WHEN (
            -- Higher priority source: always update
            ${fresherDataCondition}
          )
          THEN COALESCE(NULLIF(TRIM(EXCLUDED.callsign), ''), aircraft_states.callsign)
          ELSE aircraft_states.callsign
        END,
        origin_country = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.origin_country
          ELSE aircraft_states.origin_country
        END,
        time_position = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.time_position
          ELSE aircraft_states.time_position
        END,
        last_contact = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.last_contact
          ELSE aircraft_states.last_contact
        END,
        longitude = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.longitude
          ELSE aircraft_states.longitude
        END,
        latitude = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.latitude
          ELSE aircraft_states.latitude
        END,
        baro_altitude = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.baro_altitude
          ELSE aircraft_states.baro_altitude
        END,
        on_ground = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.on_ground
          ELSE aircraft_states.on_ground
        END,
        velocity = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.velocity
          ELSE aircraft_states.velocity
        END,
        true_track = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.true_track
          ELSE aircraft_states.true_track
        END,
        vertical_rate = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.vertical_rate
          ELSE aircraft_states.vertical_rate
        END,
        sensors = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.sensors
          ELSE aircraft_states.sensors
        END,
        geo_altitude = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.geo_altitude
          ELSE aircraft_states.geo_altitude
        END,
        squawk = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.squawk
          ELSE aircraft_states.squawk
        END,
        spi = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.spi
          ELSE aircraft_states.spi
        END,
        position_source = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.position_source
          ELSE aircraft_states.position_source
        END,
        category = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.category
          ELSE aircraft_states.category
        END,
        feeder_id = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.feeder_id
          ELSE aircraft_states.feeder_id
        END,
        ingestion_timestamp = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.ingestion_timestamp
          ELSE aircraft_states.ingestion_timestamp
        END,
        data_source = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.data_source
          ELSE aircraft_states.data_source
        END,
        source_priority = CASE 
          WHEN (
            ${fresherDataCondition}
          )
          THEN EXCLUDED.source_priority
          ELSE aircraft_states.source_priority
        END,
        -- Enriched fields: Only update if not already set or if new data is better
        aircraft_type = COALESCE(EXCLUDED.aircraft_type, aircraft_states.aircraft_type),
        aircraft_description = COALESCE(EXCLUDED.aircraft_description, aircraft_states.aircraft_description),
        registration = COALESCE(EXCLUDED.registration, aircraft_states.registration),
        emergency_status = CASE
          WHEN EXCLUDED.emergency_status IS NOT NULL AND EXCLUDED.emergency_status != 'none'
          THEN EXCLUDED.emergency_status
          ELSE aircraft_states.emergency_status
        END,
        nav_qnh = COALESCE(EXCLUDED.nav_qnh, aircraft_states.nav_qnh),
        nav_altitude_mcp = COALESCE(EXCLUDED.nav_altitude_mcp, aircraft_states.nav_altitude_mcp),
        nav_heading = COALESCE(EXCLUDED.nav_heading, aircraft_states.nav_heading),
        owner_operator = COALESCE(EXCLUDED.owner_operator, aircraft_states.owner_operator),
        year_built = COALESCE(EXCLUDED.year_built, aircraft_states.year_built);
    `;
    await this.db.query(upsertQuery, [
      state[0],
      state[1],
      state[2],
      state[3],
      state[4],
      state[5],
      state[6],
      state[7],
      state[8],
      state[9],
      state[10],
      state[11],
      state[12],
      state[13],
      state[14],
      state[15],
      state[16],
      state[17],
      state[18] || new Date(),
      feederId,
      ingestionTimestamp,
      dataSource,
      sourcePriority,
      aircraftType,
      aircraftDescription,
      registration,
      emergencyStatus,
      navQnh,
      navAltitudeMcp,
      navHeading,
      ownerOperator,
      yearBuilt,
    ]);
  }
}

export default AircraftRepository;
