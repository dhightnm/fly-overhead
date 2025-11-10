const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Repository for API key management
 */
class ApiKeyRepository {
  constructor(db) {
    this.db = db;
  }

  async createApiKey(data) {
    const {
      keyHash,
      prefix,
      name,
      description = null,
      userId = null,
      scopes = ['read'],
      createdBy = null,
      expiresAt = null,
    } = data;

    const query = `
      INSERT INTO api_keys(
        key_hash, key_prefix, name, description,
        user_id, scopes, created_by, expires_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by;
    `;

    const result = await this.db.one(query, [
      keyHash,
      prefix,
      name,
      description,
      userId,
      scopes,
      createdBy,
      expiresAt,
    ]);

    logger.info('API key created', {
      keyId: result.key_id,
      name: result.name,
      prefix: result.key_prefix,
      userId: result.user_id,
    });

    return result;
  }

  async getApiKeyByHash(keyHash) {
    const query = `
      SELECT
        id, key_id, key_hash, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      WHERE key_hash = $1
        AND status = 'active';
    `;

    return this.db.oneOrNone(query, [keyHash]);
  }

  async validateApiKey(plainKey) {
    try {
      const bcrypt = require('bcryptjs');

      // Get all active keys
      const query = `
        SELECT
          id, key_id, key_hash, key_prefix, name, description,
          user_id, scopes, status, last_used_at, usage_count,
          created_at, updated_at, expires_at
        FROM api_keys
        WHERE status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);
      `;

      const keys = await this.db.manyOrNone(query);

      // Check each key hash (bcrypt compare)
      for (const key of keys) {
        const isValid = await bcrypt.compare(plainKey, key.key_hash);
        if (isValid) {
          // Update last used (fire and forget)
          this.updateApiKeyLastUsed(key.id).catch((err) => {
            logger.warn('Failed to update API key last_used_at', {
              keyId: key.key_id,
              error: err.message,
            });
          });

          return key;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error validating API key', { error: error.message });
      throw error;
    }
  }

  async getApiKeyById(keyId) {
    const query = `
      SELECT
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      WHERE key_id = $1;
    `;

    return this.db.oneOrNone(query, [keyId]);
  }

  async listApiKeys(filters = {}) {
    const {
      userId = null,
      status = null,
      keyPrefix = null,
      limit = 100,
      offset = 0,
    } = filters;

    const whereClause = [];
    const params = [];
    let paramIndex = 1;

    if (userId !== null) {
      whereClause.push(`user_id = $${paramIndex++}`);
      params.push(userId);
    }

    if (status !== null) {
      whereClause.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (keyPrefix !== null) {
      whereClause.push(`key_prefix = $${paramIndex++}`);
      params.push(keyPrefix);
    }

    const query = `
      SELECT
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at, created_by,
        revoked_at, revoked_by, revoked_reason
      FROM api_keys
      ${whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex};
    `;

    params.push(limit, offset);

    return this.db.manyOrNone(query, params);
  }

  async updateApiKeyLastUsed(id) {
    const query = `
      UPDATE api_keys
      SET
        last_used_at = CURRENT_TIMESTAMP,
        usage_count = usage_count + 1
      WHERE id = $1;
    `;

    await this.db.query(query, [id]);
  }

  async revokeApiKey(keyId, revokedBy = null, reason = null) {
    const query = `
      UPDATE api_keys
      SET
        status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        revoked_by = $2,
        revoked_reason = $3
      WHERE key_id = $1
      RETURNING
        id, key_id, key_prefix, name, status,
        revoked_at, revoked_by, revoked_reason;
    `;

    const result = await this.db.one(query, [keyId, revokedBy, reason]);

    logger.info('API key revoked', {
      keyId: result.key_id,
      name: result.name,
      revokedBy: result.revoked_by,
      reason: result.revoked_reason,
    });

    return result;
  }

  async updateApiKey(keyId, updates) {
    const { name, description, scopes } = updates;

    const fields = [];
    const params = [];
    let paramIndex = 2; // Start at 2 because $1 is keyId

    if (name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      params.push(name);
    }

    if (description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      params.push(description);
    }

    if (scopes !== undefined) {
      fields.push(`scopes = $${paramIndex++}`);
      params.push(scopes);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    const query = `
      UPDATE api_keys
      SET ${fields.join(', ')}
      WHERE key_id = $1
      RETURNING
        id, key_id, key_prefix, name, description,
        user_id, scopes, status, last_used_at, usage_count,
        created_at, updated_at, expires_at;
    `;

    const result = await this.db.one(query, [keyId, ...params]);

    logger.info('API key updated', {
      keyId: result.key_id,
      name: result.name,
      updates: Object.keys(updates),
    });

    return result;
  }
}

module.exports = ApiKeyRepository;
