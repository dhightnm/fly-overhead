import webhookRateLimitService from '../WebhookRateLimitService';
import redisClientManager from '../../lib/redis/RedisClientManager';
import config from '../../config';

jest.mock('../../lib/redis/RedisClientManager');

const mockRedis = {
  multi: jest.fn(),
  incr: jest.fn(),
  pttl: jest.fn(),
  pexpire: jest.fn(),
  expire: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exec: jest.fn(),
};

const mockManager = redisClientManager as jest.Mocked<typeof redisClientManager>;
mockManager.getClient.mockImplementation((): any => mockRedis);

const originalConfig = {
  subscriberRateLimitPerMinute: config.webhooks.subscriberRateLimitPerMinute,
  circuitBreaker: { ...config.webhooks.circuitBreaker },
};

describe('WebhookRateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.getClient.mockImplementation((): any => mockRedis);
    config.webhooks.subscriberRateLimitPerMinute = 2;
    config.webhooks.circuitBreaker.failureThreshold = 2;
    config.webhooks.circuitBreaker.resetSeconds = 60;
    (mockRedis.multi as jest.Mock).mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
    });
  });

  afterAll(() => {
    config.webhooks.subscriberRateLimitPerMinute = originalConfig.subscriberRateLimitPerMinute;
    config.webhooks.circuitBreaker.failureThreshold = originalConfig.circuitBreaker.failureThreshold;
    config.webhooks.circuitBreaker.resetSeconds = originalConfig.circuitBreaker.resetSeconds;
  });

  it('allows requests under rate limit', async () => {
    const result = await webhookRateLimitService.checkRateLimit(1, 5);
    expect(result.allowed).toBe(true);
  });

  it('throttles when limit exceeded', async () => {
    (mockRedis.multi as jest.Mock).mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 10], [null, 30000]]),
    });

    const result = await webhookRateLimitService.checkRateLimit(1, 5);
    expect(result.allowed).toBe(false);
    expect(result.retryAt).toBeGreaterThan(Date.now());
  });

  it('records failures and trips breaker', async () => {
    mockRedis.incr.mockResolvedValueOnce(2);
    const status = await webhookRateLimitService.recordFailure(5);
    expect(status.tripped).toBe(true);
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('clears breaker on success', async () => {
    await webhookRateLimitService.recordSuccess(5);
    expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('failures'));
  });

  it('reports breaker status', async () => {
    mockRedis.pttl.mockResolvedValueOnce(1000);
    const status = await webhookRateLimitService.getBreakerStatus(1);
    expect(status.tripped).toBe(true);
  });
});
