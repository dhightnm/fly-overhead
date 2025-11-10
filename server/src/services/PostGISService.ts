import pgPromise from 'pg-promise';
import logger from '../utils/logger';

interface IndexDefinition {
  name: string;
  query: string;
  description: string;
}

interface Bounds {
  latmin: number;
  lonmin: number;
  latmax: number;
  lonmax: number;
}

/**
 * PostGIS Service - Handles all geospatial operations
 */
class PostGISService {
  private db: pgPromise.IDatabase<any>;

  constructor(db: pgPromise.IDatabase<any>) {
    this.db = db;
  }

  /**
   * Enable PostGIS extension and create geometry columns
   */
  async initialize(): Promise<void> {
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
      const err = error as Error;
      logger.error('PostGIS initialization failed', { error: err.message });
      throw error;
    }
  }

  /**
   * Add geometry columns to tables
   */
  async addGeometryColumns(): Promise<void> {
    const queries = [
      // Add to aircraft_states
      `ALTER TABLE aircraft_states 
       ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326);`,

      // Add to aircraft_states_history
      `ALTER TABLE aircraft_states_history 
       ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326);`,
    ];

    for (const query of queries) {
      await this.db.query(query);
    }

    logger.info('Geometry columns added to tables');
  }

  /**
   * Create spatial indexes for fast queries
   * Uses CONCURRENTLY to avoid blocking and handles disk space errors gracefully
   */
  async createSpatialIndexes(): Promise<void> {
    // Critical spatial indexes (required for PostGIS queries)
    const criticalIndexes: IndexDefinition[] = [
      {
        name: 'idx_aircraft_states_geom',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_geom 
                ON aircraft_states USING GIST(geom);`,
        description: 'Spatial index on aircraft_states',
      },
      {
        name: 'idx_aircraft_history_geom',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_history_geom 
                ON aircraft_states_history USING GIST(geom);`,
        description: 'Spatial index on aircraft_states_history',
      },
    ];

    // Optional composite indexes (nice-to-have but not critical)
    const optionalIndexes: IndexDefinition[] = [
      {
        name: 'idx_aircraft_history_geom_time',
        query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_history_geom_time 
                ON aircraft_states_history(icao24, created_at);`,
        description: 'Composite index for time-based spatial queries',
      },
    ];

    // Create critical indexes first
    for (const index of criticalIndexes) {
      try {
        // Check if index already exists to avoid unnecessary work
        const exists = await this.db.oneOrNone<{ count: number }>(`
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = 'public' 
            AND indexname = $1
        `, [index.name]);

        if (!exists) {
          logger.info(`Creating ${index.description}...`);
          await this.db.query(index.query);
          logger.info(`${index.name} created successfully`);
        } else {
          logger.debug(`${index.name} already exists`);
        }
      } catch (error) {
        const err = error as Error;
        // Log but don't throw - allow server to continue even if index creation fails
        if (err.message.includes('No space left on device')) {
          logger.warn(`${index.description} creation skipped due to disk space`, {
            error: err.message,
          });
        } else {
          logger.warn(`${index.description} creation failed (non-critical)`, {
            error: err.message,
          });
        }
      }
    }

    // Create optional indexes only if we have disk space
    for (const index of optionalIndexes) {
      try {
        // Check if index already exists
        const exists = await this.db.oneOrNone<{ count: number }>(`
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = 'public' 
            AND indexname = $1
        `, [index.name]);

        if (!exists) {
          logger.info(`Creating optional ${index.description}...`);
          await this.db.query(index.query);
          logger.info(`${index.name} created successfully`);
        } else {
          logger.debug(`${index.name} already exists`);
        }
      } catch (error) {
        const err = error as Error;
        // Silently skip optional indexes if they fail (disk space, etc.)
        logger.debug(`${index.description} skipped`, {
          error: err.message,
        });
      }
    }

    logger.info('Spatial indexes creation completed');
  }

  /**
   * Populate geometry from existing lat/lon data
   * Uses batch updates to avoid blocking and disk space issues
   */
  async populateGeometryData(): Promise<void> {
    try {
      // Check if geometry is already mostly populated to avoid unnecessary work
      const checkResult = await this.db.one<{ missing_geom: string; has_geom: string; total: string }>(`
        SELECT 
          COUNT(*) FILTER (WHERE geom IS NULL AND longitude IS NOT NULL AND latitude IS NOT NULL) as missing_geom,
          COUNT(*) FILTER (WHERE geom IS NOT NULL) as has_geom,
          COUNT(*) as total
        FROM aircraft_states;
      `);

      const missingCount = parseInt(checkResult.missing_geom, 10);
      const hasGeomCount = parseInt(checkResult.has_geom, 10);
      const totalCount = parseInt(checkResult.total, 10);

      // If most rows already have geometry, skip bulk update to avoid blocking startup
      if (hasGeomCount > 0 && (hasGeomCount / totalCount) > 0.9) {
        logger.info('Geometry data mostly populated, skipping bulk update', {
          hasGeom: hasGeomCount,
          missingGeom: missingCount,
          total: totalCount,
        });
        return;
      }

      // Only update a small batch to avoid blocking and disk space issues
      // The triggers will handle new inserts/updates automatically
      const batchSize = 1000;
      const result1 = await this.db.query<{ rowCount: number }>(`
        UPDATE aircraft_states 
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        WHERE id IN (
          SELECT id FROM aircraft_states
          WHERE longitude IS NOT NULL 
            AND latitude IS NOT NULL 
            AND geom IS NULL
          LIMIT $1
        );
      `, [batchSize]);

      // Update aircraft_states_history (only recent records to avoid long query)
      const result2 = await this.db.query<{ rowCount: number }>(`
        UPDATE aircraft_states_history 
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        WHERE id IN (
          SELECT id FROM aircraft_states_history
          WHERE longitude IS NOT NULL 
            AND latitude IS NOT NULL 
            AND geom IS NULL
            AND created_at > NOW() - INTERVAL '7 days'
          LIMIT $1
        );
      `, [batchSize]);

      logger.info('Geometry data populated (batch)', {
        statesUpdated: result1.rowCount || 0,
        historyUpdated: result2.rowCount || 0,
        remaining: missingCount - (result1.rowCount || 0),
      });
    } catch (error) {
      const err = error as Error;
      // Don't throw - allow server to continue even if geometry population fails
      logger.warn('Error populating geometry data (non-critical)', { error: err.message });
    }
  }

  /**
   * Create trigger to auto-populate geometry on insert/update
   */
  async createGeometryTriggers(): Promise<void> {
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

    for (const query of queries) {
      await this.db.query(query);
    }

    logger.info('Geometry triggers created');
  }

  /**
   * Find aircraft within radius of a point (in meters)
   */
  async findAircraftNearPoint(
    latitude: number,
    longitude: number,
    radiusMeters: number = 5000
  ): Promise<any[]> {
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
  async findAircraftInPolygon(polygonCoordinates: number[][]): Promise<any[]> {
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
  async getFlightPathGeoJSON(
    icao24: string,
    startTime: Date | null = null,
    endTime: Date | null = null
  ): Promise<any> {
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

    const params: any[] = [icao24];
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
  async getTrafficDensity(bounds: Bounds, cellSizeDegrees: number = 0.01): Promise<any[]> {
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
  async findSpottingLocations(
    airportLat: number,
    airportLon: number,
    radiusKm: number = 20
  ): Promise<any[]> {
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

export default PostGISService;

