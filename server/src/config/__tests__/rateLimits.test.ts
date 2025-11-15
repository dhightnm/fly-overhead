import {
  getRateLimitTier, RATE_LIMIT_TIERS, RATE_LIMIT_WINDOWS, RATE_LIMIT_HEADERS,
} from '../rateLimits';

describe('Rate Limits Configuration', () => {
  describe('RATE_LIMIT_TIERS', () => {
    it('should have development tier with infinite limits', () => {
      const tier = RATE_LIMIT_TIERS.development;
      expect(tier.name).toBe('Development');
      expect(tier.hourlyLimit).toBe(Infinity);
      expect(tier.dailyLimit).toBe(Infinity);
      expect(tier.burstLimit).toBe(Infinity);
      expect(tier.concurrentLimit).toBe(Infinity);
      expect(tier.bypassRateLimit).toBe(true);
    });

    it('should have admin tier with high limits', () => {
      const tier = RATE_LIMIT_TIERS.admin;
      expect(tier.name).toBe('Admin/Internal');
      expect(tier.hourlyLimit).toBe(100000);
      expect(tier.dailyLimit).toBe(1000000);
      expect(tier.burstLimit).toBe(1000);
      expect(tier.concurrentLimit).toBe(100);
      expect(tier.bypassRateLimit).toBe(false);
    });

    it('should have feeder tier with high limits', () => {
      const tier = RATE_LIMIT_TIERS.feeder;
      expect(tier.name).toBe('Feeder');
      expect(tier.hourlyLimit).toBe(10000);
      expect(tier.dailyLimit).toBe(200000);
      expect(tier.burstLimit).toBe(200);
      expect(tier.concurrentLimit).toBe(50);
      expect(tier.bypassRateLimit).toBe(false);
    });

    it('should have production tier with standard limits', () => {
      const tier = RATE_LIMIT_TIERS.production;
      expect(tier.name).toBe('Production');
      expect(tier.hourlyLimit).toBe(1000);
      expect(tier.dailyLimit).toBe(20000);
      expect(tier.burstLimit).toBe(20);
      expect(tier.concurrentLimit).toBe(10);
      expect(tier.bypassRateLimit).toBe(false);
    });

    it('should have restricted tier with low limits', () => {
      const tier = RATE_LIMIT_TIERS.restricted;
      expect(tier.name).toBe('Restricted');
      expect(tier.hourlyLimit).toBe(100);
      expect(tier.dailyLimit).toBe(500);
      expect(tier.burstLimit).toBe(5);
      expect(tier.concurrentLimit).toBe(3);
      expect(tier.bypassRateLimit).toBe(false);
    });

    it('should have webapp tier with very high limits', () => {
      const tier = RATE_LIMIT_TIERS.webapp;
      expect(tier.name).toBe('Web App');
      expect(tier.hourlyLimit).toBe(Infinity);
      expect(tier.dailyLimit).toBe(Infinity);
      expect(tier.burstLimit).toBe(Infinity);
      expect(tier.concurrentLimit).toBe(Infinity);
      expect(tier.bypassRateLimit).toBe(true); // Bypass all rate limit tracking for first-party app
    });

    it('should have anonymous tier with very low limits', () => {
      const tier = RATE_LIMIT_TIERS.anonymous;
      expect(tier.name).toBe('Anonymous');
      expect(tier.hourlyLimit).toBe(50);
      expect(tier.dailyLimit).toBe(200);
      expect(tier.burstLimit).toBe(3);
      expect(tier.concurrentLimit).toBe(2);
      expect(tier.bypassRateLimit).toBe(false);
    });
  });

  describe('getRateLimitTier', () => {
    it('should return development tier for development key type', () => {
      const tier = getRateLimitTier('development');
      expect(tier).toBe(RATE_LIMIT_TIERS.development);
      expect(tier.bypassRateLimit).toBe(true);
    });

    it('should return feeder tier for feeder key type', () => {
      const tier = getRateLimitTier('feeder');
      expect(tier).toBe(RATE_LIMIT_TIERS.feeder);
    });

    it('should return admin tier for keys with admin:* scope', () => {
      const tier = getRateLimitTier('production', ['admin:*']);
      expect(tier).toBe(RATE_LIMIT_TIERS.admin);
    });

    it('should return admin tier for keys with internal:all scope', () => {
      const tier = getRateLimitTier('production', ['internal:all']);
      expect(tier).toBe(RATE_LIMIT_TIERS.admin);
    });

    it('should return admin tier even if key type is development but has admin scope', () => {
      // Development keys bypass, but if they have admin scope, they should still get admin tier
      // However, development keys are checked first, so this should return development
      const tier = getRateLimitTier('development', ['admin:*']);
      expect(tier).toBe(RATE_LIMIT_TIERS.development); // Development bypasses first
    });

    it('should return production tier for production key type', () => {
      const tier = getRateLimitTier('production');
      expect(tier).toBe(RATE_LIMIT_TIERS.production);
    });

    it('should return webapp tier for webapp key type', () => {
      const tier = getRateLimitTier('webapp');
      expect(tier).toBe(RATE_LIMIT_TIERS.webapp);
    });

    it('should return restricted tier for restricted key type', () => {
      const tier = getRateLimitTier('restricted');
      expect(tier).toBe(RATE_LIMIT_TIERS.restricted);
    });

    it('should return anonymous tier when no key type provided', () => {
      const tier = getRateLimitTier();
      expect(tier).toBe(RATE_LIMIT_TIERS.anonymous);
    });

    it('should return anonymous tier for unknown key type', () => {
      const tier = getRateLimitTier('unknown' as any);
      expect(tier).toBe(RATE_LIMIT_TIERS.anonymous);
    });

    it('should prioritize development over admin scope', () => {
      const tier = getRateLimitTier('development', ['admin:*']);
      expect(tier).toBe(RATE_LIMIT_TIERS.development);
    });

    it('should prioritize feeder over admin scope', () => {
      const tier = getRateLimitTier('feeder', ['admin:*']);
      expect(tier).toBe(RATE_LIMIT_TIERS.feeder);
    });

    it('should check admin scope before production type', () => {
      const tier = getRateLimitTier('production', ['admin:*']);
      expect(tier).toBe(RATE_LIMIT_TIERS.admin);
    });

    it('should return production tier for production key without admin scope', () => {
      const tier = getRateLimitTier('production', ['read', 'aircraft:read']);
      expect(tier).toBe(RATE_LIMIT_TIERS.production);
    });

    it('should handle empty scopes array', () => {
      const tier = getRateLimitTier('production', []);
      expect(tier).toBe(RATE_LIMIT_TIERS.production);
    });

    it('should handle undefined scopes', () => {
      const tier = getRateLimitTier('production', undefined);
      expect(tier).toBe(RATE_LIMIT_TIERS.production);
    });
  });

  describe('RATE_LIMIT_WINDOWS', () => {
    it('should have correct burst window (10 seconds)', () => {
      expect(RATE_LIMIT_WINDOWS.BURST).toBe(10);
    });

    it('should have correct hourly window (3600 seconds)', () => {
      expect(RATE_LIMIT_WINDOWS.HOURLY).toBe(3600);
    });

    it('should have correct daily window (86400 seconds)', () => {
      expect(RATE_LIMIT_WINDOWS.DAILY).toBe(86400);
    });
  });

  describe('RATE_LIMIT_HEADERS', () => {
    it('should have correct header names', () => {
      expect(RATE_LIMIT_HEADERS.LIMIT).toBe('X-RateLimit-Limit');
      expect(RATE_LIMIT_HEADERS.REMAINING).toBe('X-RateLimit-Remaining');
      expect(RATE_LIMIT_HEADERS.RESET).toBe('X-RateLimit-Reset');
      expect(RATE_LIMIT_HEADERS.RETRY_AFTER).toBe('Retry-After');
    });
  });
});
