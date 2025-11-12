import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { generateApiKey } from '../utils/apiKeyGenerator';
import { authenticateToken } from './auth.routes';
import { getRateLimitStatusHandler } from '../middlewares/rateLimitMiddleware';

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
router.post('/keys', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, type = 'production', scopes = ['read'], expiresAt } = req.body;

    if (!name) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Name is required',
          status: 400,
        },
      });
    }

    if (type !== 'development' && type !== 'production') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Type must be "development" or "production"',
          status: 400,
        },
      });
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

    res.status(201).json({
      key,
      keyId: apiKeyData.key_id,
      name: apiKeyData.name,
      prefix: apiKeyData.key_prefix,
      type: type,
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
router.get('/keys', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { status, type, limit = 100, offset = 0 } = req.query;

    const filters = {
      userId: req.user!.userId,
      status: status as string | undefined,
      keyPrefix: type === 'development' ? 'sk_dev_' : type === 'production' ? 'sk_live_' : null,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
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

    res.json({
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
router.get('/keys/:keyId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

    res.json({
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
router.put('/keys/:keyId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

    res.json({
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
router.delete('/keys/:keyId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
      reason || 'Revoked by user'
    );

    res.json({
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
router.get('/rate-limit-status', authenticateToken, getRateLimitStatusHandler as any);

export default router;

