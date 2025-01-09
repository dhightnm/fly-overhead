const pgp = require('pg-promise')();
const axios = require('axios');

/** 
 * Use your actual credentials here. 
 * If you prefer, store them in .env and read via process.env.
 * e.g.: const connectionString = process.env.DATABASE_URL
 */
const connectionString = 'postgresql://example:example@localhost:5432/fly_overhead';
const db = pgp(connectionString);

/**
 * 1) Create main aircraft_states table (stores only the latest data for each icao24)
 */
const createMainTable = async () => {
  const createTableQuery = `
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
  await db.query(createTableQuery);
  console.log('Table aircraft_states created or already exists.');
};

/**
 * 2) Create aircraft_states_history table (stores all past positions for each aircraft).
 *    This table accumulates a new row for every poll, so you can later visualize movement.
 */
const createHistoryTable = async () => {
  const createHistoryQuery = `
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
  await db.query(createHistoryQuery);
  console.log('Table aircraft_states_history created or already exists.');
};

/**
 * 3) Check if the main table exists (optional helper used in populateDatabase)
 */
const tableExists = async () => {
  try {
    const result = await db.one(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name   = 'aircraft_states'
      );
    `);
    return result.exists;
  } catch (err) {
    console.error('Error checking table existence:', err);
    return false;
  }
};

/**
 * 4) Insert or update the "latest" aircraft state in the main table,
 *    and also insert a snapshot into the history table.
 */
const insertOrUpdateAircraftState = async (state) => {
  // 1) Insert a snapshot into the history table (a new row every time we get data)
  const insertHistoryQuery = `
    INSERT INTO aircraft_states_history (
      icao24, callsign, origin_country, time_position, last_contact,
      longitude, latitude, baro_altitude, on_ground, velocity,
      true_track, vertical_rate, sensors, geo_altitude, squawk,
      spi, position_source
      -- Note: created_at defaults to CURRENT_TIMESTAMP automatically
    )
    VALUES(
      $1, TRIM($2), $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17
    );
  `;
  // Execute insert for the history snapshot
  await db.query(insertHistoryQuery, state);

  // 2) Upsert into aircraft_states (so we always have the latest position)
  const upsertMainQuery = `
    INSERT INTO aircraft_states(
      icao24, callsign, origin_country, time_position, last_contact,
      longitude, latitude, baro_altitude, on_ground, velocity,
      true_track, vertical_rate, sensors, geo_altitude, squawk,
      spi, position_source, created_at
    )
    VALUES(
      $1, TRIM($2), $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18
    )
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
      position_source = EXCLUDED.position_source
  `;
  // Execute the upsert on the main table
  await db.query(upsertMainQuery, state);
};

/**
 * 5) Create the main table if it doesn't exist, 
 *    create the history table if it doesn't exist,
 *    then run the bounding-box queries to populate data.
 */
const populateDatabase = async () => {
  try {
    // Ensure both tables exist
    const exists = await tableExists();
    if (!exists) {
      await createMainTable();
    }
    await createHistoryTable(); // IF NOT EXISTS ensures it won't recreate

    // Example bounding boxes
    const boundingBoxes = [
      { lamin: -90, lomin: -180, lamax: 0,   lomax: 0   },
      { lamin: 0,   lomin: -180, lamax: 90,  lomax: 0   },
      { lamin: -90, lomin: 0,    lamax: 0,   lomax: 180 },
      { lamin: 0,   lomin: 0,    lamax: 90,  lomax: 180 },
    ];

    // Fetch data for each bounding box
    const fetchPromises = boundingBoxes.map((box) => fetchDataForBoundingBox(box));
    await Promise.all(fetchPromises);
    console.log('Database populated');
  } catch (err) {
    console.error('Error populating database:', err);
  }
};

/**
 * 6) Retrieve data from OpenSky for a bounding box, upsert each aircraft,
 *    and also store a history snapshot (handled by insertOrUpdateAircraftState).
 */
const fetchDataForBoundingBox = async (box) => {
  try {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`, {
      params: {
        lamin: box.lamin,
        lomin: box.lomin,
        lamax: box.lamax,
        lomax: box.lomax
      }
    });

    const promises = areaRes.data.states.map((state) => {
      // Build the array that matches our queries
      // e.g. [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, ... created_at]
      const currentStateWithDate = [...state, new Date()];
      return insertOrUpdateAircraftState(currentStateWithDate);
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('Error fetching bounding box data from API:', err);
  }
};

/**
 * 7) Example function to update database with "all" states (no bounding box).
 *    Called periodically or at server start to keep data fresh.
 */
const updateDatabaseFromAPI = async () => {
  try {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);
    const promises = areaRes.data.states.map((originalState) => {
      const currentStateWithDate = [...originalState, new Date()];
      return insertOrUpdateAircraftState(currentStateWithDate);
    });
    await Promise.all(promises);
    console.log('Database updated successfully.');
  } catch (err) {
    console.error('Error updating database from API:', err);
  }
};

/**
 * 8) Delete stale records if you want to keep your main table smaller.
 *    But if you want a full history, either remove or raise the threshold.
 */
const deleteStaleRecords = async () => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.query('DELETE FROM aircraft_states WHERE created_at < $1', [twoHoursAgo]);
    console.log('Stale records deleted successfully from aircraft_states.');
  } catch (err) {
    console.error('Error deleting stale records:', err);
  }
};

/**
 * 9) Query aircraft by bounding box (for the map)
 */
const getAircraftWithinBounds = async (latmin, lonmin, latmax, lonmax) => {
  const queryString = `
    SELECT * FROM aircraft_states
    WHERE latitude BETWEEN $1 AND $2
      AND longitude BETWEEN $3 AND $4
  `;
  const aircraftStates = await db.query(queryString, [latmin, latmax, lonmin, lonmax]);
  return aircraftStates;
};

/**
 * 10) Query airports by bounding box
 */
const getAirportsWithinBounds = async (latmin, lonmin, latmax, lonmax) => {
  const queryString = `
    SELECT * FROM airports
    WHERE latitude BETWEEN $1 AND $2
      AND longitude BETWEEN $3 AND $4
  `;
  const airports = await db.query(queryString, [latmin, latmax, lonmin, lonmax]);
  return airports;
};

/* 11) Export your functions */
module.exports = {
  db,
  insertOrUpdateAircraftState,
  createMainTable,
  createHistoryTable,
  tableExists,
  populateDatabase,
  fetchDataForBoundingBox,
  updateDatabaseFromAPI,
  deleteStaleRecords,
  getAircraftWithinBounds,
  getAirportsWithinBounds,
};
