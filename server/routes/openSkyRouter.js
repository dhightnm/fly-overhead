const router = require('express').Router();
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();
const {
  db, insertOrUpdateAircraftState, getAircraftWithinBounds, getAirportsWithinBounds,
} = require('../database/database');

const cache = new NodeCache({ maxKeys: 100 });

router.get('/area/all', async (req, res) => {
  const cacheKey = '/area/all';
  if (cache.has(cacheKey)) {
    res.status(200).send(cache.get(cacheKey));
  } else {
    try {
      const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);
      cache.set(cacheKey, areaRes.data);

      await Promise.all(areaRes.data.states.map(async (state) => {
        // OpenSky API returns 17 items (no category field)
        // Add null for category at position 17, then Date at position 18
        const stateWithCategory = [...state, null];
        const currentStateWithDate = [...stateWithCategory, new Date()];
        await insertOrUpdateAircraftState(currentStateWithDate);
      }));

      res.json(areaRes.data);
    } catch (err) {
      console.error('Error fetching aircraft data:', err);
      res.status(500).json({ error: 'Failed to fetch aircraft data' });
    }
  }
});

router.get('/planes/:icao24OrCallsign', async (req, res) => {
  const icao24OrCallsign = req.params.icao24OrCallsign.trim();

  try {
    const planes = await db.any('SELECT * FROM aircraft_states WHERE LOWER(icao24) = LOWER($1) OR LOWER(callsign) = LOWER($1)', [icao24OrCallsign]);
    if (planes.length) {
      res.json(planes[0]);
      console.log(planes[0]);
    } else {
      res.status(404).json({ error: 'Plane not found' });
    }
  } catch (err) {
    console.error('Error fetching plane:', err);
    res.status(500).json({ error: 'Failed to fetch plane data' });
  }
});

router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;

  try {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
    // Return only flights that have a last_contact more recent than 10 minutes
    const states = await db.manyOrNone(`
      SELECT * 
      FROM aircraft_states
      WHERE last_contact >= $1
        AND latitude BETWEEN $2 AND $3
        AND longitude BETWEEN $4 AND $5
    `, [tenMinutesAgo, latmin, latmax, lonmin, lonmax]);

    res.json(states);
  } catch (err) {
    console.log(err);
    res.status(500).send('Error retrieving states');
  }
});

router.get('/starlink/:observer_lat/:observer_lng/:observer_alt', async (req, res) => {
  const observerLat = req.params.observer_lat;
  const observerLng = req.params.observer_lng;
  const observerAlt = req.params.observer_alt;

  try {
    const apiKey = process.env.N2YO_API_KEY || 'M3FTYY-Q2CLZF-U76MTW-553N';
    const starlinkStates = await axios.get(`https://api.n2yo.com/rest/v1/satellite/above/${observerLat}/${observerLng}/${observerAlt}/45/52&apiKey=${apiKey}`);
    res.status(200).json(starlinkStates.data);
  } catch (err) {
    res.status(500).json({ error: 'ERROR Fetching Starlink States' });
  }
});

router.get('/airports/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
  const { latmin } = req.params;
  const { lonmin } = req.params;
  const { latmax } = req.params;
  const { lonmax } = req.params;

  try {
    const airports = await getAirportsWithinBounds(latmin, lonmin, latmax, lonmax);
    res.json(airports);
  } catch (err) {
    console.error('Error fetching airports:', err);
    res.status(500).json({ error: 'Failed to fetch airport data' });
  }
});

module.exports = router;
