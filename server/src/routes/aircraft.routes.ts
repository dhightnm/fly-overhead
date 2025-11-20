import {
  Router, Request, Response, NextFunction,
} from 'express';
import dns from 'dns';
import { promisify } from 'util';
import axios from 'axios';
import NodeCache from 'node-cache';
import aircraftService from '../services/AircraftService';
import airplanesLiveService from '../services/AirplanesLiveService';
import satelliteService from '../services/SatelliteService';
import historyService from '../services/HistoryService';
import flightRouteService from '../services/FlightRouteService';
import flightPlanRouteService from '../services/FlightPlanRouteService';
import postgresRepository from '../repositories/PostgresRepository';
import queueService from '../services/QueueService';
import liveStateStore from '../services/LiveStateStore';
import logger from '../utils/logger';
import { mapAircraftTypeToCategory } from '../utils/aircraftCategoryMapper';
import { requireApiKeyAuth, optionalApiKeyAuth, type AuthenticatedRequest } from '../middlewares/apiKeyAuth';
import { rateLimitMiddleware } from '../middlewares/rateLimitMiddleware';
import config from '../config';
import { STATE_INDEX, applyStateToRecord, type DbAircraftRow } from '../utils/aircraftState';

const router = Router();

const cache = new NodeCache({ stdTTL: 60, maxKeys: 100 });
export const boundsCache = new NodeCache({
  stdTTL: 2, // 2 seconds - short TTL to ensure fresh data after OpenSky updates
  maxKeys: 1000,
  checkperiod: 10,
});

const NM_TO_LAT_DEGREES = 1 / 60; // Rough conversion (1 NM = 1 minute of latitude)
const BOUNDS_RECENT_WINDOW_SECONDS = 15 * 60; // 15 minutes of recency for bounds queries

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createBoundingBox(lat: number, lon: number, radiusNm: number) {
  const latRadius = radiusNm * NM_TO_LAT_DEGREES;
  const latMin = clamp(lat - latRadius, -90, 90);
  const latMax = clamp(lat + latRadius, -90, 90);

  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(latRad), 0.0001);
  const lonRadius = radiusNm / (60 * cosLat);
  const lonMin = clamp(lon - lonRadius, -180, 180);
  const lonMax = clamp(lon + lonRadius, -180, 180);

  return {
    latMin, latMax, lonMin, lonMax,
  };
}

const CURRENT_FLIGHT_THRESHOLD_SECONDS = 15 * 60; // 15 minutes
const LANDED_OVERRIDE_THRESHOLD_SECONDS = 30 * 60; // 30 minutes before forcing arrival location
const LANDED_STATUSES = new Set(['arrived', 'landed', 'completed', 'diverted', 'cancelled']);
const ROUTE_LOOKUP_TIMEOUT_MS = parseInt(process.env.ROUTE_LOOKUP_TIMEOUT_MS || '2000', 10);
const ROUTE_CACHE_MAX_AGE_HOURS = Number.parseInt(process.env.ROUTE_CACHE_MAX_AGE_HOURS || '3', 10);
const ROUTE_CACHE_MAX_AGE_MS = Number.isFinite(ROUTE_CACHE_MAX_AGE_HOURS)
  ? ROUTE_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000
  : 3 * 60 * 60 * 1000;

function mergeLiveSamplesWithDb(
  dbRows: DbAircraftRow[],
  liveStates: any[],
): DbAircraftRow[] {
  if (!liveStates.length) {
    return dbRows;
  }

  const merged = new Map<string, DbAircraftRow>();
  dbRows.forEach((row) => {
    if (row.icao24) {
      merged.set(row.icao24, { ...row });
    }
  });

  liveStates.forEach((state) => {
    const icao24 = state[STATE_INDEX.ICAO24];
    if (!icao24) {
      return;
    }
    const existing = merged.get(icao24);
    merged.set(icao24, applyStateToRecord(existing, state));
  });

  return Array.from(merged.values());
}

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
  const actualArrivalTimestamp = typeof route?.flightData?.actualArrival === 'number' ? route.flightData.actualArrival : null;
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
 * NEW ENDPOINT: Get flights from airplanes.live API
 * Uses optionalApiKeyAuth to allow webapp (same-origin) requests
 * Enforces 1 req/sec rate limit and caches responses
 */
