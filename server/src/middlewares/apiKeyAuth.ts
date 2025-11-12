import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { validateApiKeyFormat, maskApiKey } from '../utils/apiKeyGenerator';
import postgresRepository from '../repositories/PostgresRepository';
import type { ApiKey } from '../types/database.types';

/**
 * Extended Express Request with API key authentication
 */
export interface AuthenticatedRequest extends Request {
  apiKey?: {
    id: number;
    keyId: string;
    name: string;
    prefix: string;
    type: 'development' | 'production' | 'feeder';
    userId: number | null;
    scopes: string[];
  };
  auth?: {
    authenticated: boolean;
    type: 'anonymous' | 'api_key';
    keyType?: 'development' | 'production' | 'feeder';
    scopes?: string[];
  };
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(req: Request): string | null {
  // Method 1: Authorization Bearer header (preferred)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.substring(7).trim();
    if (key.startsWith('sk_') || key.startsWith('fd_')) {
      return key;
    }
  }

  // Method 2: X-API-Key header (fallback)
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string' && (apiKeyHeader.startsWith('sk_') || apiKeyHeader.startsWith('fd_'))) {
    return apiKeyHeader.trim();
  }

  // Method 3: Query parameter (not recommended, but supported for testing)
  const queryKey = req.query.api_key;
  if (queryKey && typeof queryKey === 'string' && (queryKey.startsWith('sk_') || queryKey.startsWith('fd_'))) {
    logger.warn('API key provided in query string (not recommended)', {
      path: req.path,
      ip: req.ip,
    });
    return queryKey.trim();
  }

  return null;
}

/**
 * Determine API key type from prefix
 */
function getKeyTypeFromPrefix(prefix: string): 'development' | 'production' | 'feeder' {
  if (prefix === 'sk_dev_') {
    return 'development';
  }
  if (prefix === 'fd_') {
    return 'feeder';
  }
  return 'production'; // Default for sk_live_ and any other prefix
}

/**
 * Common API key validation logic
 * Returns validation result with key data or error
 */
async function validateApiKeyInternal(
  apiKey: string,
  _required: boolean
): Promise<{ valid: boolean; keyData?: ApiKey; error?: { code: string; message: string; status: number } }> {
  // Validate API key format
  const formatValidation = validateApiKeyFormat(apiKey);
  if (!formatValidation.valid) {
    return {
      valid: false,
      error: {
        code: 'INVALID_API_KEY_FORMAT',
        message: formatValidation.error || 'Invalid API key format',
        status: 401,
      },
    };
  }

  // Validate API key against database
  const keyData = await postgresRepository.validateApiKey(apiKey);

  if (!keyData) {
    return {
      valid: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'The provided API key is invalid or has been revoked.',
        status: 401,
      },
    };
  }

  // Check if key is expired
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    return {
      valid: false,
      error: {
        code: 'EXPIRED_API_KEY',
        message: 'The provided API key has expired.',
        status: 401,
      },
    };
  }

  return { valid: true, keyData };
}

/**
 * Optional API key authentication middleware
 * Validates API key if provided, but doesn't block if missing
 */
export async function optionalApiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = extractApiKey(req);

    // No API key provided - pass through
    if (!apiKey) {
      req.apiKey = undefined;
      req.auth = {
        authenticated: false,
        type: 'anonymous',
      };
      next();
      return;
    }

    const validation = await validateApiKeyInternal(apiKey, false);

    if (!validation.valid || !validation.keyData) {
      logger.warn('Invalid API key format', {
        error: validation.error?.message,
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      res.status(validation.error?.status || 401).json({
        error: validation.error,
      });
      return;
    }

    const keyData = validation.keyData;

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: getKeyTypeFromPrefix(keyData.key_prefix),
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
    const err = error as Error;
    logger.error('API key authentication error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    res.status(500).json({
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
export async function requireApiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = extractApiKey(req);

    // No API key provided - reject
    if (!apiKey) {
      res.status(401).json({
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
      return;
    }

    const validation = await validateApiKeyInternal(apiKey, true);

    if (!validation.valid || !validation.keyData) {
      logger.warn('Invalid API key', {
        error: validation.error?.message,
        masked: maskApiKey(apiKey),
        path: req.path,
        ip: req.ip,
      });
      res.status(validation.error?.status || 401).json({
        error: validation.error,
      });
      return;
    }

    const keyData = validation.keyData;

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: getKeyTypeFromPrefix(keyData.key_prefix),
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
    const err = error as Error;
    logger.error('API key authentication error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    res.status(500).json({
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'An error occurred while authenticating your request.',
        status: 500,
      },
    });
  }
}

