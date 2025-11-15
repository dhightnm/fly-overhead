const router = require('express').Router();
const bcrypt = require('bcryptjs');
const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');
const { generateApiKey, maskApiKey } = require('../utils/apiKeyGenerator');
const { authenticateToken } = require('./auth.routes');

/**
 * Admin routes for API key management (MVP)
 *
 * All routes require JWT authentication
 * In future, can add admin-only check
 */

/**
 * POST /api/admin/keys
 * Create a new API key
 */
router.post('/keys', authenticateToken, async (req, res, next) => {
  try {
    const {
      name, description, type = 'production', scopes = ['read'], expiresAt,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Name is required',
          status: 400,
        },
      });
    }

    // Validate type
    if (type !== 'development' && type !== 'production') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Type must be "development" or "production"',
          status: 400,
        },
      });
    }

    // Generate API key
    const { key, prefix } = generateApiKey(type);

    // Hash the key (bcrypt cost factor 10)
    const keyHash = await bcrypt.hash(key, 10);

    // Store in database
    const apiKeyData = await postgresRepository.createApiKey({
      keyHash,
      prefix,
      name,
      description,
      userId: req.user.userId, // From JWT
      scopes,
      createdBy: req.user.userId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    logger.info('API key created via admin endpoint', {
      keyId: apiKeyData.key_id,
      name: apiKeyData.name,
      type,
      createdBy: req.user.userId,
    });

    // Return the key ONCE (never again!)
    res.status(201).json({
      key, // Full key - only shown once!
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
    logger.error('Error creating API key', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/admin/keys
 * List all API keys for the authenticated user
 */
router.get('/keys', authenticateToken, async (req, res, next) => {
  try {
    const {
      status, type, limit = 100, offset = 0,
    } = req.query;

    const filters = {
      userId: req.user.userId, // Only show user's own keys
      status,
      keyPrefix: type === 'development' ? 'sk_dev_' : type === 'production' ? 'sk_live_' : null,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };

    const keys = await postgresRepository.listApiKeys(filters);

    // Never return key_hash or full key
    const sanitizedKeys = keys.map((key) => ({
      keyId: key.key_id,
      name: key.name,
      description: key.description,
      prefix: key.key_prefix,
      type: key.key_prefix === 'sk_dev_' ? 'development' : 'production',
      lastFour: '****', // Don't expose even last 4 in MVP
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
    logger.error('Error listing API keys', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/admin/keys/:keyId
 * Get details of a specific API key
 */
router.get('/keys/:keyId', authenticateToken, async (req, res, next) => {
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

    // Check ownership (user can only view their own keys)
    if (key.user_id !== req.user.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to view this API key',
          status: 403,
        },
      });
    }

    // Return sanitized key data
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
    logger.error('Error getting API key', { error: error.message });
    next(error);
  }
});

/**
 * PUT /api/admin/keys/:keyId
 * Update an API key (name, description, scopes)
 */
router.put('/keys/:keyId', authenticateToken, async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const { name, description, scopes } = req.body;

    // Get existing key
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

    // Check ownership
    if (existingKey.user_id !== req.user.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to update this API key',
          status: 403,
        },
      });
    }

    // Update key
    const updates = {};
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
    logger.error('Error updating API key', { error: error.message });
    next(error);
  }
});

/**
 * DELETE /api/admin/keys/:keyId
 * Revoke an API key
 */
router.delete('/keys/:keyId', authenticateToken, async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const { reason } = req.body;

    // Get existing key
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

    // Check ownership
    if (existingKey.user_id !== req.user.userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to revoke this API key',
          status: 403,
        },
      });
    }

    // Revoke key
    const revokedKey = await postgresRepository.revokeApiKey(
      keyId,
      req.user.userId,
      reason || 'Revoked by user',
    );

    res.json({
      keyId: revokedKey.key_id,
      name: revokedKey.name,
      status: revokedKey.status,
      revokedAt: revokedKey.revoked_at,
      revokedReason: revokedKey.revoked_reason,
    });
  } catch (error) {
    logger.error('Error revoking API key', { error: error.message });
    next(error);
  }
});

module.exports = router;
