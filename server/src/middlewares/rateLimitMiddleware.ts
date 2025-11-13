import { Response, NextFunction } from 'express';
import rateLimitService from '../services/RateLimitService';
import logger from '../utils/logger';
import { RATE_LIMIT_HEADERS } from '../config/rateLimits';
import type { AuthenticatedRequest } from './apiKeyAuth';

/**
 * Rate Limiting Middleware
 * Enforces rate limits based on API key tier or IP address
 * Development keys and admin scopes bypass rate limits
 */
export async function rateLimitMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Determine identifier (API key ID or IP address)
    const identifier = req.apiKey?.keyId || req.ip || 'unknown';
    
    // If same-origin request (web app), use 'webapp' tier for better limits
    const keyType = req.isSameOrigin ? 'webapp' : req.apiKey?.type;
    const scopes = req.apiKey?.scopes;

    // Check rate limit
    const result = await rateLimitService.checkRateLimit(identifier, keyType, scopes);

    // Set rate limit headers
    res.setHeader(RATE_LIMIT_HEADERS.LIMIT, result.limit.toString());
    res.setHeader(RATE_LIMIT_HEADERS.REMAINING, result.remaining.toString());
    res.setHeader(RATE_LIMIT_HEADERS.RESET, Math.floor(result.resetAt / 1000).toString());

    if (!result.allowed) {
      // Rate limit exceeded
      if (result.retryAfter) {
        res.setHeader(RATE_LIMIT_HEADERS.RETRY_AFTER, result.retryAfter.toString());
      }

      logger.warn('Rate limit exceeded', {
        identifier,
        keyType,
        path: req.path,
        ip: req.ip,
        limit: result.limit,
        resetAt: new Date(result.resetAt).toISOString(),
      });

      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: req.apiKey
            ? 'You have exceeded your rate limit. Please try again later.'
            : 'Rate limit exceeded. Create a free API key for higher limits.',
          status: 429,
          details: {
            limit: result.limit,
            remaining: result.remaining,
            reset: Math.floor(result.resetAt / 1000),
            resetIn: `${Math.ceil((result.resetAt - Date.now()) / 1000 / 60)} minutes`,
            retryAfter: result.retryAfter,
          },
          help: !req.apiKey
            ? {
                title: 'Get higher limits with a free API key',
                action: 'Create an API key at https://flyoverhead.com/dashboard/api-keys',
                benefit: 'Free API keys get 1,000 requests/hour (20x more!)',
              }
            : undefined,
        },
      });
      return;
    }

    // Record the request
    await rateLimitService.recordRequest(identifier, keyType, scopes);

    // Release concurrent slot on response finish
    res.on('finish', () => {
      rateLimitService.releaseRequest(identifier).catch((err: Error) => {
        logger.warn('Failed to release rate limit slot', {
          identifier,
          error: err.message,
        });
      });
    });

    // Log for development keys
    if (keyType === 'development') {
      logger.debug('Development key bypassing rate limits', {
        keyId: req.apiKey?.keyId,
        path: req.path,
      });
    }

    next();
  } catch (error) {
    const err = error as Error;
    logger.error('Rate limit middleware error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });

    // On error, allow the request but log it
    next();
  }
}

/**
 * Get rate limit status for current user
 * Useful for dashboard display
 */
export async function getRateLimitStatusHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const identifier = req.apiKey?.keyId || req.ip || 'unknown';
    const keyType = req.apiKey?.type;
    const scopes = req.apiKey?.scopes;

    const status = await rateLimitService.getRateLimitStatus(identifier, keyType, scopes);

    res.json({
      tier: {
        name: status.tier.name,
        hourlyLimit: status.tier.hourlyLimit,
        dailyLimit: status.tier.dailyLimit,
        burstLimit: status.tier.burstLimit,
        concurrentLimit: status.tier.concurrentLimit,
        bypassRateLimit: status.tier.bypassRateLimit,
      },
      hourly: {
        limit: status.hourly.limit,
        remaining: status.hourly.remaining,
        reset: Math.floor(status.hourly.resetAt / 1000),
        resetAt: new Date(status.hourly.resetAt).toISOString(),
      },
      daily: {
        limit: status.daily.limit,
        remaining: status.daily.remaining,
        reset: Math.floor(status.daily.resetAt / 1000),
        resetAt: new Date(status.daily.resetAt).toISOString(),
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error getting rate limit status', {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get rate limit status',
        status: 500,
      },
    });
  }
}

