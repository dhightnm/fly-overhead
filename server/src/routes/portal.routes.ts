import { Router, Response, NextFunction } from 'express';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { authenticateToken, type AuthenticatedRequest } from './auth.routes';

const router = Router();

// Input validation constants
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;

/**
 * GET /api/portal/feeders
 * Get all feeders associated with the authenticated user
 */
router.get('/feeders', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // Validate userId is a number
    if (!userId || typeof userId !== 'number' || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get feeders linked to this user via metadata
    const feeders = await postgresRepository
      .getDb()
      .any(
        `SELECT 
          feeder_id,
          name,
          status,
          last_seen_at,
          ST_Y(location::geometry) as latitude,
          ST_X(location::geometry) as longitude,
          created_at
        FROM feeders 
        WHERE metadata->>'user_id' = $1
        ORDER BY created_at DESC`,
        [userId.toString()]
      );

    res.json({
      feeders: feeders.map((feeder) => ({
        feeder_id: feeder.feeder_id,
        name: feeder.name,
        status: feeder.status,
        last_seen_at: feeder.last_seen_at ? new Date(feeder.last_seen_at).toISOString() : null,
        latitude: feeder.latitude,
        longitude: feeder.longitude,
        created_at: new Date(feeder.created_at).toISOString(),
      })),
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error fetching user feeders', { 
      error: err.message,
      userId: req.user?.userId,
      stack: err.stack,
    });
    return next(error);
  }
});

/**
 * GET /api/portal/aircraft
 * Get aircraft from user's associated feeders
 */
router.get('/aircraft', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // Validate userId
    if (!userId || typeof userId !== 'number' || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Validate and sanitize pagination parameters
    let limit = parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT;
    let offset = parseInt(req.query.offset as string, 10) || DEFAULT_OFFSET;

    // Enforce maximum limit to prevent resource exhaustion
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }
    if (limit < 1) {
      limit = DEFAULT_LIMIT;
    }
    if (offset < 0) {
      offset = DEFAULT_OFFSET;
    }

    // First, get all feeder IDs for this user
    const userFeeders = await postgresRepository
      .getDb()
      .any(
        `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
        [userId.toString()]
      );

    if (userFeeders.length === 0) {
      return res.json({
        aircraft: [],
        total: 0,
        limit,
        offset,
      });
    }

    const feederIds = userFeeders.map((f) => f.feeder_id);

    // Validate feeder IDs array is not empty (defensive check)
    if (feederIds.length === 0) {
      return res.json({
        aircraft: [],
        total: 0,
        limit,
        offset,
      });
    }

    // Get aircraft from these feeders
    const aircraft = await postgresRepository
      .getDb()
      .any(
        `SELECT 
          a.icao24,
          a.callsign,
          a.latitude,
          a.longitude,
          a.baro_altitude,
          a.geo_altitude,
          a.velocity,
          a.true_track,
          a.vertical_rate,
          a.squawk,
          a.on_ground,
          a.category,
          a.last_contact,
          a.feeder_id,
          a.data_source,
          a.source_priority,
          c.departure_iata,
          c.departure_icao,
          c.departure_name,
          c.arrival_iata,
          c.arrival_icao,
          c.arrival_name,
          c.aircraft_type,
          c.source as route_source
        FROM aircraft_states a
        LEFT JOIN LATERAL (
          SELECT 
            departure_iata,
            departure_icao,
            departure_name,
            arrival_iata,
            arrival_icao,
            arrival_name,
            aircraft_type,
            source
          FROM flight_routes_cache
          WHERE cache_key = a.icao24
          UNION ALL
          SELECT 
            departure_iata,
            departure_icao,
            departure_name,
            arrival_iata,
            arrival_icao,
            arrival_name,
            aircraft_type,
            source
          FROM flight_routes_cache
          WHERE cache_key = a.callsign 
            AND a.callsign IS NOT NULL 
            AND a.callsign != ''
        ) c ON true
        WHERE a.feeder_id = ANY($1)
          AND a.last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
        ORDER BY a.last_contact DESC
        LIMIT $2 OFFSET $3`,
        [feederIds, limit, offset]
      );

    // Get total count
    const totalResult = await postgresRepository
      .getDb()
      .one(
        `SELECT COUNT(*) as total
        FROM aircraft_states
        WHERE feeder_id = ANY($1)
          AND last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
        [feederIds]
      );

    // Transform aircraft data to match frontend format
    const transformedAircraft = aircraft.map((ac) => ({
      icao24: ac.icao24,
      callsign: ac.callsign,
      latitude: ac.latitude,
      longitude: ac.longitude,
      baro_altitude: ac.baro_altitude,
      geo_altitude: ac.geo_altitude,
      velocity: ac.velocity,
      true_track: ac.true_track,
      vertical_rate: ac.vertical_rate,
      squawk: ac.squawk,
      on_ground: ac.on_ground,
      category: ac.category,
      last_contact: ac.last_contact,
      feeder_id: ac.feeder_id,
      data_source: ac.data_source,
      source_priority: ac.source_priority,
      route: ac.departure_icao || ac.departure_iata ? {
        departureAirport: {
          icao: ac.departure_icao,
          iata: ac.departure_iata,
          name: ac.departure_name,
        },
        arrivalAirport: {
          icao: ac.arrival_icao,
          iata: ac.arrival_iata,
          name: ac.arrival_name,
        },
        aircraft: {
          type: ac.aircraft_type,
        },
        source: ac.route_source,
      } : null,
    }));

    res.json({
      aircraft: transformedAircraft,
      total: parseInt(totalResult.total, 10),
      limit,
      offset,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error fetching user aircraft', { 
      error: err.message,
      userId: req.user?.userId,
      query: req.query,
      stack: err.stack,
    });
    return next(error);
  }
});

/**
 * GET /api/portal/stats
 * Get portal statistics for the authenticated user
 */
router.get('/stats', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // Validate userId
    if (!userId || typeof userId !== 'number' || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get feeder count
    const feederCount = await postgresRepository
      .getDb()
      .one(
        `SELECT COUNT(*) as count
        FROM feeders 
        WHERE metadata->>'user_id' = $1 AND status = 'active'`,
        [userId.toString()]
      );

    // Get aircraft count from user's feeders
    const userFeeders = await postgresRepository
      .getDb()
      .any(
        `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
        [userId.toString()]
      );

    let aircraftCount = 0;
    if (userFeeders.length > 0) {
      const feederIds = userFeeders.map((f) => f.feeder_id);
      const aircraftResult = await postgresRepository
        .getDb()
        .one(
          `SELECT COUNT(DISTINCT icao24) as count
          FROM aircraft_states
          WHERE feeder_id = ANY($1)
            AND last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
          [feederIds]
        );
      aircraftCount = parseInt(aircraftResult.count, 10);
    }

    // Get API key count
    const apiKeyCount = await postgresRepository
      .getDb()
      .one(
        `SELECT COUNT(*) as count
        FROM api_keys
        WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

    res.json({
      stats: {
        totalAircraft: aircraftCount,
        activeFeeders: parseInt(feederCount.count, 10),
        totalApiKeys: parseInt(apiKeyCount.count, 10),
        recentAircraft: aircraftCount, // Same as total for now
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error fetching portal stats', { 
      error: err.message,
      userId: req.user?.userId,
      stack: err.stack,
    });
    return next(error);
  }
});

export default router;

