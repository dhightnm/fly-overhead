const logger = require('../utils/logger');

/**
 * PostGIS Service - Handles all geospatial operations
 */
class PostGISService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Enable PostGIS extension and create geometry columns
   */
  async initialize() {
    try {
      // Enable PostGIS extension
      await this.db.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      logger.info('PostGIS extension enabled');

      // Add geometry columns to existing tables
      await this.addGeometryColumns();

      // Create spatial indexes
      await this.createSpatialIndexes();

      // Populate geometry data from existing lat/lon
      await this.populateGeometryData();

      logger.info('PostGIS initialization complete');
    } catch (error) {
      logger.error('PostGIS initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Add geometry columns to tables
   */
  async addGeometryColumns() {
    const queries = [
      // Add to aircraft_states
      `ALTER TABLE aircraft_states 
       ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326);`,

      // Add to aircraft_states_history
      `ALTER TABLE aircraft_states_history 
       ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326);`,
    ];

    // eslint-disable-next-line no-restricted-syntax
    for (const query of queries) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.query(query);
    }

    logger.info('Geometry columns added to tables');
  }

  /**
   * Create spatial indexes for fast queries
   */
  async createSpatialIndexes() {
    const queries = [
      `CREATE INDEX IF NOT EXISTS idx_aircraft_states_geom 
       ON aircraft_states USING GIST(geom);`,

      `CREATE INDEX IF NOT EXISTS idx_aircraft_history_geom 
       ON aircraft_states_history USING GIST(geom);`,

      // Composite index for time-based spatial queries
      `CREATE INDEX IF NOT EXISTS idx_aircraft_history_geom_time 
       ON aircraft_states_history(icao24, created_at);`,
    ];

    // eslint-disable-next-line no-restricted-syntax
    for (const query of queries) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.query(query);
    }

    logger.info('Spatial indexes created');
  }

  /**
   * Populate geometry from existing lat/lon data
   */
  async populateGeometryData() {
    try {
      // Update aircraft_states
      const result1 = await this.db.query(`
        UPDATE aircraft_states 
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        WHERE longitude IS NOT NULL 
          AND latitude IS NOT NULL 
          AND geom IS NULL;
      `);

      // Update aircraft_states_history (only recent records to avoid long query)
      const result2 = await this.db.query(`
        UPDATE aircraft_states_history 
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        WHERE longitude IS NOT NULL 
          AND latitude IS NOT NULL 
          AND geom IS NULL
          AND created_at > NOW() - INTERVAL '7 days';
      `);

      logger.info('Geometry data populated', {
        statesUpdated: result1.rowCount || 0,
        historyUpdated: result2.rowCount || 0,
      });
    } catch (error) {
      logger.error('Error populating geometry data', { error: error.message });
      throw error;
    }
  }

  /**
   * Create trigger to auto-populate geometry on insert/update
   */
  async createGeometryTriggers() {
    const queries = [
      // Function to update geometry
      `CREATE OR REPLACE FUNCTION update_aircraft_geom()
       RETURNS TRIGGER AS $$
       BEGIN
         IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
           NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
         END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql;`,

      // Trigger for aircraft_states
      `DROP TRIGGER IF EXISTS aircraft_states_geom_trigger ON aircraft_states;
       CREATE TRIGGER aircraft_states_geom_trigger
       BEFORE INSERT OR UPDATE OF longitude, latitude ON aircraft_states
       FOR EACH ROW
       EXECUTE FUNCTION update_aircraft_geom();`,

      // Trigger for aircraft_states_history
      `DROP TRIGGER IF EXISTS aircraft_history_geom_trigger ON aircraft_states_history;
       CREATE TRIGGER aircraft_history_geom_trigger
       BEFORE INSERT OR UPDATE OF longitude, latitude ON aircraft_states_history
       FOR EACH ROW
       EXECUTE FUNCTION update_aircraft_geom();`,
    ];

    // eslint-disable-next-line no-restricted-syntax
    for (const query of queries) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.query(query);
    }

    logger.info('Geometry triggers created');
  }

  /**
   * Find aircraft within radius of a point (in meters)
   */
  async findAircraftNearPoint(latitude, longitude, radiusMeters = 5000) {
    const query = `
      SELECT 
        *,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) as distance_meters
      FROM aircraft_states
      WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      ORDER BY distance_meters ASC;
    `;

    return this.db.query(query, [latitude, longitude, radiusMeters]);
  }

  /**
   * Find aircraft within a polygon area
   */
  async findAircraftInPolygon(polygonCoordinates) {
    // polygonCoordinates should be array of [lon, lat] pairs
    const polygonWKT = `POLYGON((${polygonCoordinates.map(([lon, lat]) => `${lon} ${lat}`).join(', ')}))`;

    const query = `
      SELECT * FROM aircraft_states
      WHERE ST_Within(
        geom,
        ST_GeomFromText($1, 4326)
      );
    `;

    return this.db.query(query, [polygonWKT]);
  }

  /**
   * Get historical flight paths as GeoJSON LineString
   */
  async getFlightPathGeoJSON(icao24, startTime = null, endTime = null) {
    let query = `
      SELECT 
        icao24,
        callsign,
        ST_AsGeoJSON(
          ST_MakeLine(
            geom ORDER BY created_at
          )
        ) as path_geojson,
        MIN(created_at) as start_time,
        MAX(created_at) as end_time,
        COUNT(*) as point_count
      FROM aircraft_states_history
      WHERE icao24 = $1
        AND geom IS NOT NULL
    `;

    const params = [icao24];
    let paramIndex = 2;

    if (startTime) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startTime);
      paramIndex++;
    }

    if (endTime) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endTime);
      paramIndex++;
    }

    query += ' GROUP BY icao24, callsign;';

    return this.db.oneOrNone(query, params);
  }

  /**
   * Calculate traffic density heatmap data
   * Returns grid cells with aircraft counts
   */
  async getTrafficDensity(bounds, cellSizeDegrees = 0.01) {
    const {
      latmin, lonmin, latmax, lonmax,
    } = bounds;

    const query = `
      SELECT 
        ROUND(latitude::numeric / $5) * $5 as lat_cell,
        ROUND(longitude::numeric / $5) * $5 as lon_cell,
        COUNT(DISTINCT icao24) as aircraft_count,
        AVG(baro_altitude) as avg_altitude,
        AVG(velocity) as avg_speed
      FROM aircraft_states_history
      WHERE latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
        AND geom IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY lat_cell, lon_cell
      HAVING COUNT(*) > 10
      ORDER BY aircraft_count DESC;
    `;

    return this.db.query(query, [latmin, latmax, lonmin, lonmax, cellSizeDegrees]);
  }

  /**
   * Find potential spotting locations based on low-altitude traffic patterns
   */
  async findSpottingLocations(airportLat, airportLon, radiusKm = 20) {
    const query = `
      SELECT 
        ROUND(latitude::numeric, 2) as lat_cell,
        ROUND(longitude::numeric, 2) as lon_cell,
        COUNT(DISTINCT icao24) as aircraft_count,
        AVG(baro_altitude) as avg_altitude,
        AVG(CASE WHEN vertical_rate < -2 THEN 1 ELSE 0 END) as landing_frequency,
        AVG(CASE WHEN vertical_rate > 2 THEN 1 ELSE 0 END) as takeoff_frequency,
        MODE() WITHIN GROUP (ORDER BY ROUND(true_track::numeric / 10) * 10) as common_heading,
        AVG(
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          )
        ) as distance_from_airport
      FROM aircraft_states_history
      WHERE baro_altitude < 1000
        AND baro_altitude > 50
        AND velocity > 30
        AND on_ground = false
        AND geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY lat_cell, lon_cell
      HAVING COUNT(*) > 50
      ORDER BY aircraft_count DESC
      LIMIT 20;
    `;

    return this.db.query(query, [airportLat, airportLon, radiusKm * 1000]);
  }
}

module.exports = PostGISService;
