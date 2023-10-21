const router = require('express').Router();
const axios = require('axios');
const nodeCache = require('node-cache');
require('dotenv').config();
const { db, insertOrUpdateAircraftState, getAircraftWithinBounds } = require('../database/database');


const cache = new nodeCache({maxKeys: 100});

router.get('/area/all', async (req, res) => {

    let cacheKey = '/area/all';
    if (cache.has(cacheKey)) {
        res.status(200).send(cache.get(cacheKey));
    } else {

        try {
        const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);
        cache.set(cacheKey, areaRes.data);

        for (const state of areaRes.data.states) {
            await insertOrUpdateAircraftState(state);
        }

        res.json(areaRes.data);
        }
        catch(err) {
            console.log(err);
        }
    }
});

router.get('/planes/:icao24OrCallsign', async (req, res) => {
    const icao24OrCallsign = req.params.icao24OrCallsign;

    try {

        const planes = await db.any(`SELECT * FROM aircraft_states WHERE icao24 = '${icao24OrCallsign}' OR callsign = '${icao24OrCallsign}'`);
        if (planes.length) {
            res.json(planes[0]);
        } else {
            res.status(404).json({error: 'Plane not found'});
        }
        
    } catch (err) {
        console.log(err);
    }
});

router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
    const latmin = req.params.latmin;
    const lonmin = req.params.lonmin;
    const latmax = req.params.latmax;
    const lonmax = req.params.lonmax;

    try {
    const states = await getAircraftWithinBounds(latmin, lonmin, latmax, lonmax);
    res.json(states);
    }
    catch(err) {
        console.log(err);
    }
});

router.get('/starlink/:observer_lat/:observer_lng/:observer_alt', async (req, res) => {
    const observer_lat = req.params.observer_lat;
    const observer_lng = req.params.observer_lng;
    const observer_alt = req.params.observer_alt;

    try {
        const starlinkStates = await axios.get(`https://api.n2yo.com/rest/v1/satellite/above/${observer_lat}/${observer_lng}/${observer_alt}/90/52&apiKey=M3FTYY-Q2CLZF-U76MTW-553N`);
        res.json(starlinkStates.data);
    } catch (err) {
        console.log("ERROR Fetching Starlink States", err);
    }
});

module.exports = router;