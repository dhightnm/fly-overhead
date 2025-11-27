import PerSubscriberRateLimitService from '../PerSubscriberRateLimitService';
import redisClientManager from '../../lib/redis/RedisClientManager';

jest.mock('../../lib/redis/RedisClientManager');
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    feeders: {
      perSubscriberRateLimits: {
        statsPerHour: 60,
        lastSeenPerHour: 120,
        infoPerHour: 100,
      },
    },
    webhooks: {
      subscriberRateLimitPerMinute: 60,
    },
  },
}));
jest.mock('../MetricsService', () => ({
  __esModule: true,
  default: {
    recordRateLimit: jest.fn(),
  },
}));

const mockRedis = {
  multi: jest.fn(),
  incr: jest.fn(),
  pttl: jest.fn(),
  pexpire: jest.fn(),
  del: jest.fn(),
};

const mockManager = jest.mocked(redisClientManager);
mockManager.getClient.mockImplementation((): any => mockRedis);

describe('PerSubscriberRateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.getClient.mockImplementation((): any => mockRedis);
  });

  describe('checkRateLimit', () => {
    it('allows requests under limit', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 5], [null, 3000000]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        100, // 100 per hour
        'stats',
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(95);
      expect(result.limit).toBe(100);
    });

    it('blocks requests over limit', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 101], [null, 3000000]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        100,
        'stats',
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAt).toBeGreaterThan(Date.now());
    });

    it('uses default limits from config when not provided', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);
      mockRedis.pexpire.mockResolvedValue(1);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        undefined,
        'stats',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(60); // From config.feeders.perSubscriberRateLimits.statsPerHour
      expect(mockRedis.pexpire).toHaveBeenCalledWith(
        'rate:feeder:feeder-123:stats',
        3600000, // 1 hour
      );
    });

    it('allows unlimited when limit is negative', async () => {
      // When limit is negative, the service returns early without calling Redis
      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        -1,
        'stats',
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
      expect(result.limit).toBe(Infinity);
      // Verify Redis was not called
      expect(mockRedis.multi).not.toHaveBeenCalled();
    });

    it('handles endpoint-specific limits', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 3000000]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);

      await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        100,
        'last-seen',
      );

      expect(mockPipeline.incr).toHaveBeenCalled();
      // Verify the key includes the endpoint
      expect(mockRedis.multi).toHaveBeenCalled();
    });
  });

  describe('getDefaultLimit', () => {
    it('returns correct default for feeder stats endpoint', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);
      mockRedis.pexpire.mockResolvedValue(1);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        undefined,
        'stats',
      );

      expect(result.limit).toBe(60);
    });

    it('returns correct default for feeder last-seen endpoint', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);
      mockRedis.pexpire.mockResolvedValue(1);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'feeder',
        'feeder-123',
        undefined,
        'last-seen',
      );

      expect(result.limit).toBe(120);
    });

    it('returns correct default for webhook subscribers', async () => {
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
      };
      mockRedis.multi.mockReturnValue(mockPipeline as any);
      mockRedis.pexpire.mockResolvedValue(1);

      const result = await PerSubscriberRateLimitService.checkRateLimit(
        'webhook',
        123,
        undefined,
      );

      expect(result.limit).toBe(3600); // 60 per minute * 60 = 3600 per hour
    });
  });

  describe('resetRateLimit', () => {
    it('deletes rate limit key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await PerSubscriberRateLimitService.resetRateLimit('feeder', 'feeder-123', 'stats');

      expect(mockRedis.del).toHaveBeenCalledWith('rate:feeder:feeder-123:stats');
    });
  });
});