router.get(
  '/flights',
  optionalApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { lat, lon, radius } = req.query;

    // Validate parameters
    if (!lat || !lon) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'lat and lon are required',
      });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lon as string);
    const radiusNm = radius ? parseFloat(radius as string) : 100; // Default 100nm

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusNm)) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'lat, lon, and radius must be valid numbers',
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        error: 'Invalid latitude',
        message: 'Latitude must be between -90 and 90',
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        error: 'Invalid longitude',
        message: 'Longitude must be between -180 and 180',
      });
    }

    try {
      const clampedRadius = Math.min(radiusNm, config.external.airplanesLive?.maxRadiusNm || 250);

      const result = await airplanesLiveService.getAircraftNearPoint({
        lat: latitude,
        lon: longitude,
        radiusNm: clampedRadius,
      });

      let preparedStates: any[] = [];

      if (result.ac && result.ac.length > 0) {
        preparedStates = result.ac
          .filter((aircraft) => aircraft.lat && aircraft.lon)
          .map((aircraft) => airplanesLiveService.prepareStateForDatabase(aircraft));

        liveStateStore.upsertStates(preparedStates);

        if (queueService.isEnabled()) {
          await queueService.enqueueAircraftStates(
            preparedStates.map((state) => ({
              state,
              source: 'airplanes.live',
              sourcePriority: 20,
              ingestionTimestamp: new Date().toISOString(),
            })),
          );
        } else {
          await Promise.all(
            preparedStates.map((state) => postgresRepository
              .upsertAircraftStateWithPriority(state, null, new Date(), 'airplanes.live', 20, true)
              .catch((error: Error) => {
                logger.debug('Failed to store aircraft from airplanes.live', {
                  icao24: state[0],
                  error: error.message,
                });
              })),
          );
        }
      }

      const {
        latMin, latMax, lonMin, lonMax,
      } = createBoundingBox(latitude, longitude, clampedRadius);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const recentThreshold = nowSeconds - BOUNDS_RECENT_WINDOW_SECONDS;
      const liveStateSamples = config.liveState.enabled
        ? liveStateStore.getStatesInBounds(latMin, lonMin, latMax, lonMax, recentThreshold)
        : [];

      let aircraftStates: DbAircraftRow[] = [];
      const shouldQueryDb = !config.liveState.enabled
        || liveStateSamples.length < liveStateStore.getMinResultsBeforeFallback();

      if (shouldQueryDb) {
        aircraftStates = await postgresRepository.findAircraftInBounds(
          latMin,
          lonMin,
          latMax,
          lonMax,
          recentThreshold,
        );
      }

      const mergedAircraft = mergeLiveSamplesWithDb(
        aircraftStates,
        liveStateSamples.length ? liveStateSamples : preparedStates,
      );

      return res.json({
        success: true,
        aircraft: mergedAircraft,
        total: mergedAircraft.length,
        timestamp: nowSeconds,
        source: 'airplanes.live',
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Test airplanes.live connection
 * Accessible without API key for debugging
 */
router.get('/test-airplanes-live', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await airplanesLiveService.testConnection();
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get CONUS polling service status
 * Shows current polling progress and statistics
 */
router.get('/conus-polling-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const conusPollingService = await import('../services/ConusPollingService');
    const status = conusPollingService.default.getStatus();
    return res.json(status);
  } catch (err) {
    return next(err);
  }
});

/**
 * Get all aircraft (cached)
 * Requires API key authentication with rate limiting
 */
router.get(
  '/area/all',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get aircraft by identifier (icao24 or callsign)
 * Requires API key authentication with rate limiting
 */
router.get(
  '/planes/:identifier',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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

        const route = await flightRouteService.getFlightRoute(
          aircraft.icao24,
          aircraft.callsign,
          isCurrentFlight,
          true,
        );
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
  },
);

/**
 * Get route statistics (history + cache)
 * Requires API key authentication with rate limiting
 * NOTE: This must come before /route/:identifier to ensure proper route matching
 */
router.get(
  '/routes/stats',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
  },
);

const hasArrivalData = (route?: any | null): boolean => !!(route?.arrivalAirport?.icao || route?.arrivalAirport?.iata);

const getRouteAgeMs = (route?: any | null): number => {
  if (!route?.cachedAt) return Number.POSITIVE_INFINITY;
  const cachedAtDate = route.cachedAt instanceof Date ? route.cachedAt : new Date(route.cachedAt);
  return Date.now() - cachedAtDate.getTime();
};

const respondWithRoute = async (
  res: Response,
  route: any,
  aircraftIcao24: string | null | undefined,
  currentAircraft: any,
): Promise<Response> => {
  const { cachedAt, ...routePayload } = route || {};

  let updatedCategory = currentAircraft?.category;
  if (aircraftIcao24 && (route.aircraft?.type || route.aircraft?.model)) {
    const inferredCategory = mapAircraftTypeToCategory(route.aircraft?.type, route.aircraft?.model);
    if (
      inferredCategory !== null
      && (!currentAircraft || currentAircraft.category === null || currentAircraft.category === 0)
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
    ...routePayload,
    aircraftCategory: updatedCategory,
  });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => Promise.race([
  promise,
  new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  }),
]);

