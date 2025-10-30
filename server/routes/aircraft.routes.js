const router = require('express').Router();
const NodeCache = require('node-cache');
const aircraftService = require('../services/AircraftService');
const satelliteService = require('../services/SatelliteService');
const historyService = require('../services/HistoryService');
const flightRouteService = require('../services/FlightRouteService');
const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 60, maxKeys: 100 });

/**
 * Get all aircraft (cached)
 */
router.get('/area/all', async (req, res, next) => {
  const cacheKey = '/area/all';

  try {
    // Check cache
    if (cache.has(cacheKey)) {
      logger.debug('Serving cached aircraft data');
      return res.status(200).json(cache.get(cacheKey));
    }

    // Fetch fresh data
    const states = await aircraftService.fetchAndUpdateAllAircraft();
    cache.set(cacheKey, states);

    return res.json(states);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get aircraft by identifier (icao24 or callsign)
 */
router.get('/planes/:identifier', async (req, res, next) => {
  const { identifier } = req.params;

  try {
    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);

    if (!aircraft) {
      logger.info(`Aircraft not found: ${identifier}`);
      return res.status(404).json({ error: 'Plane not found' });
    }

    // Enrich with flight route data
    try {
      // If aircraft is in our database and visible on map, it's a CURRENT flight
      // OpenSky only provides historical data (previous day or earlier)
      // So we default to treating map-visible aircraft as current
      // Only use OpenSky for explicit historical queries (flight history feature)
      const isCurrentFlight = true; // Default: assume current if visible on map
      
      logger.info('Fetching route for aircraft (assumed current since visible on map)', {
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
        isCurrentFlight,
        lastContact: aircraft.last_contact,
      });
      
      const route = await flightRouteService.getFlightRoute(
        aircraft.icao24,
        aircraft.callsign,
        isCurrentFlight
      );
      if (route) {
        aircraft.route = route;
      }
    } catch (routeError) {
      logger.warn('Could not fetch route data', { error: routeError.message });
    }

    return res.json(aircraft);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get flight route for an aircraft
 */
router.get('/route/:identifier', async (req, res, next) => {
  const { identifier } = req.params;
  const { icao24, callsign } = req.query;

  try {
    // Try to get aircraft data first for full identifiers
    let aircraftIcao24 = icao24 || identifier;
    let aircraftCallsign = callsign;

    // Always try to get aircraft data to check if it's a current flight
    let aircraft = await aircraftService.getAircraftByIdentifier(identifier);
    if (aircraft) {
      aircraftIcao24 = aircraft.icao24;
      aircraftCallsign = aircraft.callsign;
    }

    // If we're querying route for an aircraft, assume it's CURRENT
    // (because if it's on the map, it's being tracked now)
    // OpenSky routes endpoint only has historical data (previous day+)
    // Use AviationStack for current flights instead
    const isCurrentFlight = true;
    
    logger.info('Fetching route (assumed current - visible/trackable aircraft)', {
      icao24: aircraftIcao24,
      callsign: aircraftCallsign,
      hasAircraftData: !!aircraft,
    });
    
    const route = await flightRouteService.getFlightRoute(
      aircraftIcao24,
      aircraftCallsign,
      isCurrentFlight
    );

    if (!route) {
      return res.status(404).json({ error: 'Flight route not found' });
    }

    return res.json(route);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get aircraft within geographical bounds
 */
router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res, next) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;

  try {
    const aircraft = await aircraftService.getAircraftInBounds(
      parseFloat(latmin),
      parseFloat(lonmin),
      parseFloat(latmax),
      parseFloat(lonmax),
    );

    return res.json(aircraft);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get satellites above observer location
 */
router.get('/starlink/:observer_lat/:observer_lng/:observer_alt', async (req, res, next) => {
  // eslint-disable-next-line camelcase
  const { observer_lat, observer_lng, observer_alt } = req.params;

  try {
    const satelliteData = await satelliteService.getSatellitesAbove(
      parseFloat(observer_lat),
      parseFloat(observer_lng),
      parseFloat(observer_alt),
    );

    return res.json(satelliteData);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get historical flight path for an aircraft
 */
router.get('/history/:icao24', async (req, res, next) => {
  const { icao24 } = req.params;
  const { start, end } = req.query;

  try {
    const history = await historyService.getFlightPath(icao24, start, end);
    return res.json(history);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get historical statistics
 */
router.get('/history/stats/:icao24?', async (req, res, next) => {
  const { icao24 } = req.params;

  try {
    const stats = await historyService.getHistoryStats(icao24);
    return res.json(stats);
  } catch (err) {
    return next(err);
  }
});

/**
 * Search historical flights by time range
 */
router.get('/history/search', async (req, res, next) => {
  const { start, end, limit = 100 } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end query parameters required' });
  }

  try {
    const flights = await historyService.searchFlightsByTimeRange(start, end, parseInt(limit));
    return res.json(flights);
  } catch (err) {
    return next(err);
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {},
  };

  // Check database
  try {
    await postgresRepository.getDb().query('SELECT 1');
    health.checks.database = true;
  } catch (err) {
    health.checks.database = false;
    health.status = 'degraded';
  }

  const isHealthy = Object.values(health.checks).every((c) => c === true);
  res.status(isHealthy ? 200 : 503).json(health);
});

/**
 * TEST ENDPOINT: Direct OpenSky API call (for debugging)
 */
router.get('/test-opensky/:icao24', async (req, res, next) => {
  const { icao24 } = req.params;
  
  try {
    const openSkyService = require('../services/OpenSkyService');
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 24 * 60 * 60;
    
    // Try multiple time ranges
    const allFlights = [];
    for (let i = 1; i <= 4; i++) {
      const begin = now - ((i + 1) * oneDay);
      const end = now - (i * oneDay);
      
      try {
        const flights = await openSkyService.getFlightsByAircraft(icao24, begin, end);
        if (flights && flights.length > 0) {
          allFlights.push(...flights.map(f => ({
            ...f,
            timeRange: {
              begin: new Date(begin * 1000).toISOString(),
              end: new Date(end * 1000).toISOString(),
            },
          })));
        }
      } catch (err) {
        // Continue to next range
      }
    }
    
    return res.json({
      icao24,
      totalFlights: allFlights.length,
      flights: allFlights,
      rawData: allFlights.length > 0 ? allFlights[0] : null,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
