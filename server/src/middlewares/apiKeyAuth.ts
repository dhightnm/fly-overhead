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
    keyHash: string;
  };
  auth?: {
    authenticated: boolean;
    type: 'anonymous' | 'api_key' | 'webapp';
    keyType?: 'development' | 'production' | 'feeder' | 'webapp';
    scopes?: string[];
  };
  isSameOrigin?: boolean; // Flag to indicate same-origin request
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(req: Request): string | null {
  // Method 1: Authorization Bearer header (preferred)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const key = authHeader.substring(7).trim();

    if (key) {
      return key;
    }
  }

  // Method 2: X-API-Key header (fallback)
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  // Method 3: Query parameter (not recommended, but supported for testing)
  const queryKey = req.query.api_key;
  if (queryKey && typeof queryKey === 'string' && queryKey.trim()) {
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
 * Check if request is from same origin (React app)
 * Allows same-origin requests to bypass API key requirement
 * Same-origin requests typically include browser signals (cookies/origin/referrer)
 */
function isSameOriginRequest(req: Request): boolean {
  const { origin } = req.headers;
  const { referer } = req.headers;
  const { host } = req.headers;
  const hasCookies = !!req.headers.cookie;

  // Extract hostname from current request
  const currentHostname = host ? host.split(':')[0] : '';

  // In development, allow localhost requests (React dev server on 3000 → backend on 3005)
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (isDevelopment) {
    const localhostPatterns = ['localhost', '127.0.0.1', '0.0.0.0'];
    const isLocalhostHost = currentHostname && localhostPatterns.some((pattern) => currentHostname.includes(pattern));

    if (isLocalhostHost) {
      // If origin is also localhost (even different port), allow it in dev
      if (origin) {
        try {
          const originUrl = new URL(origin);
          if (localhostPatterns.some((pattern) => originUrl.hostname.includes(pattern))) {
            return true; // localhost to localhost in dev = same origin
          }
        } catch {
          // Invalid origin URL, continue checking
        }
      }
      // If no origin/referer but we're on localhost in dev, allow it
      if (!origin && !referer) {
        return true;
      }
    }
  }

  // Browser-based requests generally include cookies
  if (hasCookies) {
    return true;
  }

  // Allowed domains (where React app is served from)
  const allowedDomains = [
    'flyoverhead.com',
    'www.flyoverhead.com',
    'api.flyoverhead.com',
    'container-service-1.f199m4bz801f2.us-east-2.cs.amazonlightsail.com',
  ];

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (allowedDomains.some((domain) => originUrl.hostname === domain || originUrl.hostname.endsWith(`.${domain}`))) {
        return true;
      }
    } catch {
      // Invalid origin URL, continue checking
    }
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const isAllowedDomain = allowedDomains.some(
        (domain) => refererUrl.hostname === domain || refererUrl.hostname.endsWith(`.${domain}`),
      );
      if (isAllowedDomain) {
        return true;
      }
    } catch {
      // Invalid referer URL, continue checking
    }
  }

  return false;
}

/**
 * Common API key validation logic
 * Returns validation result with key data or error
 */
async function validateApiKeyInternal(
  apiKey: string,
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
export async function optionalApiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // Check if request is from same origin (React app) first
    // If so, mark as webapp for better rate limits
    if (isSameOriginRequest(req)) {
      req.apiKey = undefined;
      req.isSameOrigin = true;
      req.auth = {
        authenticated: false,
        type: 'webapp',
        keyType: 'webapp',
      };
      logger.debug('Same-origin request (optional auth)', {
        path: req.path,
        origin: req.headers.origin,
        referer: req.headers.referer,
      });
      next();
      return;
    }

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

    const validation = await validateApiKeyInternal(apiKey);

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

    const { keyData } = validation;

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: getKeyTypeFromPrefix(keyData.key_prefix),
      userId: keyData.user_id,
      scopes: keyData.scopes || ['read'],
      keyHash: keyData.key_hash,
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
 * Allows same-origin requests (from React app) without API key
 * Requires API key for external requests
 */
export async function requireApiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // Check if request is from same origin (React app)
    // If so, allow without API key but mark as webapp for better rate limits
    if (isSameOriginRequest(req)) {
      req.apiKey = undefined;
      req.isSameOrigin = true;
      req.auth = {
        authenticated: false,
        type: 'webapp',
        keyType: 'webapp',
      };
      logger.debug('Same-origin request allowed without API key', {
        path: req.path,
        origin: req.headers.origin,
        referer: req.headers.referer,
      });
      next();
      return;
    }

    const apiKey = extractApiKey(req);

    // No API key provided - reject (for external requests)
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

    const validation = await validateApiKeyInternal(apiKey);

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

    const { keyData } = validation;

    // API key is valid - attach to request
    req.apiKey = {
      id: keyData.id,
      keyId: keyData.key_id,
      name: keyData.name,
      prefix: keyData.key_prefix,
      type: getKeyTypeFromPrefix(keyData.key_prefix),
      userId: keyData.user_id,
      scopes: keyData.scopes || ['read'],
      keyHash: keyData.key_hash,
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
