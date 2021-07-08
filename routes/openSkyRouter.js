const router = require('express').Router();
const axios = require('axios');

router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res) => {
    const latmin = req.params.latmin;
    const lonmin = req.params.lonmin;
    const latmax = req.params.latmax;
    const lonmax = req.params.lonmax;
    const areaRes = await axios.get(`https://opensky-network.org/api/states/all?lamin=${latmin}&lomin=${lonmin}&lamax=${latmax}&lomax=${lonmax}`);
    console.log(latmin, latmax, lonmin, lonmax)
});

module.exports = router;