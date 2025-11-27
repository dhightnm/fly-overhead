import pgPromise from 'pg-promise';
import logger from '../utils/logger';

/**
 * Initialize airport schema tables
 * Creates airports, runways, frequencies, and navaids tables with PostGIS support
 */
async function initializeAirportSchema(db: pgPromise.IDatabase<any>): Promise<void> {
  try {
    // Create airports table
    await db.query(`
      CREATE TABLE IF NOT EXISTS airports (
        id SERIAL PRIMARY KEY,
        airport_id TEXT UNIQUE NOT NULL,
        ident TEXT NOT NULL,
        type TEXT,
        name TEXT,
        latitude_deg FLOAT8,
        longitude_deg FLOAT8,
        elevation_ft INTEGER,
        continent TEXT,
        iso_country TEXT,
        iso_region TEXT,
        municipality TEXT,
        scheduled_service TEXT,
        gps_code TEXT,
        iata_code TEXT,
        local_code TEXT,
        home_link TEXT,
        wikipedia_link TEXT,
        keywords TEXT,
        runways JSONB DEFAULT '[]'::jsonb,
        frequencies JSONB DEFAULT '[]'::jsonb,
        geom GEOMETRY(Point, 4326),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_airports_ident ON airports(ident);
      CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata_code);
      CREATE INDEX IF NOT EXISTS idx_airports_gps ON airports(gps_code);
      CREATE INDEX IF NOT EXISTS idx_airports_type ON airports(type);
      CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(iso_country);
      CREATE INDEX IF NOT EXISTS idx_airports_geom ON airports USING GIST(geom);
      
      -- JSONB indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_airports_runways ON airports USING GIN(runways);
      CREATE INDEX IF NOT EXISTS idx_airports_frequencies ON airports USING GIN(frequencies);
    `);

    // Create trigger to auto-update geometry
    await db.query(`
      CREATE OR REPLACE FUNCTION update_airport_geom()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.longitude_deg IS NOT NULL AND NEW.latitude_deg IS NOT NULL THEN
          NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude_deg, NEW.latitude_deg), 4326);
        END IF;
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS airport_geom_trigger ON airports;
      CREATE TRIGGER airport_geom_trigger
      BEFORE INSERT OR UPDATE OF longitude_deg, latitude_deg ON airports
      FOR EACH ROW
      EXECUTE FUNCTION update_airport_geom();
    `);

    logger.info('Airport schema initialized successfully');
  } catch (error) {
    const err = error as Error;
    logger.error('Error initializing airport schema', { error: err.message });
    throw err;
  }
}

export default initializeAirportSchema;
