const logger = require('../utils/logger');

/**
 * Rate Limit Manager for OpenSky API
 * Handles 429 errors gracefully with exponential backoff
 */
class RateLimitManager {
  constructor() {
    this.blockedUntil = null; // Timestamp when we can retry
    this.consecutiveFailures = 0;
    this.baseBackoffSeconds = 300; // 5 minutes base backoff
    this.maxBackoffSeconds = 3600; // 1 hour max backoff
  }

  /**
   * Check if we're currently rate limited
   * @returns {boolean}
   */
  isRateLimited() {
    if (!this.blockedUntil) return false;

    const now = Date.now();
    if (now < this.blockedUntil) {
      const secondsRemaining = Math.ceil((this.blockedUntil - now) / 1000);
      logger.debug('OpenSky API still rate limited', {
        secondsRemaining,
        blockedUntil: new Date(this.blockedUntil).toISOString(),
      });
      return true;
    }

    // Rate limit has expired
    this.blockedUntil = null;
    this.consecutiveFailures = 0;
    logger.info('OpenSky rate limit has expired, resuming requests');
    return false;
  }

  /**
   * Get seconds until we can retry
   * @returns {number|null}
   */
  getSecondsUntilRetry() {
    if (!this.blockedUntil) return null;

    const now = Date.now();
    if (now >= this.blockedUntil) return 0;

    return Math.ceil((this.blockedUntil - now) / 1000);
  }

  /**
   * Record a rate limit hit
   * @param {number|null} retryAfterSeconds - Retry-after value from API header
   */
  recordRateLimit(retryAfterSeconds = null) {
    this.consecutiveFailures++;

    let backoffSeconds;
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      // Use the API's retry-after if provided
      backoffSeconds = retryAfterSeconds;
      logger.warn('OpenSky rate limit hit - using API retry-after', {
        retryAfterSeconds,
        retryAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
      });
    } else {
      // Use exponential backoff
      backoffSeconds = Math.min(
        this.baseBackoffSeconds * 2 ** (this.consecutiveFailures - 1),
        this.maxBackoffSeconds,
      );
      logger.warn('OpenSky rate limit hit - using exponential backoff', {
        consecutiveFailures: this.consecutiveFailures,
        backoffSeconds,
        retryAt: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      });
    }

    this.blockedUntil = Date.now() + (backoffSeconds * 1000);
  }

  /**
   * Record a successful request (resets consecutive failures)
   */
  recordSuccess() {
    if (this.consecutiveFailures > 0) {
      logger.info('OpenSky request succeeded, resetting failure count', {
        previousFailures: this.consecutiveFailures,
      });
      this.consecutiveFailures = 0;
    }
    this.blockedUntil = null;
  }

  /**
   * Get current status
   * @returns {object}
   */
  getStatus() {
    return {
      isRateLimited: this.isRateLimited(),
      blockedUntil: this.blockedUntil ? new Date(this.blockedUntil).toISOString() : null,
      secondsUntilRetry: this.getSecondsUntilRetry(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Reset rate limit state (for testing or manual override)
   */
  reset() {
    logger.info('Manually resetting OpenSky rate limit state');
    this.blockedUntil = null;
    this.consecutiveFailures = 0;
  }
}

// Export singleton instance
module.exports = new RateLimitManager();
