import {
  Router, Request, Response, NextFunction,
} from 'express';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { requireApiKeyAuth, optionalApiKeyAuth } from '../middlewares/apiKeyAuth';
import { rateLimitMiddleware } from '../middlewares/rateLimitMiddleware';
import { allowSameOriginOrApiKey, requireScopes } from '../middlewares/permissionMiddleware';
import { API_SCOPES } from '../config/scopes';
import { decodeMETAR, decodeTAF } from '../utils/weatherDecoder';

const router = Router();
const requireAirportsRead = requireScopes(API_SCOPES.AIRPORTS_READ, API_SCOPES.READ);

/**
 * Find airports near a location
 * GET /api/airports/near/:lat/:lon
 */
router.get(
  '/near/:lat/:lon',
  requireApiKeyAuth,
  requireAirportsRead,
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { lat, lon } = req.params;
    const { radius = 50, type } = req.query;

    try {
      const airports = await postgresRepository.findAirportsNearPoint(
        parseFloat(lat),
        parseFloat(lon),
        parseFloat(radius as string),
        (type as string | undefined) || null,
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
 * GET /api/airports/bounds/:latmin/:lonmin/:latmax/:lonmax
 */
router.get(
  '/bounds/:latmin/:lonmin/:latmax/:lonmax',
  optionalApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRPORTS_READ, API_SCOPES.READ),
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
 * Get airport by IATA/ICAO/GPS code (includes runways and frequencies)
 * GET /api/airports/:code
 */
router.get(
  '/:code',
  requireApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRPORTS_READ, API_SCOPES.READ),
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const { code } = req.params;
    const { includeWeather } = req.query;

    try {
      const airport = await postgresRepository.findAirportByCode(code.toUpperCase());

      if (!airport) {
        return res.status(404).json({ error: 'Airport not found' });
      }

      const response: any = { ...airport };

      // Optionally include weather data if requested and user has access
      if (includeWeather === 'true') {
        try {
          const weatherService = (await import('../services/WeatherService')).default;
          const userSubscriptionService = (await import('../services/UserSubscriptionService')).default;

          // Try to get user ID from request
          let userId: number | null = null;
          const authReq = req as any;
          if (authReq.user?.userId) {
            userId = authReq.user.userId;
          } else if (authReq.apiKey?.userId) {
            userId = authReq.apiKey.userId;
          }

          // Check user tier if authenticated
          let hasAccess = false;
          if (userId) {
            const flags = await userSubscriptionService.calculateUserFlags(userId);
            hasAccess = flags.isPremium || flags.isEFB;
          }

          if (hasAccess) {
            const weatherIdent = airport.gps_code || airport.ident;

            if (!weatherIdent) {
              logger.warn('Airport missing gps_code/ident for weather', {
                airportId: airport.id,
                code,
              });
            } else {
              const { metar, taf } = await weatherService.getWeatherSummary(weatherIdent, true);

              response.weather = {
                metar: metar
                  ? {
                    observation_time: metar.observation_time,
                    raw_text: metar.raw_text,
                    temperature_c: metar.temperature_c,
                    wind_dir_deg: metar.wind_dir_deg,
                    wind_speed_kt: metar.wind_speed_kt,
                    visibility_statute_mi: metar.visibility_statute_mi,
                    flight_category: metar.flight_category,
                    decoded: decodeMETAR(metar),
                  }
                  : null,
                taf: taf
                  ? {
                    issue_time: taf.issue_time,
                    valid_time_from: taf.valid_time_from,
                    valid_time_to: taf.valid_time_to,
                    raw_text: taf.raw_text,
                    decoded: decodeTAF(taf),
                  }
                  : null,
              };
            }
          } else {
            response.weather = {
              upgrade_required: true,
              message: 'Weather data requires Premium or EFB subscription',
            };
          }
        } catch (weatherError) {
          logger.warn('Failed to fetch weather data for airport', {
            airport_code: code,
            error: (weatherError as Error).message,
          });
          // Continue without weather data
        }
      }

      return res.json(response);
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Search airports by name or code
 * GET /api/airports/search/:term
 */
router.get(
  '/search/:term',
  requireApiKeyAuth,
  requireAirportsRead,
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

export default router;
