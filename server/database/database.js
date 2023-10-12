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

const populateDatabase = async () => {
    try {
        const areaRes = await axios.get(`https://opensky-network.org/api/states/all`);
        for (const state of areaRes.data.states) {
            const currentStateWithDate = [...state, new Date()];
            await insertOrUpdateAircraftState(currentStateWithDate);
        }
        console.log('Database populated');
    } catch (err) {
        console.log(err);
    }
};


module.exports = { db, populateDatabase, insertOrUpdateAircraftState };