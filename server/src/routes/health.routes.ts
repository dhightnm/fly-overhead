import { Router, Request, Response } from 'express';
import postgresRepository from '../repositories/PostgresRepository';
import rateLimitManager from '../services/RateLimitManager';
import webSocketService from '../services/WebSocketService';
import logger from '../utils/logger';

const router = Router();

/**
 * Health check endpoint for load balancers and monitoring
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Check database connection
    const db = postgresRepository.getDb();
    await db.query('SELECT 1');

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'fly-overhead',
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'fly-overhead',
      error: err.message,
    });
  }
});

/**
 * Readiness check (more comprehensive)
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    const db = postgresRepository.getDb();

    // Check database connection
    await db.query('SELECT 1');

    // Check if tables exist
    const tableCheck = await db.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('aircraft_states', 'flight_routes_history')
    `);

    if (parseInt(tableCheck[0].count, 10) < 2) {
      res.status(503).json({
        status: 'not ready',
        reason: 'database tables not initialized',
      });
      return;
    }

    // Get rate limit status
    const rateLimitStatus = rateLimitManager.getStatus();

    // Get WebSocket connection count
    const io = webSocketService.getIO();
    const connectedClients = io ? io.sockets.sockets.size : 0;

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: 'connected',
      tables: 'initialized',
      opensky: {
        rateLimited: rateLimitStatus.isRateLimited,
        blockedUntil: rateLimitStatus.blockedUntil,
        secondsUntilRetry: rateLimitStatus.secondsUntilRetry,
        consecutiveFailures: rateLimitStatus.consecutiveFailures,
      },
      websocket: {
        connectedClients,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Readiness check failed', { error: err.message });
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: err.message,
    });
  }
});

/**
 * OpenSky rate limit status endpoint
 */
router.get('/opensky-status', (_req: Request, res: Response) => {
  const rateLimitStatus = rateLimitManager.getStatus();
  const io = webSocketService.getIO();
  const connectedClients = io ? io.sockets.sockets.size : 0;

  res.json({
    timestamp: new Date().toISOString(),
    rateLimited: rateLimitStatus.isRateLimited,
    blockedUntil: rateLimitStatus.blockedUntil,
    secondsUntilRetry: rateLimitStatus.secondsUntilRetry,
    consecutiveFailures: rateLimitStatus.consecutiveFailures,
    connectedClients,
    willFetchOnNextInterval: connectedClients > 0 && !rateLimitStatus.isRateLimited,
  });
});

export default router;
