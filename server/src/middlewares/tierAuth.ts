import { Response, NextFunction } from 'express';
import logger from '../utils/logger';
import userSubscriptionService from '../services/UserSubscriptionService';
import postgresRepository from '../repositories/PostgresRepository';
import type { AuthenticatedRequest } from './apiKeyAuth';
import type { AuthenticatedRequest as AuthAuthenticatedRequest } from '../routes/auth.routes';

/**
 * Extended request type that supports both JWT and API key authentication
 */
type TierAuthenticatedRequest = (AuthenticatedRequest | AuthAuthenticatedRequest) & {
  user?: { userId: number; email?: string };
  apiKey?: { userId: number | null };
};

/**
 * Get user ID from request (supports both JWT and API key auth)
 */
function getUserId(req: TierAuthenticatedRequest): number | null {
  // JWT authentication (webapp)
  if (req.user?.userId) {
    return req.user.userId;
  }

  // API key authentication
  if (req.apiKey?.userId) {
    return req.apiKey.userId;
  }

  return null;
}

/**
 * Middleware to require Premium or EFB subscription
 * Allows access if user has either isPremium OR isEFB flag
 */
export async function requirePremiumOrEFB(
  req: TierAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'This endpoint requires authentication.',
          status: 401,
        },
      });
      return;
    }

    const flags = await userSubscriptionService.calculateUserFlags(userId);

    // Also check database flags (for manually set premium/EFB users)
    const user = await postgresRepository.getUserById(userId);
    const hasPremium = flags.isPremium || user?.is_premium || false;
    const hasEFB = flags.isEFB || user?.is_efb || false;

    if (!hasPremium && !hasEFB) {
      logger.warn('Access denied: Premium or EFB subscription required', {
        userId,
        path: req.path,
        flags,
        dbFlags: { is_premium: user?.is_premium, is_efb: user?.is_efb },
      });

      res.status(403).json({
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'This feature requires a Premium or EFB subscription.',
          status: 403,
          upgrade: {
            title: 'Upgrade to access weather data',
            message: 'Get real-time METAR and TAF data with a Premium or EFB subscription.',
            link: '/pricing',
          },
        },
      });
      return;
    }

    // Attach flags to request for use in route handlers
    (req as TierAuthenticatedRequest & { subscriptionFlags?: typeof flags }).subscriptionFlags = {
      isPremium: hasPremium,
      isEFB: hasEFB,
      isAPI: flags.isAPI || user?.is_api || false,
    };
    next();
  } catch (error) {
    const err = error as Error;
    logger.error('Tier auth middleware error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while checking subscription status.',
        status: 500,
      },
    });
  }
}

/**
 * Middleware to require EFB subscription
 * Only allows access if user has isEFB flag
 */
export async function requireEFB(req: TierAuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'This endpoint requires authentication.',
          status: 401,
        },
      });
      return;
    }

    const flags = await userSubscriptionService.calculateUserFlags(userId);

    // Also check database flags (for manually set EFB users)
    const user = await postgresRepository.getUserById(userId);
    const hasEFB = flags.isEFB || user?.is_efb || false;

    if (!hasEFB) {
      logger.warn('Access denied: EFB subscription required', {
        userId,
        path: req.path,
        flags,
        dbFlags: { is_efb: user?.is_efb },
      });

      res.status(403).json({
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'This feature requires an EFB subscription.',
          status: 403,
          upgrade: {
            title: 'Upgrade to EFB for historical weather data',
            message: 'Get historical METAR data and advanced weather features with an EFB subscription.',
            link: '/pricing',
          },
        },
      });
      return;
    }

    // Attach flags to request for use in route handlers
    (
      req as TierAuthenticatedRequest & {
        subscriptionFlags?: typeof flags;
      }
    ).subscriptionFlags = {
      isPremium: flags.isPremium || user?.is_premium || false,
      isEFB: hasEFB,
      isAPI: flags.isAPI || user?.is_api || false,
    };
    next();
  } catch (error) {
    const err = error as Error;
    logger.error('Tier auth middleware error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while checking subscription status.',
        status: 500,
      },
    });
  }
}

/**
 * Optional tier check - doesn't block, but attaches flags to request
 * Useful for endpoints that show different data based on tier
 */
export async function optionalTierCheck(
  req: TierAuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (userId) {
      const flags = await userSubscriptionService.calculateUserFlags(userId);
      const user = await postgresRepository.getUserById(userId);
      (
        req as TierAuthenticatedRequest & {
          subscriptionFlags?: typeof flags;
        }
      ).subscriptionFlags = {
        isPremium: flags.isPremium || user?.is_premium || false,
        isEFB: flags.isEFB || user?.is_efb || false,
        isAPI: flags.isAPI || user?.is_api || false,
      };
    } else {
      // No user - set default flags
      (
        req as TierAuthenticatedRequest & {
          subscriptionFlags?: {
            isPremium: boolean;
            isEFB: boolean;
            isAPI: boolean;
          };
        }
      ).subscriptionFlags = {
        isPremium: false,
        isEFB: false,
        isAPI: false,
      };
    }

    next();
  } catch (error) {
    const err = error as Error;
    logger.warn('Optional tier check failed, continuing with default flags', {
      error: err.message,
      path: req.path,
    });
    // On error, continue with default flags
    (
      req as TierAuthenticatedRequest & {
        subscriptionFlags?: {
          isPremium: boolean;
          isEFB: boolean;
          isAPI: boolean;
        };
      }
    ).subscriptionFlags = {
      isPremium: false,
      isEFB: false,
      isAPI: false,
    };
    next();
  }
}
