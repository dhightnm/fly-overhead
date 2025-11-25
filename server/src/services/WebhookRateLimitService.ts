import type Redis from 'ioredis';
import config from '../config';
import redisClientManager from '../lib/redis/RedisClientManager';
import logger from '../utils/logger';

interface RateLimitResult {
  allowed: boolean;
  retryAt?: number;
}

interface BreakerStatus {
  tripped: boolean;
  retryAt?: number;
}

class WebhookRateLimitService {
  private clientName = 'webhook:subscriber-controls';

  private redis?: Redis;

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = redisClientManager.getClient(this.clientName, config.webhooks.redisUrl);
    }
    return this.redis;
  }

  private rateKey(subscriptionId: number) {
    return `webhook:sub:${subscriptionId}:rate`;
  }

  private failureKey(subscriptionId: number) {
    return `webhook:sub:${subscriptionId}:failures`;
  }

  private breakerKey(subscriptionId: number) {
    return `webhook:sub:${subscriptionId}:breaker`;
  }

  async checkRateLimit(subscriptionId: number, limitPerMinute?: number | null): Promise<RateLimitResult> {
    const limit = limitPerMinute ?? config.webhooks.subscriberRateLimitPerMinute;
    if (!limit || limit <= 0) {
      return { allowed: true };
    }

    const redis = this.getRedis();
    const key = this.rateKey(subscriptionId);
    const now = Date.now();

    const pipeline = redis.multi();
    pipeline.incr(key);
    pipeline.pttl(key);
    const execResult = await pipeline.exec();
    const count = Number(execResult?.[0]?.[1] ?? 0);
    let ttlMs = Number(execResult?.[1]?.[1] ?? -1);

    if (ttlMs < 0) {
      ttlMs = 60000;
      await redis.pexpire(key, ttlMs);
    }

    if (count > limit) {
      const retryAt = now + ttlMs;
      logger.debug('Webhook subscriber rate limited', {
        subscriptionId,
        limit,
        retryAt,
      });
      return { allowed: false, retryAt };
    }

    return { allowed: true };
  }

  async recordSuccess(subscriptionId: number): Promise<void> {
    const redis = this.getRedis();
    await Promise.all([
      redis.del(this.failureKey(subscriptionId)),
      redis.del(this.breakerKey(subscriptionId)),
    ]);
  }

  async recordFailure(subscriptionId: number): Promise<BreakerStatus> {
    const redis = this.getRedis();
    const failureKey = this.failureKey(subscriptionId);
    const failures = await redis.incr(failureKey);
    await redis.expire(failureKey, config.webhooks.circuitBreaker.resetSeconds);

    if (failures >= config.webhooks.circuitBreaker.failureThreshold) {
      await redis.set(
        this.breakerKey(subscriptionId),
        'tripped',
        'EX',
        config.webhooks.circuitBreaker.resetSeconds,
      );
      const retryAt = Date.now() + (config.webhooks.circuitBreaker.resetSeconds * 1000);
      logger.warn('Webhook subscriber circuit breaker tripped', {
        subscriptionId,
        failures,
        retryAt,
      });
      return { tripped: true, retryAt };
    }

    return { tripped: false };
  }

  async getBreakerStatus(subscriptionId: number): Promise<BreakerStatus> {
    const redis = this.getRedis();
    const ttlMs = await redis.pttl(this.breakerKey(subscriptionId));
    if (ttlMs > 0) {
      return {
        tripped: true,
        retryAt: Date.now() + ttlMs,
      };
    }
    return { tripped: false };
  }
}

const webhookRateLimitService = new WebhookRateLimitService();

export default webhookRateLimitService;
