import {
  Router, Request, Response, NextFunction,
} from 'express';
import weatherService from '../services/WeatherService';
import postgresRepository from '../repositories/PostgresRepository';
import { decodeMETAR, decodeTAF } from '../utils/weatherDecoder';
import { requireApiKeyAuth } from '../middlewares/apiKeyAuth';
import { rateLimitMiddleware } from '../middlewares/rateLimitMiddleware';
import { allowSameOriginOrApiKey } from '../middlewares/permissionMiddleware';
import { API_SCOPES } from '../config/scopes';
import { requirePremiumOrEFB, requireEFB } from '../middlewares/tierAuth';
import { optionalAuthenticateToken } from './auth.routes';

const router = Router();

/**
 * Get current METAR for an airport
 * GET /api/weather/airport/:code/metar
 * Requires: Premium or EFB subscription
 */
router.get(
  '/airport/:code/metar',
  requireApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ),
  rateLimitMiddleware,
  optionalAuthenticateToken,
  requirePremiumOrEFB,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.params;
      const { useCache = 'true' } = req.query;

      const airport = await postgresRepository.findAirportByCode(code.toUpperCase());
      if (!airport) {
        return res.status(404).json({
          error: `Airport not found: ${code}`,
        });
      }

      const weatherIdent = airport.gps_code || airport.ident;
      if (!weatherIdent) {
        return res.status(500).json({
          error: `Airport is missing gps_code/ident for weather lookup: ${code}`,
        });
      }

      const metar = await weatherService.getMETAR(
        weatherIdent,
        useCache === 'true',
      );

      if (!metar) {
        return res.status(404).json({
          error: `No METAR data available for ${code}`,
          airport: {
            ident: airport.ident,
            name: airport.name,
          },
        });
      }

      return res.json({
        airport: {
          ident: airport.ident,
          name: airport.name,
          iata_code: airport.iata_code,
        },
        metar: {
          id: metar.id,
          airport_ident: metar.airport_ident,
          observation_time: metar.observation_time,
          raw_text: metar.raw_text,
          temperature_c: metar.temperature_c,
          dewpoint_c: metar.dewpoint_c,
          wind_dir_deg: metar.wind_dir_deg,
          wind_speed_kt: metar.wind_speed_kt,
          wind_gust_kt: metar.wind_gust_kt,
          visibility_statute_mi: metar.visibility_statute_mi,
          altim_in_hg: metar.altim_in_hg,
          sea_level_pressure_mb: metar.sea_level_pressure_mb,
          sky_condition: metar.sky_condition,
          flight_category: metar.flight_category,
          metar_type: metar.metar_type,
          elevation_m: metar.elevation_m,
          created_at: metar.created_at,
          decoded: decodeMETAR(metar),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get current TAF for an airport
 * GET /api/weather/airport/:code/taf
 * Requires: Premium or EFB subscription
 */
router.get(
  '/airport/:code/taf',
  requireApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ),
  rateLimitMiddleware,
  optionalAuthenticateToken,
  requirePremiumOrEFB,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.params;
      const { useCache = 'true' } = req.query;

      const airport = await postgresRepository.findAirportByCode(code.toUpperCase());
      if (!airport) {
        return res.status(404).json({
          error: `Airport not found: ${code}`,
        });
      }

      const weatherIdent = airport.gps_code || airport.ident;
      if (!weatherIdent) {
        return res.status(500).json({
          error: `Airport is missing gps_code/ident for weather lookup: ${code}`,
        });
      }

      const taf = await weatherService.getTAF(
        weatherIdent,
        useCache === 'true',
      );

      if (!taf) {
        return res.status(404).json({
          error: `No TAF data available for ${code}`,
          airport: {
            ident: airport.ident,
            name: airport.name,
          },
        });
      }

      return res.json({
        airport: {
          ident: airport.ident,
          name: airport.name,
          iata_code: airport.iata_code,
        },
        taf: {
          id: taf.id,
          airport_ident: taf.airport_ident,
          issue_time: taf.issue_time,
          valid_time_from: taf.valid_time_from,
          valid_time_to: taf.valid_time_to,
          raw_text: taf.raw_text,
          forecast_data: taf.forecast_data,
          created_at: taf.created_at,
          decoded: decodeTAF(taf),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get historical METAR data for an airport
 * GET /api/weather/airport/:code/history
 * Requires: EFB subscription
 */
router.get(
  '/airport/:code/history',
  requireApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ),
  rateLimitMiddleware,
  optionalAuthenticateToken,
  requireEFB,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.params;
      const { hours = '24' } = req.query;

      const airport = await postgresRepository.findAirportByCode(code.toUpperCase());
      if (!airport) {
        return res.status(404).json({
          error: `Airport not found: ${code}`,
        });
      }

      const hoursNum = parseInt(hours as string, 10);
      if (Number.isNaN(hoursNum) || hoursNum < 1 || hoursNum > 168) {
        return res.status(400).json({
          error: 'Invalid hours parameter. Must be between 1 and 168 (7 days).',
        });
      }

      const weatherIdent = airport.gps_code || airport.ident;
      if (!weatherIdent) {
        return res.status(500).json({
          error: `Airport is missing gps_code/ident for weather lookup: ${code}`,
        });
      }

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - hoursNum * 60 * 60 * 1000);
      const history = await weatherService.getHistoricalMETAR(
        weatherIdent,
        startDate,
        endDate,
      );

      return res.json({
        airport: {
          ident: airport.ident,
          name: airport.name,
          iata_code: airport.iata_code,
        },
        hours: hoursNum,
        count: history.length,
        history: history.map((metar) => ({
          id: metar.id,
          airport_ident: metar.airport_ident,
          observation_time: metar.observation_time,
          raw_text: metar.raw_text,
          temperature_c: metar.temperature_c,
          dewpoint_c: metar.dewpoint_c,
          wind_dir_deg: metar.wind_dir_deg,
          wind_speed_kt: metar.wind_speed_kt,
          wind_gust_kt: metar.wind_gust_kt,
          visibility_statute_mi: metar.visibility_statute_mi,
          altim_in_hg: metar.altim_in_hg,
          sea_level_pressure_mb: metar.sea_level_pressure_mb,
          sky_condition: metar.sky_condition,
          flight_category: metar.flight_category,
          metar_type: metar.metar_type,
          elevation_m: metar.elevation_m,
          created_at: metar.created_at,
        })),
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Get weather summary for an airport (METAR + TAF)
 * GET /api/weather/airport/:code/summary
 * Requires: Premium or EFB subscription
 */
router.get(
  '/airport/:code/summary',
  requireApiKeyAuth,
  allowSameOriginOrApiKey(API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ),
  rateLimitMiddleware,
  optionalAuthenticateToken,
  requirePremiumOrEFB,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.params;
      const { useCache = 'true' } = req.query;

      const airport = await postgresRepository.findAirportByCode(code.toUpperCase());
      if (!airport) {
        return res.status(404).json({
          error: `Airport not found: ${code}`,
        });
      }

      const weatherIdent = airport.gps_code || airport.ident;
      if (!weatherIdent) {
        return res.status(500).json({
          error: `Airport is missing gps_code/ident for weather lookup: ${code}`,
        });
      }

      const { metar, taf } = await weatherService.getWeatherSummary(
        weatherIdent,
        useCache === 'true',
      );

      return res.json({
        airport: {
          ident: airport.ident,
          name: airport.name,
          iata_code: airport.iata_code,
          elevation_ft: airport.elevation_ft,
          latitude_deg: airport.latitude_deg,
          longitude_deg: airport.longitude_deg,
        },
        current: metar
          ? {
            observation_time: metar.observation_time,
            raw_text: metar.raw_text,
            temperature_c: metar.temperature_c,
            dewpoint_c: metar.dewpoint_c,
            wind_dir_deg: metar.wind_dir_deg,
            wind_speed_kt: metar.wind_speed_kt,
            wind_gust_kt: metar.wind_gust_kt,
            visibility_statute_mi: metar.visibility_statute_mi,
            altim_in_hg: metar.altim_in_hg,
            flight_category: metar.flight_category,
            decoded: decodeMETAR(metar),
          }
          : null,
        forecast: taf
          ? {
            issue_time: taf.issue_time,
            valid_time_from: taf.valid_time_from,
            valid_time_to: taf.valid_time_to,
            raw_text: taf.raw_text,
            decoded: decodeTAF(taf),
          }
          : null,
        available: {
          metar: !!metar,
          taf: !!taf,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
