const logger = require('../utils/logger');
const { validateApiKeyFormat, maskApiKey } = require('../utils/apiKeyGenerator');
const postgresRepository = require('../repositories/PostgresRepository');

/**
 * API Key Authentication Middleware (MVP)
 * 
 * This middleware:
 * 1. Extracts API key from Authorization header or X-API-Key header
 * 2. Validates the API key
 * 3. Checks if it's active and not expired
 * 4. Attaches API key data to req.apiKey
 * 5. Is OPTIONAL - passes through if no API key provided
 */

/**
 * Extract API key from request headers
 * @param {object} req - Express request object
 * @returns {string|null} - API key or null
 */
function extractApiKey(req) {
  // Method 1: Authorization Bearer header (preferred)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.substring(7).trim();
    if (key.startsWith('sk_')) {
      return key;
    }
  }

  // Method 2: X-API-Key header (fallback)
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && apiKeyHeader.startsWith('sk_')) {
    return apiKeyHeader.trim();
  }

  // Method 3: Query parameter (not recommended, but supported for testing)
  const queryKey = req.query.api_key;
  if (queryKey && queryKey.startsWith('sk_')) {
    logger.warn('API key provided in query string (not recommended)', {
      path: req.path,
      ip: req.ip,
    });
    return queryKey.trim();
  }

  return null;
}

/**
 * Optional API key authentication middleware
 * Validates API key if provided, but doesn't block if missing
 */
async function optionalApiKeyAuth(req, res, next) {
  try {
    const apiKey = extractApiKey(req);

    // No API key provided - pass through
    if (!apiKey) {
      req.apiKey = null;
      req.auth = {
        authenticated: false,
        type: 'anonymous',
      };
      return next();
    }

    // Validate API key format
    const formatValidation = validateApiKeyFormat(apiKey);
    if (!formatValidation.valid) {
      logger.warn('Invalid API key format', {
        error: formatValidation.error,
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY_FORMAT',
          message: formatValidation.error,
          status: 401,
        },
      });
    }

    // Validate API key against database
    const keyData = await postgresRepository.validateApiKey(apiKey);

    if (!keyData) {
      logger.warn('Invalid API key', {
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: 'The provided API key is invalid or has been revoked.',
          status: 401,
        },
      });
    }

    // Check if key is expired
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      logger.warn('Expired API key', {
        keyId: keyData.key_id,
        expiresAt: keyData.expires_at,
        path: req.path,
      });
      return res.status(401).json({
        error: {
          code: 'EXPIRED_API_KEY',
          message: 'The provided API key has expired.',
          status: 401,
          details: {
            expiresAt: keyData.expires_at,
          },
        },
      });
    }

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: keyData.key_prefix === 'sk_dev_' ? 'development' : 'production',
      userId: keyData.user_id,
      scopes: keyData.scopes || ['read'],
    };

    req.auth = {
      authenticated: true,
      type: 'api_key',
      keyType: req.apiKey.type,
      scopes: req.apiKey.scopes,
    };

    logger.debug('API key authenticated', {
      keyId: keyData.key_id,
      name: keyData.name,
      type: req.apiKey.type,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('API key authentication error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
    });
    return res.status(500).json({
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'An error occurred while authenticating your request.',
        status: 500,
      },
    });
  }
}

/**
 * Required API key authentication middleware
 * Requires a valid API key to proceed
 */
async function requireApiKeyAuth(req, res, next) {
  try {
    const apiKey = extractApiKey(req);

    // No API key provided - reject
    if (!apiKey) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'This endpoint requires an API key.',
          status: 401,
          help: {
            title: 'How to get an API key',
            steps: [
              'Go to your dashboard at https://flyoverhead.com/dashboard',
              'Navigate to API Keys section',
              'Click "Create API Key"',
              'Copy your key and add it to your requests',
            ],
            example: 'Authorization: Bearer sk_live_YOUR_KEY_HERE',
          },
        },
      });
    }

    // Validate API key format
    const formatValidation = validateApiKeyFormat(apiKey);
    if (!formatValidation.valid) {
      logger.warn('Invalid API key format', {
        error: formatValidation.error,
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY_FORMAT',
          message: formatValidation.error,
          status: 401,
        },
      });
    }

    // Validate API key against database
    const keyData = await postgresRepository.validateApiKey(apiKey);

    if (!keyData) {
      logger.warn('Invalid API key', {
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: 'The provided API key is invalid or has been revoked.',
          status: 401,
        },
      });
    }

    // Check if key is expired
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      logger.warn('Expired API key', {
        keyId: keyData.key_id,
        expiresAt: keyData.expires_at,
        path: req.path,
      });
      return res.status(401).json({
        error: {
          code: 'EXPIRED_API_KEY',
          message: 'The provided API key has expired.',
          status: 401,
          details: {
            expiresAt: keyData.expires_at,
          },
        },
      });
    }

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: keyData.key_prefix === 'sk_dev_' ? 'development' : 'production',
      userId: keyData.user_id,
      scopes: keyData.scopes || ['read'],
    };

    req.auth = {
      authenticated: true,
      type: 'api_key',
      keyType: req.apiKey.type,
      scopes: req.apiKey.scopes,
    };

    logger.debug('API key authenticated', {
      keyId: keyData.key_id,
      name: keyData.name,
      type: req.apiKey.type,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('API key authentication error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
    });
    return res.status(500).json({
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'An error occurred while authenticating your request.',
        status: 500,
      },
    });
  }
}

module.exports = {
  optionalApiKeyAuth,
  requireApiKeyAuth,
  extractApiKey,
};

