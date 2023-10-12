const router = require('express').Router();
const axios = require('axios');
const nodeCache = require('node-cache');
require('dotenv').config();
const { insertOrUpdateAircraftState } = require('../database/database');


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

router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
    const latmin = req.params.latmin;
    const lonmin = req.params.lonmin;
    const latmax = req.params.latmax;
    const lonmax = req.params.lonmax;

    try {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all?lamin=${latmin}&lomin=${lonmin}&lamax=${latmax}&lomax=${lonmax}`);
    res.json(areaRes.data);

    if (areaRes.data.states !== null) {
        for (const state of areaRes.data.states) {
            await insertOrUpdateAircraftState(state);
        }
    }
    }
    catch(err) {
        console.log(err);
    }
});

module.exports = router;