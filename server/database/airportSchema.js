const logger = require('../utils/logger');

/**
 * Airport database schema
 * Based on OurAirports.com data structure
 */

/**
 * Create airports table with PostGIS geometry and JSONB for runways/frequencies
 */
async function createAirportsTable(db) {
  const query = `
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

    -- Trigger to auto-update geometry
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
  `;

  await db.query(query);
  logger.info('Airports table created with embedded runways and frequencies');
}

/**
 * Create runways table with PostGIS geometry
 */
async function createRunwaysTable(db) {
  const query = `
    CREATE TABLE IF NOT EXISTS runways (
      id SERIAL PRIMARY KEY,
      runway_id TEXT UNIQUE NOT NULL,
      airport_ref TEXT NOT NULL,
      airport_ident TEXT,
      length_ft INTEGER,
      width_ft INTEGER,
      surface TEXT,
      lighted BOOLEAN,
      closed BOOLEAN,
      le_ident TEXT,
      le_latitude_deg FLOAT8,
      le_longitude_deg FLOAT8,
      le_elevation_ft INTEGER,
      le_heading_degT FLOAT8,
      le_displaced_threshold_ft INTEGER,
      he_ident TEXT,
      he_latitude_deg FLOAT8,
      he_longitude_deg FLOAT8,
      he_elevation_ft INTEGER,
      he_heading_degT FLOAT8,
      he_displaced_threshold_ft INTEGER,
      le_geom GEOMETRY(Point, 4326),
      he_geom GEOMETRY(Point, 4326),
      centerline_geom GEOMETRY(LineString, 4326),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_runways_airport_ref ON runways(airport_ref);
    CREATE INDEX IF NOT EXISTS idx_runways_airport_ident ON runways(airport_ident);
    CREATE INDEX IF NOT EXISTS idx_runways_le_ident ON runways(le_ident);
    CREATE INDEX IF NOT EXISTS idx_runways_he_ident ON runways(he_ident);
    CREATE INDEX IF NOT EXISTS idx_runways_surface ON runways(surface);
    CREATE INDEX IF NOT EXISTS idx_runways_le_geom ON runways USING GIST(le_geom);
    CREATE INDEX IF NOT EXISTS idx_runways_he_geom ON runways USING GIST(he_geom);
    CREATE INDEX IF NOT EXISTS idx_runways_centerline ON runways USING GIST(centerline_geom);

    -- Trigger to auto-update geometry
    CREATE OR REPLACE FUNCTION update_runway_geom()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Low-end geometry
      IF NEW.le_longitude_deg IS NOT NULL AND NEW.le_latitude_deg IS NOT NULL THEN
        NEW.le_geom = ST_SetSRID(ST_MakePoint(NEW.le_longitude_deg, NEW.le_latitude_deg), 4326);
      END IF;
      
      -- High-end geometry
      IF NEW.he_longitude_deg IS NOT NULL AND NEW.he_latitude_deg IS NOT NULL THEN
        NEW.he_geom = ST_SetSRID(ST_MakePoint(NEW.he_longitude_deg, NEW.he_latitude_deg), 4326);
      END IF;
      
      -- Centerline (runway line between two ends)
      IF NEW.le_geom IS NOT NULL AND NEW.he_geom IS NOT NULL THEN
        NEW.centerline_geom = ST_MakeLine(NEW.le_geom, NEW.he_geom);
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS runway_geom_trigger ON runways;
    CREATE TRIGGER runway_geom_trigger
    BEFORE INSERT OR UPDATE OF le_longitude_deg, le_latitude_deg, he_longitude_deg, he_latitude_deg ON runways
    FOR EACH ROW
    EXECUTE FUNCTION update_runway_geom();
  `;

  await db.query(query);
  logger.info('Runways table created');
}

/**
 * Create airport frequencies table
 */
async function createFrequenciesTable(db) {
  const query = `
    CREATE TABLE IF NOT EXISTS airport_frequencies (
      id SERIAL PRIMARY KEY,
      frequency_id TEXT UNIQUE NOT NULL,
      airport_ref TEXT NOT NULL,
      airport_ident TEXT,
      type TEXT,
      description TEXT,
      frequency_mhz FLOAT8,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_frequencies_airport_ref ON airport_frequencies(airport_ref);
    CREATE INDEX IF NOT EXISTS idx_frequencies_airport_ident ON airport_frequencies(airport_ident);
    CREATE INDEX IF NOT EXISTS idx_frequencies_type ON airport_frequencies(type);
  `;

  await db.query(query);
  logger.info('Airport frequencies table created');
}

/**
 * Create navaids table with PostGIS geometry
 */
async function createNavaidsTable(db) {
  const query = `
    CREATE TABLE IF NOT EXISTS navaids (
      id SERIAL PRIMARY KEY,
      navaid_id TEXT UNIQUE NOT NULL,
      filename TEXT,
      ident TEXT,
      name TEXT,
      type TEXT,
      frequency_khz INTEGER,
      latitude_deg FLOAT8,
      longitude_deg FLOAT8,
      elevation_ft INTEGER,
      iso_country TEXT,
      dme_frequency_khz INTEGER,
      dme_channel TEXT,
      dme_latitude_deg FLOAT8,
      dme_longitude_deg FLOAT8,
      dme_elevation_ft INTEGER,
      slaved_variation_deg FLOAT8,
      magnetic_variation_deg FLOAT8,
      usageType TEXT,
      power TEXT,
      associated_airport TEXT,
      geom GEOMETRY(Point, 4326),
      dme_geom GEOMETRY(Point, 4326),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_navaids_ident ON navaids(ident);
    CREATE INDEX IF NOT EXISTS idx_navaids_type ON navaids(type);
    CREATE INDEX IF NOT EXISTS idx_navaids_country ON navaids(iso_country);
    CREATE INDEX IF NOT EXISTS idx_navaids_airport ON navaids(associated_airport);
    CREATE INDEX IF NOT EXISTS idx_navaids_geom ON navaids USING GIST(geom);
    CREATE INDEX IF NOT EXISTS idx_navaids_dme_geom ON navaids USING GIST(dme_geom);

    -- Trigger to auto-update geometry
    CREATE OR REPLACE FUNCTION update_navaid_geom()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Main navaid geometry
      IF NEW.longitude_deg IS NOT NULL AND NEW.latitude_deg IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude_deg, NEW.latitude_deg), 4326);
      END IF;
      
      -- DME geometry (if different from main)
      IF NEW.dme_longitude_deg IS NOT NULL AND NEW.dme_latitude_deg IS NOT NULL THEN
        NEW.dme_geom = ST_SetSRID(ST_MakePoint(NEW.dme_longitude_deg, NEW.dme_latitude_deg), 4326);
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS navaid_geom_trigger ON navaids;
    CREATE TRIGGER navaid_geom_trigger
    BEFORE INSERT OR UPDATE OF longitude_deg, latitude_deg, dme_longitude_deg, dme_latitude_deg ON navaids
    FOR EACH ROW
    EXECUTE FUNCTION update_navaid_geom();
  `;

  await db.query(query);
  logger.info('Navaids table created');
}

/**
 * Initialize all airport-related tables
 */
async function initializeAirportSchema(db) {
  try {
    await createAirportsTable(db);
    await createRunwaysTable(db);
    await createFrequenciesTable(db);
    await createNavaidsTable(db);
    logger.info('All airport tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing airport schema', { error: error.message });
    throw error;
  }
}

module.exports = {
  createAirportsTable,
  createRunwaysTable,
  createFrequenciesTable,
  createNavaidsTable,
  initializeAirportSchema,
};