/**
 * Get flight route for an aircraft
 * Requires API key authentication with rate limiting
 */
router.get(
  '/route/:identifier',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { identifier } = req.params;
    const { icao24, callsign, refresh } = req.query;

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
      const prefersFreshLookup = refresh === 'true';

      logger.info('Fetching route (assumed current - visible/trackable aircraft)', {
        icao24: aircraftIcao24,
        callsign: aircraftCallsign,
        hasAircraftData: !!aircraft,
        prefersFreshLookup,
      });

      const cachedRoute = await flightRouteService.getFlightRoute(
        aircraftIcao24,
        aircraftCallsign,
        isCurrentFlight,
        false,
      );
      const cacheHasArrival = hasArrivalData(cachedRoute);
      const cacheAgeMs = getRouteAgeMs(cachedRoute);
      const cacheFresh = cacheAgeMs <= ROUTE_CACHE_MAX_AGE_MS;
      const cacheUsable = cachedRoute && cacheHasArrival && cacheFresh;

      if (cacheUsable && !prefersFreshLookup) {
        return respondWithRoute(res, cachedRoute, aircraftIcao24, currentAircraft);
      }

      const fallbackRoute = cacheHasArrival ? cachedRoute : null;

      if (!cacheUsable) {
        // Cache is missing, stale, or incomplete – block until we get fresh data
        const freshRoute = await flightRouteService.getFlightRoute(
          aircraftIcao24,
          aircraftCallsign,
          isCurrentFlight,
          true,
        );

        if (freshRoute) {
          return respondWithRoute(res, freshRoute, aircraftIcao24, currentAircraft);
        }

        if (fallbackRoute) {
          logger.warn('Returning stale route data due to upstream failure', {
            icao24: aircraftIcao24,
            callsign: aircraftCallsign,
          });
          return respondWithRoute(res, fallbackRoute, aircraftIcao24, currentAircraft);
        }

        return res.status(404).json({ error: 'Flight route not found' });
      }

      // We have a usable cache but the caller requested a refresh. Respond fast,
      // but still kick off a refresh and try to include it if it finishes quickly.
      const freshRoutePromise = flightRouteService.getFlightRoute(
        aircraftIcao24,
        aircraftCallsign,
        isCurrentFlight,
        true,
      );

      const freshRoute = await withTimeout(freshRoutePromise, ROUTE_LOOKUP_TIMEOUT_MS);

      if (freshRoute && hasArrivalData(freshRoute)) {
        return respondWithRoute(res, freshRoute, aircraftIcao24, currentAircraft);
      }

      freshRoutePromise
        .then((routeData) => {
          if (routeData) {
            logger.info('Background route refresh completed', {
              icao24: aircraftIcao24,
              callsign: aircraftCallsign,
            });
          }
        })
        .catch((error: Error) => {
          logger.warn('Background route refresh failed', {
            icao24: aircraftIcao24,
            callsign: aircraftCallsign,
            error: error.message,
          });
        });

      if (!cachedRoute) {
        return res.status(500).json({ error: 'Unable to load route from cache' });
      }
      return respondWithRoute(res, cachedRoute, aircraftIcao24, currentAircraft);
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get aircraft within geographical bounds (CACHED + PostGIS optimized)
 * Requires API key authentication with rate limiting
 */
router.get(
  '/area/:latmin/:lonmin/:latmax/:lonmax',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      latmin, lonmin, latmax, lonmax,
    } = req.params;

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
  },
);

