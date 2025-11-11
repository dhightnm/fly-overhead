import { Router, Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import aircraftService from '../services/AircraftService';
import satelliteService from '../services/SatelliteService';
import historyService from '../services/HistoryService';
import flightRouteService from '../services/FlightRouteService';
import flightPlanRouteService from '../services/FlightPlanRouteService';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { mapAircraftTypeToCategory } from '../utils/aircraftCategoryMapper';
import { requireApiKeyAuth } from '../middlewares/apiKeyAuth';

const router = Router();

const cache = new NodeCache({ stdTTL: 60, maxKeys: 100 });
export const boundsCache = new NodeCache({
  stdTTL: 2, // 2 seconds - short TTL to ensure fresh data after OpenSky updates
  maxKeys: 1000,
  checkperiod: 10,
});

const CURRENT_FLIGHT_THRESHOLD_SECONDS = 15 * 60; // 15 minutes
const LANDED_OVERRIDE_THRESHOLD_SECONDS = 30 * 60; // 30 minutes before forcing arrival location
const LANDED_STATUSES = new Set(['arrived', 'landed', 'completed', 'diverted', 'cancelled']);

const normalizeStatus = (status?: string | null): string | null => {
  if (!status || typeof status !== 'string') {
    return null;
  }
  return status.trim().toLowerCase();
};

const maybeOverrideWithArrivalLocation = (aircraft: any, route: any, dataAgeSeconds: number | null): void => {
  if (!route) {
    return;
  }

  const arrivalLocation = route?.arrivalAirport?.location;
  if (!arrivalLocation || typeof arrivalLocation.lat !== 'number' || typeof arrivalLocation.lng !== 'number') {
    return;
  }

  const normalizedStatus = normalizeStatus(route?.flightStatus);
  const hasArrivalStatus = normalizedStatus ? LANDED_STATUSES.has(normalizedStatus) : false;
  const actualArrivalTimestamp =
    typeof route?.flightData?.actualArrival === 'number' ? route.flightData.actualArrival : null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const actualArrivalAgeSeconds = actualArrivalTimestamp ? Math.max(0, nowSeconds - actualArrivalTimestamp) : null;
  const hasActualArrival = actualArrivalAgeSeconds !== null;
  const staleByAge = dataAgeSeconds !== null ? dataAgeSeconds > LANDED_OVERRIDE_THRESHOLD_SECONDS : false;

  if (!(hasArrivalStatus || hasActualArrival || staleByAge)) {
    return;
  }

  const previousLatitude = aircraft.latitude;
  const previousLongitude = aircraft.longitude;

  aircraft.latitude = arrivalLocation.lat;
  aircraft.longitude = arrivalLocation.lng;
  aircraft.on_ground = true;
  aircraft.velocity = 0;
  aircraft.true_track = null;
  aircraft.position_source = 'route-arrival';
  aircraft.data_source = aircraft.data_source || 'route';
  aircraft.isStale = true;
  aircraft.staleReason = hasArrivalStatus ? `flight_status:${normalizedStatus}` : 'route-arrival-inferred';

  logger.info('Overriding aircraft position with arrival airport due to stale data', {
    icao24: aircraft.icao24,
    previousLatitude,
    previousLongitude,
    arrivalLatitude: arrivalLocation.lat,
    arrivalLongitude: arrivalLocation.lng,
    dataAgeSeconds,
    normalizedStatus,
    hasActualArrival,
  });
};

/**
 * Get all aircraft (cached)
 * Requires API key authentication
 */
router.get('/area/all', requireApiKeyAuth, async (_req: Request, res: Response, next: NextFunction) => {
  const cacheKey = '/area/all';

  try {
    if (cache.has(cacheKey)) {
      logger.debug('Serving cached aircraft data');
      return res.status(200).json(cache.get(cacheKey));
    }

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
router.get('/planes/:identifier', async (req: Request, res: Response, next: NextFunction) => {
  const { identifier } = req.params;

  try {
    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);

    if (!aircraft) {
      logger.info(`Aircraft not found: ${identifier}`);
      return res.status(404).json({ error: 'Plane not found' });
    }

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const lastContact = typeof aircraft.last_contact === 'number' ? aircraft.last_contact : null;
      const dataAgeSeconds = lastContact !== null ? nowSeconds - lastContact : null;
      const isCurrentFlight = dataAgeSeconds === null || dataAgeSeconds <= CURRENT_FLIGHT_THRESHOLD_SECONDS;

      if (dataAgeSeconds !== null) {
        aircraft.data_age_seconds = dataAgeSeconds;
        aircraft.last_update_age_seconds = dataAgeSeconds;
      }

      logger.info('Fetching route for aircraft', {
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
        isCurrentFlight,
        lastContact: aircraft.last_contact,
        dataAgeSeconds,
      });

      const route = await flightRouteService.getFlightRoute(aircraft.icao24, aircraft.callsign, isCurrentFlight, true);
      if (route) {
        aircraft.route = route;

        // Update callsign from route if aircraft doesn't have one
        if (route.callsign && (!aircraft.callsign || aircraft.callsign.trim() === '')) {
          try {
            await postgresRepository.updateAircraftCallsign(aircraft.icao24, route.callsign);
            aircraft.callsign = route.callsign;
            logger.info('Updated aircraft callsign from route', {
              icao24: aircraft.icao24,
              callsign: route.callsign,
            });
          } catch (err) {
            const error = err as Error;
            logger.warn('Failed to update aircraft callsign from route', { error: error.message });
            // Still update in response even if DB update fails
            aircraft.callsign = route.callsign;
          }
        }

        if (aircraft.icao24 && (route.aircraft?.type || route.aircraft?.model)) {
          const inferredCategory = mapAircraftTypeToCategory(route.aircraft?.type, route.aircraft?.model);
          if (inferredCategory !== null && (aircraft.category === null || aircraft.category === 0)) {
            try {
              await postgresRepository.updateAircraftCategory(aircraft.icao24, inferredCategory);
              aircraft.category = inferredCategory;
            } catch (err) {
              const error = err as Error;
              logger.warn('Failed to update aircraft category in route fetch', { error: error.message });
            }
          }
        }

        maybeOverrideWithArrivalLocation(aircraft, route, dataAgeSeconds);
      }
    } catch (routeError) {
      const err = routeError as Error;
      logger.warn('Could not fetch route data', { error: err.message });
    }

    return res.json(aircraft);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get flight route for an aircraft
 */
router.get('/route/:identifier', async (req: Request, res: Response, next: NextFunction) => {
  const { identifier } = req.params;
  const { icao24, callsign } = req.query;

  try {
    let aircraftIcao24 = (icao24 as string) || identifier;
    let aircraftCallsign = callsign as string | undefined;
    let currentAircraft: any = null;

    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);
    if (aircraft) {
      aircraftIcao24 = aircraft.icao24;
      aircraftCallsign = aircraft.callsign;
      currentAircraft = aircraft;
    }

    const isCurrentFlight = true;

    logger.info('Fetching route (assumed current - visible/trackable aircraft)', {
      icao24: aircraftIcao24,
      callsign: aircraftCallsign,
      hasAircraftData: !!aircraft,
    });

    const route = await flightRouteService.getFlightRoute(aircraftIcao24, aircraftCallsign, isCurrentFlight, true);

    if (!route) {
      return res.status(404).json({ error: 'Flight route not found' });
    }

    let updatedCategory = currentAircraft?.category;
    if (aircraftIcao24 && (route.aircraft?.type || route.aircraft?.model)) {
      const inferredCategory = mapAircraftTypeToCategory(route.aircraft?.type, route.aircraft?.model);
      if (
        inferredCategory !== null &&
        (!currentAircraft || currentAircraft.category === null || currentAircraft.category === 0)
      ) {
        try {
          await postgresRepository.updateAircraftCategory(aircraftIcao24, inferredCategory);
          updatedCategory = inferredCategory;
        } catch (err) {
          const error = err as Error;
          logger.warn('Failed to update aircraft category in route fetch', { error: error.message });
        }
      }
    }

    return res.json({
      ...route,
      aircraftCategory: updatedCategory,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get aircraft within geographical bounds (CACHED + PostGIS optimized)
 */
router.get('/area/:latmin/:lonmin/:latmax/:lonmax', async (req: Request, res: Response, next: NextFunction) => {
  const { latmin, lonmin, latmax, lonmax } = req.params;

  const roundedLatMin = Math.floor(parseFloat(latmin) * 100) / 100;
  const roundedLonMin = Math.floor(parseFloat(lonmin) * 100) / 100;
  const roundedLatMax = Math.ceil(parseFloat(latmax) * 100) / 100;
  const roundedLonMax = Math.ceil(parseFloat(lonmax) * 100) / 100;

  const cacheKey = `/area/${roundedLatMin}/${roundedLonMin}/${roundedLatMax}/${roundedLonMax}`;

  try {
    if (boundsCache.has(cacheKey)) {
      logger.debug('Serving cached aircraft data for bounding box', { cacheKey });
      return res.json(boundsCache.get(cacheKey));
    }

    const aircraft = await aircraftService.getAircraftInBounds(
      parseFloat(latmin),
      parseFloat(lonmin),
      parseFloat(latmax),
      parseFloat(lonmax),
    );

    boundsCache.set(cacheKey, aircraft);
    logger.debug('Cached aircraft data for bounding box', {
      cacheKey,
      aircraftCount: aircraft.length,
    });

    return res.json(aircraft);
  } catch (err) {
    return next(err);
  }
});

/**
 * Trigger fetch and update aircraft in bounds (called by frontend on moveend)
 */
router.post('/area/fetch/:latmin/:lonmin/:latmax/:lonmax', async (req: Request, res: Response, next: NextFunction) => {
  const { latmin, lonmin, latmax, lonmax } = req.params;

  const boundingBox = {
    lamin: parseFloat(latmin),
    lomin: parseFloat(lonmin),
    lamax: parseFloat(latmax),
    lomax: parseFloat(lonmax),
  };

  try {
    await aircraftService.fetchAndUpdateAircraftInBounds(boundingBox);
    logger.info('Fetched and stored aircraft data for bounding box', {
      bounds: boundingBox,
      aircraftCount: 'updated in database',
    });
    return res.json({ success: true, message: 'Aircraft data fetched and stored' });
  } catch (err) {
    const error = err as Error;
    logger.error('Error fetching aircraft data for bounding box', {
      bounds: boundingBox,
      error: error.message,
    });
    return next(err);
  }
});

/**
 * Get satellites above observer location
 */
router.get(
  '/starlink/:observer_lat/:observer_lng/:observer_alt',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get historical flight path for an aircraft
 */
router.get('/history/:icao24', async (req: Request, res: Response, next: NextFunction) => {
  const { icao24 } = req.params;
  const { start, end } = req.query;

  try {
    const startDate = start ? new Date(start as string) : null;
    const endDate = end ? new Date(end as string) : null;
    const history = await historyService.getFlightPath(icao24, startDate, endDate);
    return res.json(history);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get historical statistics
 */
router.get('/history/stats/:icao24?', async (req: Request, res: Response, next: NextFunction) => {
  const { icao24 } = req.params;

  try {
    const stats = await historyService.getHistoryStats(icao24 || null);
    return res.json(stats);
  } catch (err) {
    return next(err);
  }
});

/**
 * Search historical flights by time range
 */
router.get('/history/search', async (req: Request, res: Response, next: NextFunction) => {
  const { start, end, limit = 100 } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end query parameters required' });
  }

  try {
    const flights = await historyService.searchFlightsByTimeRange(
      new Date(start as string),
      new Date(end as string),
      parseInt(limit as string, 10),
    );
    return res.json(flights);
  } catch (err) {
    return next(err);
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response) => {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {},
  };

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
router.get('/test-opensky/:icao24', async (req: Request, res: Response, next: NextFunction) => {
  const { icao24 } = req.params;

  try {
    const openSkyService = await import('../services/OpenSkyService');
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 24 * 60 * 60;

    const allFlights: any[] = [];
    for (let i = 1; i <= 4; i++) {
      const begin = now - (i + 1) * oneDay;
      const end = now - i * oneDay;

      try {
        const flights = await openSkyService.default.getFlightsByAircraft(icao24, begin, end);
        if (flights && flights.length > 0) {
          allFlights.push(
            ...flights.map((f: any) => ({
              ...f,
              timeRange: {
                begin: new Date(begin * 1000).toISOString(),
                end: new Date(end * 1000).toISOString(),
              },
            })),
          );
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
router.get('/spatial/near/:lat/:lon', async (req: Request, res: Response, next: NextFunction) => {
  const { lat, lon } = req.params;
  const { radius = 5000 } = req.query;

  try {
    // TODO: Implement findAircraftNearPoint in repository
    const aircraft: any[] = [];
    logger.warn('findAircraftNearPoint not yet implemented');

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius as string),
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
router.get('/spatial/path/:icao24', async (req: Request, res: Response, next: NextFunction) => {
  const { icao24 } = req.params;
  const { start, end } = req.query;

  try {
    // TODO: Implement getFlightPathGeoJSON in repository
    logger.warn('getFlightPathGeoJSON not yet implemented', { icao24, start, end });
    return res.status(501).json({ error: 'Not implemented' });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get traffic density heatmap
 */
router.get(
  '/spatial/density/:latmin/:lonmin/:latmax/:lonmax',
  async (req: Request, res: Response, next: NextFunction) => {
    const { latmin, lonmin, latmax, lonmax } = req.params;
    const { cellSize = 0.01 } = req.query;

    try {
      // TODO: Implement getTrafficDensity in repository
      logger.warn('getTrafficDensity not yet implemented', { latmin, lonmin, latmax, lonmax, cellSize });
      return res.status(501).json({ error: 'Not implemented' });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get spotting locations near an airport
 */
router.get('/spatial/spotting/:lat/:lon', async (req: Request, res: Response, next: NextFunction) => {
  const { lat, lon } = req.params;
  const { radius = 20 } = req.query;

  try {
    // TODO: Implement findSpottingLocations in repository
    logger.warn('findSpottingLocations not yet implemented', { lat, lon, radius });
    return res.status(501).json({ error: 'Not implemented' });
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
router.get('/airports/near/:lat/:lon', async (req: Request, res: Response, next: NextFunction) => {
  const { lat, lon } = req.params;
  const { radius = 50, type } = req.query;

  try {
    const airports = await postgresRepository.findAirportsNearPoint(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius as string),
      type as string | undefined,
    );

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius as string),
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
router.get(
  '/airports/bounds/:latmin/:lonmin/:latmax/:lonmax',
  async (req: Request, res: Response, next: NextFunction) => {
    const { latmin, lonmin, latmax, lonmax } = req.params;
    const { type, limit = 100 } = req.query;

    try {
      const airports = await postgresRepository.findAirportsInBounds(
        parseFloat(latmin),
        parseFloat(lonmin),
        parseFloat(latmax),
        parseFloat(lonmax),
        (type as string | undefined) || null,
        parseInt(limit as string, 10),
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
  },
);

/**
 * Get airport by IATA/ICAO code (includes runways and frequencies)
 */
router.get('/airports/:code', async (req: Request, res: Response, next: NextFunction) => {
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
router.get('/airports/search/:term', async (req: Request, res: Response, next: NextFunction) => {
  const { term } = req.params;
  const { limit = 10 } = req.query;

  try {
    const airports = await postgresRepository.searchAirports(term, parseInt(limit as string, 10));

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
router.get('/navaids/near/:lat/:lon', async (req: Request, res: Response, next: NextFunction) => {
  const { lat, lon } = req.params;
  const { radius = 50, type } = req.query;

  try {
    const navaids = await postgresRepository.findNavaidsNearPoint(
      parseFloat(lat),
      parseFloat(lon),
      parseFloat(radius as string),
      (type as string | undefined) || null,
    );

    return res.json({
      center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      radius: parseFloat(radius as string),
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
router.get('/routes/stats', async (_req: Request, res: Response, next: NextFunction) => {
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
 */
router.get('/flightplan/:identifier', async (req: Request, res: Response, next: NextFunction) => {
  const { identifier } = req.params;
  const { icao24, callsign } = req.query;

  try {
    const aircraft = await aircraftService.getAircraftByIdentifier(identifier);
    const aircraftIcao24 = (icao24 as string) || aircraft?.icao24 || identifier;
    const aircraftCallsign = (callsign as string) || aircraft?.callsign;

    logger.info('Fetching flight plan route', {
      identifier,
      icao24: aircraftIcao24,
      callsign: aircraftCallsign,
    });

    const flightPlanRoute = await flightPlanRouteService.getFlightPlanRoute(aircraftIcao24, aircraftCallsign);

    if (!flightPlanRoute) {
      return res.status(404).json({
        error: 'Flight plan route not found',
        message: 'No route data available for this aircraft',
        available: false,
      });
    }

    if (flightPlanRoute.available === false) {
      return res.json(flightPlanRoute);
    }

    return res.json(flightPlanRoute);
  } catch (err) {
    return next(err);
  }
});

/**
 * TEST ENDPOINT: Check route data availability and format
 */
router.get('/flightplan/test/data', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const testResults = await flightPlanRouteService.testRouteDataAvailability();
    return res.json(testResults);
  } catch (err) {
    return next(err);
  }
});

export default router;
