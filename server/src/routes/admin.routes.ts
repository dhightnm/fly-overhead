import {
  Router, Request, Response, NextFunction,
} from 'express';
import bcrypt from 'bcryptjs';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { generateApiKey } from '../utils/apiKeyGenerator';
import { authenticateToken } from './auth.routes';
import { rateLimitMiddleware, getRateLimitStatusHandler } from '../middlewares/rateLimitMiddleware';
import config from '../config';
import { createApiKeySchema, listApiKeysSchema } from '../schemas/admin.schemas';
import metricsService from '../services/MetricsService';
import queueService from '../services/QueueService';
import webhookQueueService from '../services/WebhookQueueService';
import liveStateStore from '../services/LiveStateStore';
import redisAircraftCache from '../services/RedisAircraftCache';

const router = Router();

interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    email: string;
  };
}

/**
 * POST /api/admin/keys
 * Create a new API key
 */
router.post('/keys', authenticateToken, rateLimitMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, description, type, scopes, expiresAt,
    } = createApiKeySchema.parse(req.body);

    if (type === 'development') {
      const allowed = config.auth.devKeyAllowedEmails;
      if (!allowed.includes(req.user?.email || '')) {
        return res.status(403).json({
          error: {
            code: 'DEV_KEY_NOT_ALLOWED',
            message: 'Development keys may only be created by approved administrators.',
            status: 403,
          },
        });
      }
    }

    const { key, prefix } = generateApiKey(type);
    const keyHash = await bcrypt.hash(key, 10);

    const apiKeyData = await postgresRepository.createApiKey({
      keyHash,
      prefix,
      name,
      description,
      userId: req.user!.userId,
      scopes,
      createdBy: req.user!.userId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    logger.info('API key created via admin endpoint', {
      keyId: apiKeyData.key_id,
      name: apiKeyData.name,
      type,
      createdBy: req.user!.userId,
    });

    return res.status(201).json({
      key,
      keyId: apiKeyData.key_id,
      name: apiKeyData.name,
      prefix: apiKeyData.key_prefix,
      type,
      scopes: apiKeyData.scopes,
      createdAt: apiKeyData.created_at,
      expiresAt: apiKeyData.expires_at,
      warning: 'Save this key now! It will not be shown again.',
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error creating API key', { error: err.message });
    return next(error);
  }
});

/**
 * GET /api/admin/keys
 * List all API keys for the authenticated user
 */
router.get('/keys', authenticateToken, rateLimitMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const {
      status, type, limit, offset,
    } = listApiKeysSchema.parse(req.query);

    const keyPrefix = (() => {
      if (type === 'development') {
        return 'sk_dev_';
      }
      if (type === 'production') {
        return 'sk_live_';
      }
      return null;
    })();

    const filters = {
      userId: req.user!.userId,
      status,
      keyPrefix,
      limit,
      offset,
    };

    const keys = await postgresRepository.listApiKeys(filters);

    const sanitizedKeys = keys.map((key) => ({
      keyId: key.key_id,
      name: key.name,
      description: key.description,
      prefix: key.key_prefix,
      type: key.key_prefix === 'sk_dev_' ? 'development' : 'production',
      lastFour: '****',
      scopes: key.scopes,
      status: key.status,
      lastUsedAt: key.last_used_at,
      usageCount: key.usage_count,
      createdAt: key.created_at,
      expiresAt: key.expires_at,
      revokedAt: key.revoked_at,
    }));

    return res.json({
      keys: sanitizedKeys,
      count: sanitizedKeys.length,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error listing API keys', { error: err.message });
    return next(error);
  }
});

/**
 * GET /api/admin/keys/:keyId
 * Get details of a specific API key
 */
router.get('/keys/:keyId', authenticateToken, rateLimitMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;

    const key = await postgresRepository.getApiKeyById(keyId);

    if (!key) {
      return res.status(404).json({
        error: {
          code: 'KEY_NOT_FOUND',
          message: 'API key not found',
          status: 404,
        },
      });
    }

    if (key.user_id !== req.user!.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to view this API key',
          status: 403,
        },
      });
    }

    return res.json({
      keyId: key.key_id,
      name: key.name,
      description: key.description,
      prefix: key.key_prefix,
      type: key.key_prefix === 'sk_dev_' ? 'development' : 'production',
      scopes: key.scopes,
      status: key.status,
      lastUsedAt: key.last_used_at,
      usageCount: key.usage_count,
      createdAt: key.created_at,
      expiresAt: key.expires_at,
      revokedAt: key.revoked_at,
      revokedBy: key.revoked_by,
      revokedReason: key.revoked_reason,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error getting API key', { error: err.message });
    return next(error);
  }
});

