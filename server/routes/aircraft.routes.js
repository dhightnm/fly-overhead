const router = require('express').Router();
const NodeCache = require('node-cache');
const aircraftService = require('../services/AircraftService');
const satelliteService = require('../services/SatelliteService');
const historyService = require('../services/HistoryService');
const flightRouteService = require('../services/FlightRouteService');
const flightPlanRouteService = require('../services/FlightPlanRouteService');
const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');
const { mapAircraftTypeToCategory } = require('../utils/aircraftCategoryMapper');

const cache = new NodeCache({ stdTTL: 60, maxKeys: 100 });

// Enhanced cache for bounding box queries (shorter TTL for freshness)
const boundsCache = new NodeCache({ 
  stdTTL: 5, // 5 second cache for faster updates on zoom/pan
  maxKeys: 1000, // Cache up to 1000 different bounding boxes
  checkperiod: 60, // Check for expired keys every minute
});

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
        isCurrentFlight,
        true, // allowExpensiveApis=true (user-initiated request)
      );
      if (route) {
        aircraft.route = route;
        
        // Update aircraft category if we got type/model from route
        if (aircraft.icao24 && (route.aircraft?.type || route.aircraft?.model)) {
          const inferredCategory = mapAircraftTypeToCategory(route.aircraft?.type, route.aircraft?.model);
          if (inferredCategory !== null && (aircraft.category === null || aircraft.category === 0)) {
            try {
              await postgresRepository.updateAircraftCategory(aircraft.icao24, inferredCategory);
              aircraft.category = inferredCategory; // Update in response
            } catch (err) {
              logger.warn('Failed to update aircraft category in route fetch', { error: err.message });
            }
          }
        }
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
    let currentAircraft = null;

    // Always try to get aircraft data to check if it's a current flight
    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);
    if (aircraft) {
      aircraftIcao24 = aircraft.icao24;
      aircraftCallsign = aircraft.callsign;
      currentAircraft = aircraft;
    }

    // If we're querying route for an aircraft, assume it's CURRENT
    // (because if it's on the map, it's being tracked now)
    // OpenSky routes endpoint only has historical data (previous day+)
    // Use FlightAware for current flights instead
    const isCurrentFlight = true;

    logger.info('Fetching route (assumed current - visible/trackable aircraft)', {
      icao24: aircraftIcao24,
      callsign: aircraftCallsign,
      hasAircraftData: !!aircraft,
    });

    const route = await flightRouteService.getFlightRoute(
      aircraftIcao24,
      aircraftCallsign,
      isCurrentFlight,
      true, // allowExpensiveApis=true (user-initiated request via /api/route)
    );

    if (!route) {
      return res.status(404).json({ error: 'Flight route not found' });
    }

    // Update aircraft category if we got type/model from route and aircraft exists
    let updatedCategory = currentAircraft?.category;
    if (aircraftIcao24 && (route.aircraft?.type || route.aircraft?.model)) {
      const inferredCategory = mapAircraftTypeToCategory(route.aircraft?.type, route.aircraft?.model);
      if (inferredCategory !== null && (!currentAircraft || currentAircraft.category === null || currentAircraft.category === 0)) {
        try {
          await postgresRepository.updateAircraftCategory(aircraftIcao24, inferredCategory);
          updatedCategory = inferredCategory;
        } catch (err) {
          logger.warn('Failed to update aircraft category in route fetch', { error: err.message });
        }
      }
    }

    // Include updated category in response so frontend can update the plane object
    return res.json({
      ...route,
      aircraftCategory: updatedCategory, // Include category so frontend can update
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get aircraft within geographical bounds
 */
/**
 * Get aircraft within geographical bounds (CACHED + PostGIS optimized)
 */
router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req, res, next) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;

  // Create cache key from bounding box (rounded to reduce cache fragmentation)
  // Round to 2 decimal places (~1.1km precision) to improve cache hits
  const roundedLatMin = Math.floor(parseFloat(latmin) * 100) / 100;
  const roundedLonMin = Math.floor(parseFloat(lonmin) * 100) / 100;
  const roundedLatMax = Math.ceil(parseFloat(latmax) * 100) / 100;
  const roundedLonMax = Math.ceil(parseFloat(lonmax) * 100) / 100;
  
  const cacheKey = `/area/${roundedLatMin}/${roundedLonMin}/${roundedLatMax}/${roundedLonMax}`;

  try {
    // Check cache first
    if (boundsCache.has(cacheKey)) {
      logger.debug('Serving cached aircraft data for bounding box', { cacheKey });
      return res.json(boundsCache.get(cacheKey));
    }

    // Cache miss - fetch from database only
    // Note: Fresh data fetching is triggered by frontend on moveend via /api/area/fetch endpoint
    const aircraft = await aircraftService.getAircraftInBounds(
      parseFloat(latmin),
      parseFloat(lonmin),
      parseFloat(latmax),
      parseFloat(lonmax),
    );

    // Store in cache
    boundsCache.set(cacheKey, aircraft);
    logger.debug('Cached aircraft data for bounding box', { 
      cacheKey, 
      aircraftCount: aircraft.length 
    });

    return res.json(aircraft);
  } catch (err) {
    return next(err);
  }
});

