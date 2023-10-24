const router = require('express').Router(); 
const axios = require('axios');
const nodeCache = require('node-cache');
require('dotenv').config();

const cache = new nodeCache({maxKeys: 100});

router.get('/flights/:icao24/:beginTime/:endTime', async (req, res) => {
    const icao24 = req.params.icao24;
    const beginTime = req.params.beginTime;
    const endTime = req.params.endTime;

    try {
        const flights = await getAircraftFlightData(icao24, beginTime, endTime);
        res.json(flights);
    }
    catch(err) {
        console.log(err);
    }
});

const getAircraftFlightData = async (icao24, beginTime, endTime) => {
    try {
        const flightData = await axios.get(`https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${beginTime}&end=${endTime}&user=${process.env.OPENSKY_USER}&pass=${process.env.OPENSKY_PASS}`);
        return flightData.data;
    }
    catch(err) {
        console.log(err);
    }   
}