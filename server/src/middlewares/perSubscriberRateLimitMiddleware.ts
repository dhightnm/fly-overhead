import { Response, NextFunction } from 'express';
import perSubscriberRateLimitService from '../services/PerSubscriberRateLimitService';
import circuitBreakerService from '../services/CircuitBreakerService';
import config from '../config';
import logger from '../utils/logger';
import type { AuthenticatedRequest } from './apiKeyAuth';
import type { SubscriberType } from '../services/PerSubscriberRateLimitService';

const buildBreakerConfig = (subscriberType: SubscriberType) => ({
  ...(subscriberType === 'feeder'
    ? config.feeders.circuitBreaker
    : config.webhooks.circuitBreaker),
  redisUrl: config.redisUrl,
});

/**
 * Per-Subscriber Rate Limit Middleware
 * Enforces rate limits on a per-subscriber basis (feeder, webhook subscription, etc.)
 * Also checks circuit breakers to isolate misbehaving subscribers
 */
export function createPerSubscriberRateLimitMiddleware(
  subscriberType: SubscriberType,
  getSubscriberId: (req: AuthenticatedRequest) => string | number | null,
  endpoint?: string,
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const subscriberId = getSubscriberId(req);
      if (!subscriberId) {
        logger.warn('Per-subscriber rate limit: no subscriber ID found', {
          subscriberType,
          endpoint,
          path: req.path,
        });
        // If we can't identify the subscriber, allow the request but log it
        next();
        return;
      }

      // Check circuit breaker first
      const breakerConfig = buildBreakerConfig(subscriberType);

      const breakerStatus = await circuitBreakerService.getBreakerStatus(
        subscriberType,
        subscriberId,
        breakerConfig,
      );

      if (breakerStatus.tripped && breakerStatus.retryAt) {
        const retryAfter = Math.ceil((breakerStatus.retryAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());
        logger.warn('Circuit breaker active for subscriber', {
          subscriberType,
          subscriberId,
          endpoint,
          retryAt: new Date(breakerStatus.retryAt).toISOString(),
        });

        res.status(503).json({
          error: {
            code: 'CIRCUIT_BREAKER_OPEN',
            message: 'Service temporarily unavailable due to repeated failures. Please try again later.',
            status: 503,
            details: {
              retryAfter,
              retryAt: new Date(breakerStatus.retryAt).toISOString(),
            },
          },
        });
        return;
      }

      // Check rate limit
      const rateLimitResult = await perSubscriberRateLimitService.checkRateLimit(
        subscriberType,
        subscriberId,
        undefined, // Use default from config
        endpoint,
        config.redisUrl,
      );

      // Set rate limit headers
      if (rateLimitResult.limit !== undefined) {
        res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
        res.setHeader('X-RateLimit-Remaining', (rateLimitResult.remaining || 0).toString());
      }

      if (!rateLimitResult.allowed && rateLimitResult.retryAt) {
        const retryAfter = Math.ceil((rateLimitResult.retryAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());
        logger.warn('Per-subscriber rate limit exceeded', {
          subscriberType,
          subscriberId,
          endpoint,
          limit: rateLimitResult.limit,
          retryAt: new Date(rateLimitResult.retryAt).toISOString(),
        });

        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'You have exceeded your rate limit for this operation. Please try again later.',
            status: 429,
            details: {
              limit: rateLimitResult.limit,
              remaining: rateLimitResult.remaining || 0,
              retryAfter,
              retryAt: new Date(rateLimitResult.retryAt).toISOString(),
            },
          },
        });
        return;
      }

      next();
    } catch (error) {
      const err = error as Error;
      logger.error('Per-subscriber rate limit middleware error', {
        error: err.message,
        stack: err.stack,
        subscriberType,
        endpoint,
        path: req.path,
      });

      // On error, allow the request but log it
      next();
    }
  };
}

/**
 * Record success for circuit breaker (call after successful operation)
 */
export async function recordSubscriberSuccess(
  subscriberType: SubscriberType,
  subscriberId: string | number,
): Promise<void> {
  try {
    const breakerConfig = buildBreakerConfig(subscriberType);

    await circuitBreakerService.recordSuccess(subscriberType, subscriberId, breakerConfig);
  } catch (error) {
    const err = error as Error;
    logger.warn('Failed to record subscriber success', {
      subscriberType,
      subscriberId,
      error: err.message,
    });
  }
}

/**
 * Record failure for circuit breaker (call after failed operation)
 */
export async function recordSubscriberFailure(
  subscriberType: SubscriberType,
  subscriberId: string | number,
): Promise<void> {
  try {
    const breakerConfig = buildBreakerConfig(subscriberType);

    const breakerStatus = await circuitBreakerService.recordFailure(
      subscriberType,
      subscriberId,
      breakerConfig,
    );

    if (breakerStatus.tripped) {
      logger.warn('Circuit breaker tripped after recording failure', {
        subscriberType,
        subscriberId,
        retryAt: breakerStatus.retryAt ? new Date(breakerStatus.retryAt).toISOString() : undefined,
      });
    }
  } catch (error) {
    const err = error as Error;
    logger.warn('Failed to record subscriber failure', {
      subscriberType,
      subscriberId,
      error: err.message,
    });
  }
}