/**
 * Trigger fetch and update aircraft in bounds (called by frontend on moveend)
 * This fetches from OpenSky/FlightAware and stores in database
 */
router.post('/area/fetch/:latmin/:lonmin/:latmax/:lonmax', async (req, res, next) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;

  const boundingBox = {
    lamin: parseFloat(latmin),
    lomin: parseFloat(lonmin),
    lamax: parseFloat(latmax),
    lomax: parseFloat(lonmax),
  };

  try {
    // Fetch and update aircraft in bounds (will use FlightAware if OpenSky is rate-limited)
    await aircraftService.fetchAndUpdateAircraftInBounds(boundingBox);
    logger.info('Fetched and stored aircraft data for bounding box', {
      bounds: boundingBox,
      aircraftCount: 'updated in database',
    });
    return res.json({ success: true, message: 'Aircraft data fetched and stored' });
  } catch (err) {
    logger.error('Error fetching aircraft data for bounding box', {
      bounds: boundingBox,
      error: err.message,
    });
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
    const flights = await historyService.searchFlightsByTimeRange(start, end, parseInt(limit, 10));
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
    // eslint-disable-next-line global-require
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
          allFlights.push(...flights.map((f) => ({
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

/**
 * PostGIS Spatial Endpoints
 */

/**
 * Get aircraft near a point
 */
router.get('/spatial/near/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  const { radius = 5000 } = req.query; // radius in meters, default 5km

  try {
    const aircraft = await postgresRepository.findAircraftNearPoint(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius),
    );

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius),
      count: aircraft.length,
      aircraft,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get flight path as GeoJSON
 */
router.get('/spatial/path/:icao24', async (req, res, next) => {
  const { icao24 } = req.params;
  const { start, end } = req.query;

  try {
    const path = await postgresRepository.getFlightPathGeoJSON(icao24, start, end);

    if (!path) {
      return res.status(404).json({ error: 'No flight path found' });
    }

    return res.json({
      type: 'Feature',
      properties: {
        icao24: path.icao24,
        callsign: path.callsign,
        startTime: path.start_time,
        endTime: path.end_time,
        pointCount: path.point_count,
      },
      geometry: JSON.parse(path.path_geojson),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get traffic density heatmap
 */
router.get('/spatial/density/:latmin/:lonmin/:latmax/:lonmax', async (req, res, next) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;
  const { cellSize = 0.01 } = req.query;

  try {
    const density = await postgresRepository.getTrafficDensity(
      {
        latmin: parseFloat(latmin),
        lonmin: parseFloat(lonmin),
        latmax: parseFloat(latmax),
        lonmax: parseFloat(lonmax),
      },
      parseFloat(cellSize),
    );

    return res.json({
      bounds: {
        latmin, lonmin, latmax, lonmax,
      },
      cellSize: parseFloat(cellSize),
      cells: density,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get spotting locations near an airport
 */
router.get('/spatial/spotting/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  const { radius = 20 } = req.query; // radius in km, default 20km

  try {
    const locations = await postgresRepository.findSpottingLocations(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius),
    );

    return res.json({
      airport: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius),
      count: locations.length,
      locations,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Airport Data Endpoints
 */

/**
 * Find airports near a location
 */
router.get('/airports/near/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  const { radius = 50, type } = req.query;

  try {
    const airports = await postgresRepository.findAirportsNearPoint(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius),
      type,
    );

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius),
      count: airports.length,
      airports,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get airports within bounding box (for map viewport)
 */
router.get('/airports/bounds/:latmin/:lonmin/:latmax/:lonmax', async (req, res, next) => {
  const {
    latmin, lonmin, latmax, lonmax,
  } = req.params;
  const { type, limit = 100 } = req.query;

  try {
    const airports = await postgresRepository.findAirportsInBounds(
      parseFloat(latmin),
      parseFloat(lonmin),
      parseFloat(latmax),
      parseFloat(lonmax),
      type || null,
      parseInt(limit, 10),
    );

    return res.json({
      bounds: {
        latmin: parseFloat(latmin),
        lonmin: parseFloat(lonmin),
        latmax: parseFloat(latmax),
        lonmax: parseFloat(lonmax),
      },
      count: airports.length,
      airports,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get airport by IATA/ICAO code (includes runways and frequencies)
 */
router.get('/airports/:code', async (req, res, next) => {
  const { code } = req.params;

  try {
    const airport = await postgresRepository.findAirportByCode(code);

    if (!airport) {
      return res.status(404).json({ error: 'Airport not found' });
    }

    return res.json(airport);
  } catch (err) {
    return next(err);
  }
});

/**
 * Search airports by name or code
 */
router.get('/airports/search/:term', async (req, res, next) => {
  const { term } = req.params;
  const { limit = 10 } = req.query;

  try {
    const airports = await postgresRepository.searchAirports(term, parseInt(limit, 10));

    return res.json({
      searchTerm: term,
      count: airports.length,
      airports,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Find navaids near a location
 */
router.get('/navaids/near/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  const { radius = 50, type } = req.query;

  try {
    const navaids = await postgresRepository.findNavaidsNearPoint(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius),
      type,
    );

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius),
      count: navaids.length,
      navaids,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get route statistics (history + cache)
 */
router.get('/routes/stats', async (req, res, next) => {
  try {
    const stats = await postgresRepository.getRouteStats();
    return res.json({
      history: {
        total: parseInt(stats.history_total, 10),
        complete: parseInt(stats.history_complete, 10),
      },
      cache: {
        total: parseInt(stats.cache_total, 10),
        complete: parseInt(stats.cache_complete, 10),
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get flight plan route waypoints for an aircraft
 * Returns parsed route string as coordinates from navaids table
 */
router.get('/flightplan/:identifier', async (req, res, next) => {
  const { identifier } = req.params;
  const { icao24, callsign } = req.query;

  try {
    // Try to get aircraft data first
    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);
    const aircraftIcao24 = icao24 || aircraft?.icao24 || identifier;
    const aircraftCallsign = callsign || aircraft?.callsign;

    logger.info('Fetching flight plan route', {
      identifier,
      icao24: aircraftIcao24,
      callsign: aircraftCallsign,
    });

    const flightPlanRoute = await flightPlanRouteService.getFlightPlanRoute(
      aircraftIcao24,
      aircraftCallsign,
    );

    // Return response even if route is not available (frontend will show warning)
    if (!flightPlanRoute) {
      return res.status(404).json({
        error: 'Flight plan route not found',
        message: 'No route data available for this aircraft',
        available: false,
      });
    }

    // Check if route is available (has waypoints)
    if (flightPlanRoute.available === false) {
      // Return 200 with availability status so frontend can show warning
      return res.json(flightPlanRoute);
    }

    return res.json(flightPlanRoute);
  } catch (err) {
    return next(err);
  }
});

/**
 * TEST ENDPOINT: Check route data availability and format
 * Returns statistics and sample routes for testing
 */
router.get('/flightplan/test/data', async (req, res, next) => {
  try {
    const testResults = await flightPlanRouteService.testRouteDataAvailability();
    return res.json(testResults);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
