import CircuitBreakerService, { type CircuitBreakerConfig } from '../CircuitBreakerService';
import redisClientManager from '../../lib/redis/RedisClientManager';

jest.mock('../../lib/redis/RedisClientManager');

const mockRedis = {
  incr: jest.fn(),
  expire: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  pttl: jest.fn(),
};

const mockManager = jest.mocked(redisClientManager);
mockManager.getClient.mockImplementation((): any => mockRedis);

describe('CircuitBreakerService', () => {
  const config: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetSeconds: 60,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.getClient.mockImplementation((): any => mockRedis);
  });

  describe('recordSuccess', () => {
    it('clears failure count and breaker on success', async () => {
      mockRedis.del.mockResolvedValue(1);

      await CircuitBreakerService.recordSuccess('feeder', 'feeder-123', config);

      expect(mockRedis.del).toHaveBeenCalledTimes(2);
      expect(mockRedis.del).toHaveBeenCalledWith('circuit:feeder:feeder-123:failures');
      expect(mockRedis.del).toHaveBeenCalledWith('circuit:feeder:feeder-123:breaker');
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await CircuitBreakerService.recordFailure('feeder', 'feeder-123', config);

      expect(mockRedis.incr).toHaveBeenCalledWith('circuit:feeder:feeder-123:failures');
      expect(mockRedis.expire).toHaveBeenCalledWith('circuit:feeder:feeder-123:failures', 60);
      expect(result.tripped).toBe(false);
    });

    it('trips breaker when threshold exceeded', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.set.mockResolvedValue('OK');

      const result = await CircuitBreakerService.recordFailure('feeder', 'feeder-123', config);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'circuit:feeder:feeder-123:breaker',
        'tripped',
        'EX',
        60,
      );
      expect(result.tripped).toBe(true);
      expect(result.retryAt).toBeGreaterThan(Date.now());
    });

    it('does not trip breaker when below threshold', async () => {
      mockRedis.incr.mockResolvedValue(2);
      mockRedis.expire.mockResolvedValue(1);

      const result = await CircuitBreakerService.recordFailure('feeder', 'feeder-123', config);

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(result.tripped).toBe(false);
    });
  });

  describe('getBreakerStatus', () => {
    it('returns tripped status when breaker is active', async () => {
      mockRedis.pttl.mockResolvedValue(30000); // 30 seconds remaining

      const status = await CircuitBreakerService.getBreakerStatus('feeder', 'feeder-123', config);

      expect(status.tripped).toBe(true);
      expect(status.retryAt).toBeGreaterThan(Date.now());
    });

    it('returns not tripped when breaker is not active', async () => {
      mockRedis.pttl.mockResolvedValue(-1); // Key doesn't exist

      const status = await CircuitBreakerService.getBreakerStatus('feeder', 'feeder-123', config);

      expect(status.tripped).toBe(false);
      expect(status.retryAt).toBeUndefined();
    });
  });

  describe('isTripped', () => {
    it('returns true when breaker is tripped', async () => {
      mockRedis.pttl.mockResolvedValue(30000);

      const isTripped = await CircuitBreakerService.isTripped('feeder', 'feeder-123', config);

      expect(isTripped).toBe(true);
    });

    it('returns false when breaker is not tripped', async () => {
      mockRedis.pttl.mockResolvedValue(-1);

      const isTripped = await CircuitBreakerService.isTripped('feeder', 'feeder-123', config);

      expect(isTripped).toBe(false);
    });
  });

  describe('different subscriber types', () => {
    it('handles webhook subscribers', async () => {
      mockRedis.del.mockResolvedValue(1);

      await CircuitBreakerService.recordSuccess('webhook', 123, config);

      expect(mockRedis.del).toHaveBeenCalledWith('circuit:webhook:123:failures');
      expect(mockRedis.del).toHaveBeenCalledWith('circuit:webhook:123:breaker');
    });

    it('handles API key subscribers', async () => {
      mockRedis.del.mockResolvedValue(1);

      await CircuitBreakerService.recordSuccess('api_key', 'key-456', config);

      expect(mockRedis.del).toHaveBeenCalledWith('circuit:api_key:key-456:failures');
      expect(mockRedis.del).toHaveBeenCalledWith('circuit:api_key:key-456:breaker');
    });

    it('handles user subscribers', async () => {
      mockRedis.del.mockResolvedValue(1);

      await CircuitBreakerService.recordSuccess('user', 789, config);

      expect(mockRedis.del).toHaveBeenCalledWith('circuit:user:789:failures');
      expect(mockRedis.del).toHaveBeenCalledWith('circuit:user:789:breaker');
    });
  });
});
