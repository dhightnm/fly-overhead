import { Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { getRequiredScopes, hasAnyScope } from '../config/scopes';
import type { AuthenticatedRequest } from './apiKeyAuth';

/**
 * Permission Checking Middleware
 * Verifies that the authenticated user/key has the required scopes
 */
export function requireScopes(...requiredScopes: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if user is authenticated
      if (!req.auth?.authenticated) {
        res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'This endpoint requires authentication.',
            status: 401,
          },
        });
        return;
      }

      // Get user scopes
      const userScopes = req.apiKey?.scopes || [];

      // Check if user has required scopes
      if (!hasAnyScope(userScopes, requiredScopes)) {
        logger.warn('Insufficient permissions', {
          keyId: req.apiKey?.keyId,
          userScopes,
          requiredScopes,
          path: req.path,
        });

        res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'You do not have permission to access this resource.',
            status: 403,
            details: {
              requiredScopes,
              yourScopes: userScopes,
            },
          },
        });
        return;
      }

      // User has required permissions
      next();
    } catch (error) {
      const err = error as Error;
      logger.error('Permission middleware error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
      });
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while checking permissions.',
          status: 500,
        },
      });
    }
  };
}

/**
 * Automatic permission checking based on endpoint
 * Looks up required scopes from ENDPOINT_SCOPES config
 */
export async function autoPermissionCheck(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { method } = req;
    const { path } = req;

    // Get required scopes for this endpoint
    const requiredScopes = getRequiredScopes(method, path);

    // If no scopes defined for this endpoint, allow
    if (!requiredScopes || requiredScopes.length === 0) {
      next();
      return;
    }

    // Check if user is authenticated
    if (!req.auth?.authenticated) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'This endpoint requires authentication.',
          status: 401,
          help: {
            title: 'How to authenticate',
            steps: [
              'Get an API key from your dashboard',
              'Add it to the Authorization header: Bearer YOUR_KEY',
            ],
          },
        },
      });
      return;
    }

    // Get user scopes
    const userScopes = req.apiKey?.scopes || [];

    // Check if user has required scopes
    if (!hasAnyScope(userScopes, requiredScopes)) {
      logger.warn('Insufficient permissions (auto check)', {
        keyId: req.apiKey?.keyId,
        userScopes,
        requiredScopes,
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to access this resource.',
          status: 403,
          details: {
            requiredScopes,
            yourScopes: userScopes,
          },
        },
      });
      return;
    }

    // User has required permissions
    next();
  } catch (error) {
    const err = error as Error;
    logger.error('Auto permission middleware error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });

    // On error, allow the request but log it
    next();
  }
}

/**
 * Optional permission check - doesn't block if no auth, but checks if auth is present
 */
export function optionalPermissionCheck(...requiredScopes: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // If not authenticated, allow
      if (!req.auth?.authenticated) {
        next();
        return;
      }

      // Get user scopes
      const userScopes = req.apiKey?.scopes || [];

      // Check if user has required scopes
      if (!hasAnyScope(userScopes, requiredScopes)) {
        logger.warn('Insufficient permissions (optional check)', {
          keyId: req.apiKey?.keyId,
          userScopes,
          requiredScopes,
          path: req.path,
        });

        res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'Your API key does not have permission to access this resource.',
            status: 403,
            details: {
              requiredScopes,
              yourScopes: userScopes,
            },
          },
        });
        return;
      }

      // User has required permissions
      next();
    } catch (error) {
      const err = error as Error;
      logger.error('Optional permission middleware error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
      });

      // On error, allow the request but log it
      next();
    }
  };
}
