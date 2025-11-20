import { Router, Request, Response } from 'express';
import postgresRepository from '../repositories/PostgresRepository';
import rateLimitManager from '../services/RateLimitManager';
import webSocketService from '../services/WebSocketService';
import liveStateStore from '../services/LiveStateStore';
import queueService from '../services/QueueService';
import config from '../config';
import logger from '../utils/logger';

const router = Router();

/**
 * Health check endpoint for load balancers and monitoring
 * Returns healthy if server is running, even if database is temporarily unavailable
 * This allows container to start and pass health checks during deployment
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Try to check database connection with timeout, but don't fail if it's slow
    const db = postgresRepository.getDb();

    // Use Promise.race to timeout after 2 seconds (faster timeout for health checks)
    const queryPromise = db.query('SELECT 1');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database health check timeout')), 2000);
    });

    try {
      await Promise.race([queryPromise, timeoutPromise]);
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'fly-overhead',
        database: 'connected',
      });
    } catch (dbError) {
      // Database check timed out or failed, but server is running
      // Return 200 anyway to allow deployment to proceed
      // The database connection will retry and establish eventually
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'fly-overhead',
        database: 'connecting',
        warning: 'Database connection check timed out, but server is operational',
      });
    }
  } catch (error) {
    // Only fail if there's a critical error (not just DB timeout)
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

/**
 * Cache status endpoint - shows LiveStateStore cache statistics
 */
router.get('/cache-status', (_req: Request, res: Response) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      liveStateStore: {
        enabled: config.liveState.enabled,
        cacheSize: liveStateStore.getSize(),
        maxEntries: config.liveState.maxEntries,
        ttlSeconds: config.liveState.ttlSeconds,
        minResultsBeforeDbFallback: liveStateStore.getMinResultsBeforeFallback(),
      },
      queue: {
        enabled: queueService.isEnabled(),
        queueKey: queueService.getQueueKey(),
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Cache status check failed', { error: err.message });
    res.status(500).json({
      error: 'Failed to get cache status',
      message: err.message,
    });
  }
});

/**
 * Database connection pool status endpoint
 * Provides visibility into connection pool usage and database activity
 */
router.get('/db-pool-status', async (_req: Request, res: Response) => {
  try {
    const db = postgresRepository.getDb();

    // Query PostgreSQL for connection statistics
    // This shows actual database connections, not just the pool configuration
    const poolStats = await db
      .one(
        `
      SELECT 
        count(*)::int as total_connections,
        count(*) FILTER (WHERE state = 'active')::int as active,
        count(*) FILTER (WHERE state = 'idle')::int as idle,
        count(*) FILTER (WHERE state = 'idle in transaction')::int as idle_in_transaction,
        count(*) FILTER (WHERE wait_event_type = 'Lock')::int as waiting_for_lock,
        count(*) FILTER (
          WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 seconds'
        )::int as long_running_queries
      FROM pg_stat_activity 
      WHERE datname = current_database()
        AND pid != pg_backend_pid()
    `,
      )
      .catch(() => {
        // Fallback if query fails (e.g., insufficient permissions)
        return {
          total_connections: null,
          active: null,
          idle: null,
          idle_in_transaction: null,
          waiting_for_lock: null,
          long_running_queries: null,
        };
      });

    res.status(200).json({
      pool: {
        max: config.database.postgres.pool.max,
        min: config.database.postgres.pool.min,
      },
      current: poolStats,
      timeouts: {
        connectionTimeoutMillis: 10000,
        queryTimeout: 10000,
        statementTimeout: '10s',
        lockTimeout: '5s',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error fetching database pool status', { error: err.message });
    res.status(500).json({
      error: 'Failed to fetch pool status',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
