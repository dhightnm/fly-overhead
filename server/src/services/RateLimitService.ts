import logger from '../utils/logger';
import { getRateLimitTier, RATE_LIMIT_WINDOWS, type RateLimitTier } from '../config/rateLimits';

/**
 * Rate Limiting Service
 * Implements sliding window counter algorithm for accurate rate limiting
 * Uses in-memory storage (can be extended to Redis for distributed systems)
 */

interface RateLimitRecord {
  count: number;
  windowStart: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

class RateLimitService {
  private hourlyLimits: Map<string, RateLimitRecord>;

  private dailyLimits: Map<string, RateLimitRecord>;

  private burstLimits: Map<string, RateLimitRecord>;

  private concurrentRequests: Map<string, number>;

  private concurrentRequestTimestamps: Map<string, number[]>; // Track when requests started

  private cleanupInterval: NodeJS.Timeout | null;

  private readonly STUCK_REQUEST_TIMEOUT = 60000; // 60 seconds - auto-release stuck requests

  constructor() {
    this.hourlyLimits = new Map();
    this.dailyLimits = new Map();
    this.burstLimits = new Map();
    this.concurrentRequests = new Map();
    this.concurrentRequestTimestamps = new Map();
    this.cleanupInterval = null;

    // Start cleanup interval (every 5 minutes)
    this.startCleanup();
  }

  /**
   * Check rate limit for a given identifier (API key or IP address)
   */
  async checkRateLimit(
    identifier: string,
    keyType?: string,
    scopes?: string[],
  ): Promise<RateLimitResult> {
    const tier = getRateLimitTier(keyType, scopes);

    // Development keys bypass rate limits
    if (tier.bypassRateLimit) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetAt: Date.now() + RATE_LIMIT_WINDOWS.HOURLY * 1000,
      };
    }

    const now = Date.now();

    // Check burst limit (10 seconds)
    const burstResult = this.checkWindow(
      this.burstLimits,
      identifier,
      tier.burstLimit,
      RATE_LIMIT_WINDOWS.BURST,
      now,
    );

    if (!burstResult.allowed) {
      logger.warn('Burst rate limit exceeded', {
        identifier,
        keyType,
        limit: tier.burstLimit,
      });
      return burstResult;
    }

    // Check hourly limit
    const hourlyResult = this.checkWindow(
      this.hourlyLimits,
      identifier,
      tier.hourlyLimit,
      RATE_LIMIT_WINDOWS.HOURLY,
      now,
    );

    if (!hourlyResult.allowed) {
      logger.warn('Hourly rate limit exceeded', {
        identifier,
        keyType,
        limit: tier.hourlyLimit,
      });
      return hourlyResult;
    }

    // Check daily limit
    const dailyResult = this.checkWindow(
      this.dailyLimits,
      identifier,
      tier.dailyLimit,
      RATE_LIMIT_WINDOWS.DAILY,
      now,
    );

    if (!dailyResult.allowed) {
      logger.warn('Daily rate limit exceeded', {
        identifier,
        keyType,
        limit: tier.dailyLimit,
      });
      return dailyResult;
    }

    // Check concurrent requests
    const concurrent = this.concurrentRequests.get(identifier) || 0;
    if (concurrent >= tier.concurrentLimit) {
      logger.warn('Concurrent request limit exceeded', {
        identifier,
        keyType,
        concurrent,
        limit: tier.concurrentLimit,
      });
      return {
        allowed: false,
        limit: tier.concurrentLimit,
        remaining: 0,
        resetAt: now + 1000, // Try again in 1 second
        retryAfter: 1,
      };
    }