/**
 * Trigger fetch and update aircraft in bounds (called by frontend on moveend)
 * Requires API key authentication with rate limiting
 */
router.post(
  '/area/fetch/:latmin/:lonmin/:latmax/:lonmax',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Manually trigger OpenSky fetch for all aircraft (admin/debug endpoint)
 * Requires API key authentication with rate limiting
 */
router.post(
  '/fetch/all',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Manual OpenSky fetch triggered via API');
      const result = await aircraftService.fetchAndUpdateAllAircraft();
      return res.json({
        success: true,
        message: 'Aircraft data fetched and stored',
        aircraftCount: result.length,
      });
    } catch (err) {
      const error = err as Error & { rateLimited?: boolean };
      if (error.rateLimited) {
        return res.status(429).json({
          success: false,
          error: 'OpenSky API rate limited',
          retryAfter: (error as any).retryAfter,
        });
      }
      return next(err);
    }
  },
);

/**
 * Get satellites above observer location
 * Requires API key authentication with rate limiting
 */
router.get(
  '/starlink/:observer_lat/:observer_lng/:observer_alt',
  requireApiKeyAuth,
  rateLimitMiddleware,
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
 * Requires API key authentication with rate limiting
 */
router.get(
  '/history/:icao24',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get historical statistics
 * Requires API key authentication with rate limiting
 */
router.get(
  '/history/stats/:icao24?',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { icao24 } = req.params;

    try {
      const stats = await historyService.getHistoryStats(icao24 || null);
      return res.json(stats);
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Search historical flights by time range
 * Requires API key authentication with rate limiting
 */
router.get(
  '/history/search',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

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
 * Diagnostic endpoint: Check data freshness and feeder status
 * Requires API key authentication with rate limiting
 */
router.get(
  '/diagnostics/data-freshness',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const now = Math.floor(Date.now() / 1000);

      // Get data freshness stats
      const freshnessStats = await postgresRepository.getDb().one(
        `
        SELECT 
          COUNT(*) as total_aircraft,
          COUNT(CASE WHEN last_contact IS NOT NULL THEN 1 END) as aircraft_with_contact,
          COUNT(CASE WHEN last_contact > $1 - 600 THEN 1 END) as fresh_10min,
          COUNT(CASE WHEN last_contact > $1 - 1800 THEN 1 END) as fresh_30min,
          COUNT(CASE WHEN last_contact > $1 - 3600 THEN 1 END) as fresh_1hour,
          MAX(last_contact) as newest_contact,
          MIN(last_contact) as oldest_contact,
          AVG($1 - last_contact) as avg_age_seconds,
          COUNT(CASE WHEN data_source = 'feeder' THEN 1 END) as from_feeder,
          COUNT(CASE WHEN data_source = 'opensky' THEN 1 END) as from_opensky,
          MAX(ingestion_timestamp) as newest_ingestion
        FROM aircraft_states
        WHERE last_contact IS NOT NULL
      `,
        [now],
      );

      // Get feeder stats
      const feederStats = await postgresRepository.getDb().any(`
        SELECT 
          feeder_id,
          name,
          last_seen,
          EXTRACT(EPOCH FROM (NOW() - last_seen)) as seconds_since_last_seen
        FROM feeders
        ORDER BY last_seen DESC
        LIMIT 10
      `);

      // Get recent aircraft by source
      const recentBySource = await postgresRepository.getDb().any(
        `
        SELECT 
          data_source,
          COUNT(*) as count,
          AVG($1 - last_contact) as avg_age_seconds,
          MAX(last_contact) as newest_contact
        FROM aircraft_states
        WHERE last_contact IS NOT NULL
        GROUP BY data_source
        ORDER BY count DESC
      `,
        [now],
      );

      return res.json({
        timestamp: new Date().toISOString(),
        currentTime: now,
        freshness: {
          totalAircraft: parseInt(freshnessStats.total_aircraft, 10),
          aircraftWithContact: parseInt(freshnessStats.aircraft_with_contact, 10),
          fresh10min: parseInt(freshnessStats.fresh_10min, 10),
          fresh30min: parseInt(freshnessStats.fresh_30min, 10),
          fresh1hour: parseInt(freshnessStats.fresh_1hour, 10),
          newestContact: freshnessStats.newest_contact
            ? new Date(freshnessStats.newest_contact * 1000).toISOString()
            : null,
          oldestContact: freshnessStats.oldest_contact
            ? new Date(freshnessStats.oldest_contact * 1000).toISOString()
            : null,
          avgAgeSeconds: freshnessStats.avg_age_seconds ? Math.round(parseFloat(freshnessStats.avg_age_seconds)) : null,
          newestIngestion: freshnessStats.newest_ingestion
            ? new Date(freshnessStats.newest_ingestion).toISOString()
            : null,
        },
        bySource: {
          feeder: parseInt(freshnessStats.from_feeder, 10),
          opensky: parseInt(freshnessStats.from_opensky, 10),
        },
        recentBySource: recentBySource.map((row: any) => ({
          source: row.data_source,
          count: parseInt(row.count, 10),
          avgAgeSeconds: row.avg_age_seconds ? Math.round(parseFloat(row.avg_age_seconds)) : null,
          newestContact: row.newest_contact ? new Date(row.newest_contact * 1000).toISOString() : null,
        })),
        feeders: feederStats.map((feeder: any) => ({
          feederId: feeder.feeder_id,
          name: feeder.name,
          lastSeen: feeder.last_seen ? new Date(feeder.last_seen).toISOString() : null,
          secondsSinceLastSeen: feeder.seconds_since_last_seen
            ? Math.round(parseFloat(feeder.seconds_since_last_seen))
            : null,
        })),
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * TEST ENDPOINT: Direct OpenSky API call (for debugging)
 * Requires API key authentication
 */
router.get(
  '/test-opensky/:icao24',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * PostGIS Spatial Endpoints
 */

/**
 * Get aircraft near a point
 * Requires API key authentication with rate limiting
 */
router.get(
  '/spatial/near/:lat/:lon',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get flight path as GeoJSON
 * Requires API key authentication with rate limiting
 */
router.get(
  '/spatial/path/:icao24',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { icao24 } = req.params;
    const { start, end } = req.query;

    try {
      // TODO: Implement getFlightPathGeoJSON in repository
      logger.warn('getFlightPathGeoJSON not yet implemented', { icao24, start, end });
      return res.status(501).json({ error: 'Not implemented' });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get traffic density heatmap
 * Requires API key authentication with rate limiting
 */
router.get(
  '/spatial/density/:latmin/:lonmin/:latmax/:lonmax',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      latmin, lonmin, latmax, lonmax,
    } = req.params;
    const { cellSize = 0.01 } = req.query;

    try {
      // TODO: Implement getTrafficDensity in repository
      logger.warn('getTrafficDensity not yet implemented', {
        latmin, lonmin, latmax, lonmax, cellSize,
      });
      return res.status(501).json({ error: 'Not implemented' });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get spotting locations near an airport
 * Requires API key authentication with rate limiting
 */
router.get(
  '/spatial/spotting/:lat/:lon',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { lat, lon } = req.params;
    const { radius = 20 } = req.query;

    try {
      // TODO: Implement findSpottingLocations in repository
      logger.warn('findSpottingLocations not yet implemented', { lat, lon, radius });
      return res.status(501).json({ error: 'Not implemented' });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Airport Data Endpoints
 */

/**
 * Find airports near a location
 * Requires API key authentication with rate limiting
 */
router.get(
  '/airports/near/:lat/:lon',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get airports within bounding box (for map viewport)
 * Requires API key authentication with rate limiting
 */
router.get(
  '/airports/bounds/:latmin/:lonmin/:latmax/:lonmax',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
 * Requires API key authentication with rate limiting
 */
router.get(
  '/airports/:code',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Search airports by name or code
 * Requires API key authentication with rate limiting
 */
router.get(
  '/airports/search/:term',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Find navaids near a location
 * Requires API key authentication with rate limiting
 */
router.get(
  '/navaids/near/:lat/:lon',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * Get flight plan route waypoints for an aircraft
 * Requires API key authentication with rate limiting
 */
router.get(
  '/flightplan/:identifier',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

/**
 * TEST ENDPOINT: Check route data availability and format
 * Requires API key authentication with rate limiting
 */
router.get(
  '/flightplan/test/data',
  requireApiKeyAuth,
  rateLimitMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const testResults = await flightPlanRouteService.testRouteDataAvailability();
      return res.json(testResults);
    } catch (err) {
      return next(err);
    }
  },
);

// Diagnostic endpoint to test network connectivity from inside the container
router.get('/diagnostics/network', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const dnsLookup = promisify(dns.lookup);

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: [],
    };

    // Test 1: DNS Resolution for OpenSky
    try {
      const startTime = Date.now();
      const addresses = await dnsLookup('opensky-network.org');
      const duration = Date.now() - startTime;
      results.tests.push({
        name: 'DNS Resolution (OpenSky)',
        status: 'success',
        duration: `${duration}ms`,
        details: `Resolved to ${addresses.address}`,
      });
    } catch (error: any) {
      results.tests.push({
        name: 'DNS Resolution (OpenSky)',
        status: 'failed',
        error: error.message,
      });
    }

    // Test 2: OpenSky API connectivity (30s timeout)
    const openskyUser = process.env.OPENSKY_USER;
    const openskyPass = process.env.OPENSKY_PASS;

    if (openskyUser && openskyPass) {
      try {
        const auth = Buffer.from(`${openskyUser}:${openskyPass}`).toString('base64');
        const startTime = Date.now();
        const response = await axios.get('https://opensky-network.org/api/states/all', {
          headers: { Authorization: `Basic ${auth}` },
          params: { extended: 1 },
          timeout: 30000,
        });
        const duration = Date.now() - startTime;
        results.tests.push({
          name: 'OpenSky API Call',
          status: 'success',
          duration: `${duration}ms`,
          details: `Received ${response.data.states?.length || 0} aircraft states`,
        });
      } catch (error: any) {
        results.tests.push({
          name: 'OpenSky API Call',
          status: 'failed',
          error: error.message,
          code: error.code,
          details: error.code === 'ETIMEDOUT' ? 'Connection timeout after 30s' : 'Request failed',
        });
      }
    } else {
      results.tests.push({
        name: 'OpenSky API Call',
        status: 'skipped',
        details: 'OpenSky credentials not configured',
      });
    }

    // Test 3: Other external services for comparison
    const testServices = [
      { name: 'Google DNS', url: 'https://8.8.8.8', timeout: 5000 },
      { name: 'FlightAware', url: 'https://aeroapi.flightaware.com/aeroapi', timeout: 10000 },
      { name: 'Aerodatabox', url: 'https://prod.api.market/api/v1/aedbx/aerodatabox', timeout: 10000 },
    ];

    for (const service of testServices) {
      try {
        const startTime = Date.now();
        await axios.get(service.url, {
          timeout: service.timeout,
          validateStatus: () => true, // Accept any status code
        });
        const duration = Date.now() - startTime;
        results.tests.push({
          name: `External Service: ${service.name}`,
          status: 'success',
          duration: `${duration}ms`,
        });
      } catch (error: any) {
        results.tests.push({
          name: `External Service: ${service.name}`,
          status: 'failed',
          error: error.message,
          code: error.code,
          duration: error.code === 'ETIMEDOUT' ? `Timeout after ${service.timeout}ms` : 'Failed',
        });
      }
    }

    // Test 4: Database connectivity
    try {
      const startTime = Date.now();
      await postgresRepository.getDb().one('SELECT NOW() as current_time');
      const duration = Date.now() - startTime;
      results.tests.push({
        name: 'Database Connection',
        status: 'success',
        duration: `${duration}ms`,
      });
    } catch (error: any) {
      results.tests.push({
        name: 'Database Connection',
        status: 'failed',
        error: error.message,
      });
    }

    return res.json(results);
  } catch (err) {
    return next(err);
  }
});

export default router;
