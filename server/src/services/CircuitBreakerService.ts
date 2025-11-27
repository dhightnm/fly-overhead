import type Redis from 'ioredis';
import redisClientManager from '../lib/redis/RedisClientManager';
import logger from '../utils/logger';
import metricsService from './MetricsService';

export interface BreakerStatus {
  tripped: boolean;
  retryAt?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetSeconds: number;
  redisUrl?: string;
}

export type SubscriberType = 'webhook' | 'feeder' | 'api_key' | 'user';

/**
 * Generic Circuit Breaker Service
 * Tracks failures and trips circuit breakers for misbehaving subscribers
 * Can be used for webhooks, feeders, API keys, or any subscriber type
 */
class CircuitBreakerService {
  private redisClients: Map<string, Redis> = new Map();

  private getRedis(clientName: string, redisUrl?: string): Redis {
    const key = `${clientName}:${redisUrl || 'default'}`;
    if (!this.redisClients.has(key)) {
      const client = redisClientManager.getClient(clientName, redisUrl);
      this.redisClients.set(key, client);
    }
    return this.redisClients.get(key)!;
  }

  private failureKey(subscriberType: SubscriberType, subscriberId: string | number): string {
    return `circuit:${subscriberType}:${subscriberId}:failures`;
  }

  private breakerKey(subscriberType: SubscriberType, subscriberId: string | number): string {
    return `circuit:${subscriberType}:${subscriberId}:breaker`;
  }

  /**
   * Record a successful operation - clears failure count and breaker
   */
  async recordSuccess(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    config: CircuitBreakerConfig,
  ): Promise<void> {
    const redis = this.getRedis(`circuit:${subscriberType}`, config.redisUrl);
    await Promise.all([
      redis.del(this.failureKey(subscriberType, subscriberId)),
      redis.del(this.breakerKey(subscriberType, subscriberId)),
    ]);

    // Record metrics for successful recovery
    metricsService.recordCircuitBreaker(subscriberType, subscriberId, false);
  }

  /**
   * Record a failure and check if circuit breaker should trip
   */
  async recordFailure(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    config: CircuitBreakerConfig,
  ): Promise<BreakerStatus> {
    const redis = this.getRedis(`circuit:${subscriberType}`, config.redisUrl);
    const failureKey = this.failureKey(subscriberType, subscriberId);
    const failures = await redis.incr(failureKey);
    await redis.expire(failureKey, config.resetSeconds);

    if (failures >= config.failureThreshold) {
      await redis.set(
        this.breakerKey(subscriberType, subscriberId),
        'tripped',
        'EX',
        config.resetSeconds,
      );
      const retryAt = Date.now() + (config.resetSeconds * 1000);
      logger.warn('Circuit breaker tripped', {
        subscriberType,
        subscriberId,
        failures,
        threshold: config.failureThreshold,
        retryAt: new Date(retryAt).toISOString(),
      });

      // Record metrics
      metricsService.recordCircuitBreaker(subscriberType, subscriberId, true);

      return { tripped: true, retryAt };
    }

    // Record metrics for failure (but not tripped)
    metricsService.recordCircuitBreaker(subscriberType, subscriberId, false);

    return { tripped: false };
  }

  /**
   * Get current circuit breaker status
   */
  async getBreakerStatus(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    config: CircuitBreakerConfig,
  ): Promise<BreakerStatus> {
    const redis = this.getRedis(`circuit:${subscriberType}`, config.redisUrl);
    const ttlMs = await redis.pttl(this.breakerKey(subscriberType, subscriberId));
    if (ttlMs > 0) {
      return {
        tripped: true,
        retryAt: Date.now() + ttlMs,
      };
    }
    return { tripped: false };
  }

  /**
   * Check if circuit breaker is tripped (convenience method)
   */
  async isTripped(
    subscriberType: SubscriberType,
    subscriberId: string | number,
    config: CircuitBreakerConfig,
  ): Promise<boolean> {
    const status = await this.getBreakerStatus(subscriberType, subscriberId, config);
    return status.tripped;
  }
}

const circuitBreakerService = new CircuitBreakerService();

export default circuitBreakerService;
