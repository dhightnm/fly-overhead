const pgp = require('pg-promise')();
const connectionString = 'postgresql://example:example@localhost:5432/fly_overhead' || 'postgres://localhost:5432/opensky';
const db = pgp(connectionString);
const axios = require('axios');

const insertOrUpdateAircraftState = async (state) => {
    const queryString = `
    INSERT INTO aircraft_states(
        icao24, callsign, origin_country, time_position, last_contact,
        longitude, latitude, baro_altitude, on_ground, velocity,
        true_track, vertical_rate, sensors, geo_altitude, squawk,
        spi, position_source, created_at
    )
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT(icao24) DO UPDATE SET
        callsign = EXCLUDED.callsign,
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
        position_source = EXCLUDED.position_source;`;
console.log("STATE", state.length, state)
await db.query(queryString, state);
};

const createTable = async () => {
    const createTableQuery = `
    CREATE TABLE aircraft_states (
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
    );`;
    await db.query(createTableQuery);
    console.log("Table aircraft_states created successfully.");
}

const tableExists = async () => {
    try {
        const result = await db.one(`SELECT EXISTS (
           SELECT FROM information_schema.tables 
           WHERE  table_schema = 'public' 
           AND    table_name   = 'aircraft_states'
       );`);
        return result.exists;
    } catch (err) {
        console.error('Error checking table existence:', err);
        return false;
    }
};

const updateDatabaseFromAPI = async () => {
    try {
        const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);
        for (const state of areaRes.data.states) {
            await insertOrUpdateAircraftState(state);
        }
        console.log('Database updated successfully.');
    } catch (err) {
        console.error('Error updating database from API:', err);
    }
};

const deleteStaleRecords = async () => {
    try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await db.query('DELETE FROM aircraft_states WHERE created_at < $1', [twoHoursAgo]);
        console.log('Stale records deleted successfully.');
    } catch (err) {
        console.error('Error deleting stale records:', err);
    }
};

const populateDatabase = async () => {
    try {
        const exists = await tableExists();
        if (!exists) {
            await createTable();
        }

        const boundingBoxes = [
            { lamin: -90, lomin: -180, lamax: 0, lomax: 0 },
            { lamin: 0, lomin: -180, lamax: 90, lomax: 0 },
            { lamin: -90, lomin: 0, lamax: 0, lomax: 180 },
            { lamin: 0, lomin: 0, lamax: 90, lomax: 180 }
        ];

        const fetchPromises = boundingBoxes.map(box => fetchDataForBoundingBox(box));
        await Promise.all(fetchPromises);
        console.log('Database populated');
    } catch (err) {
        console.error('Error populating database:', err);
    }
};


const fetchDataForBoundingBox = async (box) => {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`);
    const promises = [];
    for (const state of areaRes.data.states) {
        const currentStateWithDate = [...state, new Date()];
        promises.push(insertOrUpdateAircraftState(currentStateWithDate));
    }
    await Promise.all(promises);
}


const getAircraftWithinBounds = async (latmin, lonmin, latmax, lonmax) => {
    const queryString = `
    SELECT * FROM aircraft_states
    WHERE latitude BETWEEN ${latmin} AND ${latmax}
    AND longitude BETWEEN ${lonmin} AND ${lonmax};`;
    const aircraftStates = await db.query(queryString);
    return aircraftStates;
};



module.exports = { 
     db,
     populateDatabase,
     insertOrUpdateAircraftState, 
     getAircraftWithinBounds,
     updateDatabaseFromAPI,
     deleteStaleRecords };