import type Redis from 'ioredis';
import config from '../config';
import redisClientManager from '../lib/redis/RedisClientManager';
import logger from '../utils/logger';
import metricsService from './MetricsService';

export interface RateLimitResult {
  allowed: boolean;
  retryAt?: number;
  remaining?: number;
  limit?: number;
}

export type SubscriberType = 'feeder' | 'webhook' | 'api_key' | 'user';

/**
 * Per-Subscriber Rate Limit Service
 * Provides rate limiting on a per-subscriber basis (feeder, webhook subscription, etc.)
 * Uses Redis for distributed rate limiting
 */
class PerSubscriberRateLimitService {
  private redisClients: Map<string, Redis> = new Map();

  private getRedis(clientName: string, redisUrl?: string): Redis {
    const key = `${clientName}:${redisUrl || 'default'}`;
    if (!this.redisClients.has(key)) {
      const client = redisClientManager.getClient(clientName, redisUrl);
      this.redisClients.set(key, client);
    }
    return this.redisClients.get(key)!;
  }

  private rateKey(subscriberType: SubscriberType, subscriberId: string | number, endpoint?: string): string {
    const endpointPart = endpoint ? `:${endpoint}` : '';
    return `rate:${subscriberType}:${subscriberId}${endpointPart}`;
  }

  /**
   * Check rate limit for a subscriber
   * @param subscriberType - Type of subscriber (feeder, webhook, etc.)
   * @param subscriberId - Unique identifier for the subscriber
   * @param limitPerHour - Rate limit per hour (defaults based on subscriber type)
   * @param endpoint - Optional endpoint identifier for endpoint-specific limits
   * @param redisUrl - Optional Redis URL (uses default if not provided)
   */
  async checkRateLimit(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    limitPerHour?: number | null,
    endpoint?: string,
    redisUrl?: string,
  ): Promise<RateLimitResult> {
    // If limit is explicitly provided and is <= 0, allow unlimited
    if (limitPerHour !== undefined && limitPerHour !== null && limitPerHour <= 0) {
      return { allowed: true, remaining: Infinity, limit: Infinity };
    }

    // Get default limit based on subscriber type if not provided
    let limit = limitPerHour;
    if (!limit || limit <= 0) {
      limit = this.getDefaultLimit(subscriberType, endpoint);
    }

    if (!limit || limit <= 0) {
      return { allowed: true, remaining: Infinity, limit: Infinity };
    }

    const redis = this.getRedis(`rate:${subscriberType}`, redisUrl);
    const key = this.rateKey(subscriberType, subscriberId, endpoint);
    const now = Date.now();

    const pipeline = redis.multi();
    pipeline.incr(key);
    pipeline.pttl(key);
    const execResult = await pipeline.exec();
    const count = Number(execResult?.[0]?.[1] ?? 0);
    let ttlMs = Number(execResult?.[1]?.[1] ?? -1);

    // Set TTL to 1 hour if key doesn't exist
    if (ttlMs < 0) {
      ttlMs = 3600000; // 1 hour in milliseconds
      await redis.pexpire(key, ttlMs);
    }

    const remaining = Math.max(0, limit - count);

    if (count > limit) {
      const retryAt = now + ttlMs;
      logger.debug('Per-subscriber rate limit exceeded', {
        subscriberType,
        subscriberId,
        endpoint,
        limit,
        count,
        retryAt: new Date(retryAt).toISOString(),
      });

      // Record metrics
      metricsService.recordRateLimit(
        endpoint || 'unknown',
        subscriberType,
        subscriberId,
        limit,
        0,
        true,
      );

      return {
        allowed: false, retryAt, remaining: 0, limit,
      };
    }

    // Record metrics for successful check
    metricsService.recordRateLimit(
      endpoint || 'unknown',
      subscriberType,
      subscriberId,
      limit,
      remaining,
      false,
    );

    return { allowed: true, remaining, limit };
  }

  /**
   * Get default rate limit based on subscriber type and endpoint
   */
  private getDefaultLimit(subscriberType: SubscriberType, endpoint?: string): number {
    if (subscriberType === 'feeder') {
      // Use config-based limits for feeder endpoints
      if (endpoint === 'stats') {
        return config.feeders.perSubscriberRateLimits.statsPerHour;
      }
      if (endpoint === 'last-seen') {
        return config.feeders.perSubscriberRateLimits.lastSeenPerHour;
      }
      if (endpoint === 'info' || endpoint === 'me') {
        return config.feeders.perSubscriberRateLimits.infoPerHour;
      }
      // Default for other feeder endpoints
      return 100;
    }

    if (subscriberType === 'webhook') {
      // Convert per-minute to per-hour for consistency
      return (config.webhooks.subscriberRateLimitPerMinute || 60) * 60;
    }

    // Default for other subscriber types
    return 1000;
  }

  /**
   * Reset rate limit for a subscriber (for testing/admin purposes)
   */
  async resetRateLimit(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    endpoint?: string,
    redisUrl?: string,
  ): Promise<void> {
    const redis = this.getRedis(`rate:${subscriberType}`, redisUrl);
    const key = this.rateKey(subscriberType, subscriberId, endpoint);
    await redis.del(key);
  }
}

const perSubscriberRateLimitService = new PerSubscriberRateLimitService();

export default perSubscriberRateLimitService;
