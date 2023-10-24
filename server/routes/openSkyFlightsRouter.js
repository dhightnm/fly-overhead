const router = require('express').Router();
const axios = require('axios');
require('dotenv').config();

const getAircraftFlightData = async (icao24, beginTime, endTime) => {
  try {
    const flightData = await axios.get(`https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${beginTime}&end=${endTime}&user=${process.env.OPENSKY_USER}&pass=${process.env.OPENSKY_PASS}`);
    return flightData.data;
  } catch (err) {
    console.log(err);
    return null;
  }
};

router.get('/flights/:icao24/:beginTime/:endTime', async (req, res) => {
  const { icao24 } = req.params;
  const { beginTime } = req.params;
  const { endTime } = req.params;

  try {
    const flights = await getAircraftFlightData(icao24, beginTime, endTime);
    res.json(flights);
  } catch (err) {
    console.log(err);
  }
});
