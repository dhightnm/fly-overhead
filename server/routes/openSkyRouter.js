const router = require('express').Router();
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();
const { db, insertOrUpdateAircraftState, getAircraftWithinBounds } = require('../database/database');

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
        await insertOrUpdateAircraftState(state);
      }));

      res.json(areaRes.data);
    } catch (err) {
      console.log(err);
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
    console.log(err);
  }
});

router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
  const { latmin } = req.params;
  const { lonmin } = req.params;
  const { latmax } = req.params;
  const { lonmax } = req.params;

  try {
    const states = await getAircraftWithinBounds(latmin, lonmin, latmax, lonmax);
    res.json(states);
  } catch (err) {
    console.log(err);
  }
});

router.get('/starlink/:observer_lat/:observer_lng/:observer_alt', async (req, res) => {
  const { observerLat } = req.params;
  const { observerLng } = req.params;
  const { observerAlt } = req.params;

  try {
    const starlinkStates = await axios.get(`https://api.n2yo.com/rest/v1/satellite/above/${observerLat}/${observerLng}/${observerAlt}/90/52&apiKey=M3FTYY-Q2CLZF-U76MTW-553N`);
    res.json(starlinkStates.data);
  } catch (err) {
    console.log('ERROR Fetching Starlink States', err);
  }
});

module.exports = router;