    // All checks passed - return hourly limit status
    return hourlyResult;
  }

  /**
   * Record a request and increment counters
   */
  async recordRequest(identifier: string, keyType?: string, scopes?: string[]): Promise<void> {
    const tier = getRateLimitTier(keyType, scopes);

    // Skip recording for development keys
    if (tier.bypassRateLimit) {
      return;
    }

    const now = Date.now();

    // Increment all windows
    this.incrementWindow(this.burstLimits, identifier, RATE_LIMIT_WINDOWS.BURST, now);
    this.incrementWindow(this.hourlyLimits, identifier, RATE_LIMIT_WINDOWS.HOURLY, now);
    this.incrementWindow(this.dailyLimits, identifier, RATE_LIMIT_WINDOWS.DAILY, now);

    // Increment concurrent requests with timestamp tracking
    const current = this.concurrentRequests.get(identifier) || 0;
    this.concurrentRequests.set(identifier, current + 1);

    // Track timestamp for auto-cleanup of stuck requests
    const timestamps = this.concurrentRequestTimestamps.get(identifier) || [];
    timestamps.push(now);
    this.concurrentRequestTimestamps.set(identifier, timestamps);
  }

  /**
   * Release a concurrent request slot
   */
  async releaseRequest(identifier: string): Promise<void> {
    const current = this.concurrentRequests.get(identifier) || 0;
    if (current > 0) {
      this.concurrentRequests.set(identifier, current - 1);

      // Remove oldest timestamp
      const timestamps = this.concurrentRequestTimestamps.get(identifier) || [];
      if (timestamps.length > 0) {
        timestamps.shift(); // Remove oldest
        if (timestamps.length > 0) {
          this.concurrentRequestTimestamps.set(identifier, timestamps);
        } else {
          this.concurrentRequestTimestamps.delete(identifier);
        }
      }
    }
  }

  /**
   * Get current rate limit status
   */
  async getRateLimitStatus(
    identifier: string,
    keyType?: string,
    scopes?: string[],
  ): Promise<{ hourly: RateLimitResult; daily: RateLimitResult; tier: RateLimitTier }> {
    const tier = getRateLimitTier(keyType, scopes);
    const now = Date.now();

    const hourlyRecord = this.hourlyLimits.get(identifier);
    const dailyRecord = this.dailyLimits.get(identifier);

    return {
      tier,
      hourly: {
        allowed: true,
        limit: tier.hourlyLimit,
        remaining: Math.max(
          0,
          tier.hourlyLimit - (hourlyRecord?.count || 0),
        ),
        resetAt: hourlyRecord?.resetAt || now + RATE_LIMIT_WINDOWS.HOURLY * 1000,
      },
      daily: {
        allowed: true,
        limit: tier.dailyLimit,
        remaining: Math.max(
          0,
          tier.dailyLimit - (dailyRecord?.count || 0),
        ),
        resetAt: dailyRecord?.resetAt || now + RATE_LIMIT_WINDOWS.DAILY * 1000,
      },
    };
  }

  /**
   * Check rate limit for a specific window (sliding window algorithm)
   */
  private checkWindow(
    storage: Map<string, RateLimitRecord>,
    identifier: string,
    limit: number,
    windowSeconds: number,
    now: number,
  ): RateLimitResult {
    const record = storage.get(identifier);
    const windowMs = windowSeconds * 1000;

    // No record or expired window - allow
    if (!record || now >= record.resetAt) {
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetAt: now + windowMs,
      };
    }

    // Check if limit exceeded
    if (record.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: record.resetAt,
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      };
    }

    // Within limit
    return {
      allowed: true,
      limit,
      remaining: limit - record.count - 1,
      resetAt: record.resetAt,
    };
  }

  /**
   * Increment counter for a specific window
   */
  private incrementWindow(
    storage: Map<string, RateLimitRecord>,
    identifier: string,
    windowSeconds: number,
    now: number,
  ): void {
    const record = storage.get(identifier);
    const windowMs = windowSeconds * 1000;

    if (!record || now >= record.resetAt) {
      // Create new window
      storage.set(identifier, {
        count: 1,
        windowStart: now,
        resetAt: now + windowMs,
      });
    } else {
      // Increment existing window
      record.count++;
    }
  }

  /**
   * Clean up expired records (runs every 5 minutes)
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      this.cleanupMap(this.burstLimits, now);
      this.cleanupMap(this.hourlyLimits, now);
      this.cleanupMap(this.dailyLimits, now);

      // Clean up zero concurrent requests
      for (const [key, count] of this.concurrentRequests.entries()) {
        if (count === 0) {
          this.concurrentRequests.delete(key);
        }
      }

      // Clean up stuck concurrent requests (older than timeout)
      for (const [identifier, timestamps] of this.concurrentRequestTimestamps.entries()) {
        const validTimestamps = timestamps.filter((ts) => now - ts < this.STUCK_REQUEST_TIMEOUT);
        const stuckCount = timestamps.length - validTimestamps.length;

        if (stuckCount > 0) {
          logger.warn('Releasing stuck concurrent requests', {
            identifier,
            stuckCount,
            currentCount: this.concurrentRequests.get(identifier),
          });

          const current = this.concurrentRequests.get(identifier) || 0;
          const newCount = Math.max(0, current - stuckCount);
          if (newCount > 0) {
            this.concurrentRequests.set(identifier, newCount);
          } else {
            this.concurrentRequests.delete(identifier);
          }
        }

        if (validTimestamps.length > 0) {
          this.concurrentRequestTimestamps.set(identifier, validTimestamps);
        } else {
          this.concurrentRequestTimestamps.delete(identifier);
        }
      }

      logger.debug('Rate limit cleanup completed', {
        burst: this.burstLimits.size,
        hourly: this.hourlyLimits.size,
        daily: this.dailyLimits.size,
        concurrent: this.concurrentRequests.size,
      });
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Clean up expired records from a map
   */
  private cleanupMap(storage: Map<string, RateLimitRecord>, now: number): void {
    for (const [key, record] of storage.entries()) {
      if (now >= record.resetAt) {
        storage.delete(key);
      }
    }
  }

  /**
   * Stop cleanup interval (for testing/shutdown)
   */
  public stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Reset all rate limits (for testing)
   */
  public reset(): void {
    this.hourlyLimits.clear();
    this.dailyLimits.clear();
    this.burstLimits.clear();
    this.concurrentRequests.clear();
    this.concurrentRequestTimestamps.clear();
  }
}

// Export singleton instance
const rateLimitService = new RateLimitService();
export default rateLimitService;