/**
 * PUT /api/admin/keys/:keyId
 * Update an API key (name, description, scopes)
 */
router.put('/keys/:keyId', authenticateToken, rateLimitMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;
    const { name, description, scopes } = req.body;

    const existingKey = await postgresRepository.getApiKeyById(keyId);

    if (!existingKey) {
      return res.status(404).json({
        error: {
          code: 'KEY_NOT_FOUND',
          message: 'API key not found',
          status: 404,
        },
      });
    }

    if (existingKey.user_id !== req.user!.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to update this API key',
          status: 403,
        },
      });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (scopes !== undefined) updates.scopes = scopes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No fields to update',
          status: 400,
        },
      });
    }

    const updatedKey = await postgresRepository.updateApiKey(keyId, updates);

    return res.json({
      keyId: updatedKey.key_id,
      name: updatedKey.name,
      description: updatedKey.description,
      scopes: updatedKey.scopes,
      updatedAt: updatedKey.updated_at,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error updating API key', { error: err.message });
    return next(error);
  }
});

/**
 * DELETE /api/admin/keys/:keyId
 * Revoke an API key
 */
router.delete('/keys/:keyId', authenticateToken, rateLimitMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;
    const { reason } = req.body;

    const existingKey = await postgresRepository.getApiKeyById(keyId);

    if (!existingKey) {
      return res.status(404).json({
        error: {
          code: 'KEY_NOT_FOUND',
          message: 'API key not found',
          status: 404,
        },
      });
    }

    if (existingKey.user_id !== req.user!.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to revoke this API key',
          status: 403,
        },
      });
    }

    const revokedKey = await postgresRepository.revokeApiKey(
      keyId,
      req.user!.userId,
      reason || 'Revoked by user',
    );

    return res.json({
      keyId: revokedKey.key_id,
      name: revokedKey.name,
      status: revokedKey.status,
      revokedAt: revokedKey.revoked_at,
      revokedReason: revokedKey.revoked_reason,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error revoking API key', { error: err.message });
    return next(error);
  }
});

/**
 * GET /api/admin/rate-limit-status
 * Get current rate limit status for authenticated user/key
 */
router.get('/rate-limit-status', authenticateToken, rateLimitMiddleware, getRateLimitStatusHandler as any);

/**
 * Middleware to check if user is admin (in DEV_KEY_ALLOWED_EMAILS)
 */
function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const userEmail = req.user?.email;
  if (!userEmail) {
    res.status(401).json({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        status: 401,
      },
    });
    return;
  }

  const allowedEmails = config.auth.devKeyAllowedEmails.map(email => email.trim().toLowerCase());
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  if (!allowedEmails.includes(normalizedUserEmail)) {
    logger.warn('Unauthorized admin access attempt', { email: userEmail });
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
        status: 403,
      },
    });
    return;
  }

  next();
}

/**
 * GET /api/admin/dashboard
 * Get admin dashboard data (metrics, system status, etc.)
 */
router.get('/dashboard', authenticateToken, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [queueStats, webhookStats, dbPoolResult] = await Promise.all([
      queueService.getStats(),
      webhookQueueService.getStats(),
      postgresRepository.getDb().query('SELECT COUNT(*) as total_connections FROM pg_stat_activity WHERE datname = current_database()'),
    ]);

    const dbPool = dbPoolResult?.rows?.[0] || { total_connections: 0 };

    const metrics = metricsService.getMetricsJson();
    const cacheMetrics = redisAircraftCache.getMetrics();

    res.json({
      timestamp: new Date().toISOString(),
      metrics: {
        enabled: metrics.enabled,
        rateLimits: metrics.rateLimits,
        circuitBreakers: metrics.circuitBreakers,
      },
      system: {
        cache: {
          enabled: redisAircraftCache.isEnabled(),
          ...cacheMetrics,
        },
        liveState: {
          enabled: config.liveState.enabled,
          cacheSize: liveStateStore.getSize(),
          maxEntries: config.liveState.maxEntries,
          ttlSeconds: config.liveState.ttlSeconds,
        },
        queue: {
          enabled: queueService.isEnabled(),
          ...queueStats,
          health: queueService.getHealth(),
        },
        webhookQueue: {
          enabled: webhookQueueService.isEnabled(),
          ...webhookStats,
          health: webhookQueueService.getHealth(),
        },
        database: {
          totalConnections: Number(dbPool.total_connections) || 0,
        },
      },
      features: {
        backgroundJobs: config.features.backgroundJobsEnabled,
        conusPolling: config.features.conusPollingEnabled,
        backfill: config.features.backfillEnabled,
        metrics: config.features.metricsEnabled,
        prometheus: config.features.prometheusExportEnabled,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error fetching admin dashboard data', { error: err.message });
    next(error);
  }
});

export default router;
