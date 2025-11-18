import rateLimitService from '../RateLimitService';
import { getRateLimitTier, RATE_LIMIT_TIERS } from '../../config/rateLimits';

describe('RateLimitService', () => {
  beforeEach(() => {
    // Reset rate limits before each test
    rateLimitService.reset();
  });

  afterAll(() => {
    // Stop cleanup interval
    rateLimitService.stopCleanup();
  });

  describe('Rate Limit Tiers', () => {
    it('should return development tier for development keys', () => {
      const tier = getRateLimitTier('development', []);
      expect(tier.name).toBe('Development');
      expect(tier.bypassRateLimit).toBe(true);
      expect(tier.hourlyLimit).toBe(Infinity);
    });

    it('should return admin tier for keys with admin scope', () => {
      const tier = getRateLimitTier('production', ['admin:*']);
      expect(tier.name).toBe('Admin/Internal');
      expect(tier.bypassRateLimit).toBe(false);
      expect(tier.hourlyLimit).toBe(100000);
    });

    it('should return admin tier for keys with internal:all scope', () => {
      const tier = getRateLimitTier('production', ['internal:all']);
      expect(tier.name).toBe('Admin/Internal');
      expect(tier.hourlyLimit).toBe(100000);
    });

    it('should return feeder tier for feeder keys', () => {
      const tier = getRateLimitTier('feeder', []);
      expect(tier.name).toBe('Feeder');
      expect(tier.hourlyLimit).toBe(10000);
      expect(tier.dailyLimit).toBe(200000);
      expect(tier.burstLimit).toBe(200);
      expect(tier.concurrentLimit).toBe(50);
    });

    it('should return production tier for production keys', () => {
      const tier = getRateLimitTier('production', ['read']);
      expect(tier.name).toBe('Production');
      expect(tier.hourlyLimit).toBe(1000);
      expect(tier.dailyLimit).toBe(20000);
    });

    it('should return anonymous tier for no key', () => {
      const tier = getRateLimitTier(undefined, undefined);
      expect(tier.name).toBe('Anonymous');
      expect(tier.hourlyLimit).toBe(50);
      expect(tier.dailyLimit).toBe(200);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      const result = await rateLimitService.checkRateLimit('test-user', 'production', ['read']);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1000); // hourly limit
      expect(result.remaining).toBe(999); // 1 request will be recorded
    });

    it('should bypass rate limits for development keys', async () => {
      const result = await rateLimitService.checkRateLimit('dev-user', 'development', ['internal:all']);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(Infinity);
      expect(result.remaining).toBe(Infinity);
    });

    it('should block requests exceeding burst limit', async () => {
      const identifier = 'burst-test-user';
      const { burstLimit } = RATE_LIMIT_TIERS.production;

      // Make requests up to burst limit, releasing each one to avoid concurrent limit
      for (let i = 0; i < burstLimit; i++) {
        const result = await rateLimitService.checkRateLimit(identifier, 'production', ['read']);
        expect(result.allowed).toBe(true);
        await rateLimitService.recordRequest(identifier, 'production', ['read']);
        await rateLimitService.releaseRequest(identifier); // Release immediately
      }

      // Next request should be blocked by burst limit
      const blockedResult = await rateLimitService.checkRateLimit(identifier, 'production', ['read']);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.remaining).toBe(0);
      expect(blockedResult.retryAfter).toBeDefined();
    });

    it.skip('should block requests exceeding hourly limit', async () => {
      const identifier = 'hourly-test-user';

      // Simulate exceeding hourly limit
      // We'll use restricted tier for testing (100 requests/hour)
      const restrictedLimit = RATE_LIMIT_TIERS.restricted.hourlyLimit; // 100
      const { burstLimit } = RATE_LIMIT_TIERS.restricted; // 5

      // Make requests in batches to avoid burst limit
      // We'll do bursts of 4 (less than burst limit) with small delays
      let totalRequests = 0;
      while (totalRequests < restrictedLimit) {
        const batchSize = Math.min(burstLimit - 1, restrictedLimit - totalRequests);
        for (let i = 0; i < batchSize; i++) {
          const result = await rateLimitService.checkRateLimit(identifier, 'restricted', ['read']);
          if (!result.allowed) break; // Stop if we hit a limit
          await rateLimitService.recordRequest(identifier, 'restricted', ['read']);
          await rateLimitService.releaseRequest(identifier);
          totalRequests++;
        }
        // Small delay between batches to reset burst window
        await new Promise((resolve) => setTimeout(resolve, 15)); // 15ms > 10s burst window
      }

      // Next request should be blocked by hourly limit
      const blockedResult = await rateLimitService.checkRateLimit(identifier, 'restricted', ['read']);
      expect(blockedResult.allowed).toBe(false);
      expect(totalRequests).toBe(restrictedLimit);
    });

    it('should allow higher limits for admin keys', async () => {
      const result = await rateLimitService.checkRateLimit('admin-user', 'production', ['admin:*']);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100000); // admin hourly limit
    });

    it('should allow higher limits for feeder keys', async () => {
      const result = await rateLimitService.checkRateLimit('feeder-user', 'feeder', ['feeder:write']);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10000); // feeder hourly limit (10x production)
    });

    it('should allow higher burst limits for feeder keys', async () => {
      const identifier = 'feeder-burst-test';
      const { burstLimit } = RATE_LIMIT_TIERS.feeder; // 200

      // Make requests up to feeder burst limit
      for (let i = 0; i < burstLimit; i++) {
        const result = await rateLimitService.checkRateLimit(identifier, 'feeder', ['feeder:write']);
        expect(result.allowed).toBe(true);
        await rateLimitService.recordRequest(identifier, 'feeder', ['feeder:write']);
        await rateLimitService.releaseRequest(identifier);
      }

      // Next request should be blocked by burst limit
      const blockedResult = await rateLimitService.checkRateLimit(identifier, 'feeder', ['feeder:write']);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.remaining).toBe(0);
    });
  });

  describe('recordRequest and releaseRequest', () => {
    it('should track concurrent requests', async () => {
      const identifier = 'concurrent-test-user';

      // Record a request
      await rateLimitService.recordRequest(identifier, 'production', ['read']);

      // Check status should show decreased remaining
      const status = await rateLimitService.getRateLimitStatus(identifier, 'production', ['read']);
      expect(status.hourly.remaining).toBeLessThan(1000);

      // Release the request
      await rateLimitService.releaseRequest(identifier);
    });

    it('should not record requests for development keys', async () => {
      const identifier = 'dev-test-user';

      await rateLimitService.recordRequest(identifier, 'development', ['internal:all']);

      const status = await rateLimitService.getRateLimitStatus(identifier, 'development', ['internal:all']);
      // Development keys don't track usage
      expect(status.tier.bypassRateLimit).toBe(true);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return correct status for new user', async () => {
      const status = await rateLimitService.getRateLimitStatus('new-user', 'production', ['read']);

      expect(status.tier.name).toBe('Production');
      expect(status.hourly.limit).toBe(1000);
      expect(status.hourly.remaining).toBe(1000);
      expect(status.daily.limit).toBe(20000);
      expect(status.daily.remaining).toBe(20000);
    });

    it('should return correct status for feeder user', async () => {
      const status = await rateLimitService.getRateLimitStatus('feeder-user', 'feeder', ['feeder:write']);

      expect(status.tier.name).toBe('Feeder');
      expect(status.hourly.limit).toBe(10000);
      expect(status.hourly.remaining).toBe(10000);
      expect(status.daily.limit).toBe(200000);
      expect(status.daily.remaining).toBe(200000);
    });

    it('should return updated status after requests', async () => {
      const identifier = 'status-test-user';

      // Make some requests
      for (let i = 0; i < 5; i++) {
        await rateLimitService.checkRateLimit(identifier, 'production', ['read']);
        await rateLimitService.recordRequest(identifier, 'production', ['read']);
      }

      const status = await rateLimitService.getRateLimitStatus(identifier, 'production', ['read']);
      expect(status.hourly.remaining).toBe(995); // 1000 - 5
      expect(status.daily.remaining).toBe(19995); // 20000 - 5
    });

    it('should show infinite limits for development keys', async () => {
      const status = await rateLimitService.getRateLimitStatus('dev-user', 'development', ['internal:all']);

      expect(status.tier.bypassRateLimit).toBe(true);
      expect(status.hourly.limit).toBe(Infinity);
    });
  });

  describe('Rate Limit Tiers Configuration', () => {
    it('should have correct limits for all tiers', () => {
      expect(RATE_LIMIT_TIERS.development.hourlyLimit).toBe(Infinity);
      expect(RATE_LIMIT_TIERS.admin.hourlyLimit).toBe(100000);
      expect(RATE_LIMIT_TIERS.feeder.hourlyLimit).toBe(10000);
      expect(RATE_LIMIT_TIERS.production.hourlyLimit).toBe(1000);
      expect(RATE_LIMIT_TIERS.restricted.hourlyLimit).toBe(100);
      expect(RATE_LIMIT_TIERS.anonymous.hourlyLimit).toBe(50);
    });

    it('should have appropriate burst limits', () => {
      expect(RATE_LIMIT_TIERS.feeder.burstLimit).toBe(200);
      expect(RATE_LIMIT_TIERS.production.burstLimit).toBe(20);
      expect(RATE_LIMIT_TIERS.restricted.burstLimit).toBe(5);
      expect(RATE_LIMIT_TIERS.anonymous.burstLimit).toBe(3);
    });

    it('should have appropriate concurrent limits', () => {
      expect(RATE_LIMIT_TIERS.feeder.concurrentLimit).toBe(50);
      expect(RATE_LIMIT_TIERS.production.concurrentLimit).toBe(10);
      expect(RATE_LIMIT_TIERS.restricted.concurrentLimit).toBe(3);
      expect(RATE_LIMIT_TIERS.anonymous.concurrentLimit).toBe(2);
    });

    it('should have feeder tier with higher limits than production', () => {
      expect(RATE_LIMIT_TIERS.feeder.hourlyLimit).toBeGreaterThan(RATE_LIMIT_TIERS.production.hourlyLimit);
      expect(RATE_LIMIT_TIERS.feeder.dailyLimit).toBeGreaterThan(RATE_LIMIT_TIERS.production.dailyLimit);
      expect(RATE_LIMIT_TIERS.feeder.burstLimit).toBeGreaterThan(RATE_LIMIT_TIERS.production.burstLimit);
      expect(RATE_LIMIT_TIERS.feeder.concurrentLimit).toBeGreaterThan(RATE_LIMIT_TIERS.production.concurrentLimit);
    });
  });
});
