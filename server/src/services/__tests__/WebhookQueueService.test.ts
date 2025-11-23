// Mocks must be declared before importing the service
const mockRedisInstance = {
  lpush: jest.fn().mockResolvedValue(1),
  brpop: jest.fn().mockResolvedValue(null),
  rpush: jest.fn().mockResolvedValue(1),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    webhooks: {
      enabled: true,
      redisUrl: 'redis://localhost:6379',
      queueKey: 'flyoverhead:webhooks',
      batchSize: 10,
      pollIntervalMs: 500,
      maxAttempts: 3,
      backoffMs: 1000,
      deliveryTimeoutMs: 5000,
      signatureHeader: 'x-flyover-signature',
      timestampHeader: 'x-flyover-timestamp',
      spawnWorkerInProcess: true,
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Import after mocks are set
// eslint-disable-next-line import/first
import webhookQueueService from '../WebhookQueueService';

describe('WebhookQueueService', () => {
  beforeEach(() => {
    mockRedisInstance.lpush.mockClear();
    mockRedisInstance.brpop.mockClear();
    mockRedisInstance.rpush.mockClear();
    mockRedisInstance.on.mockClear();
  });

  it('initializes Redis when enabled', () => {
    expect(webhookQueueService.isEnabled()).toBe(true);
    expect(webhookQueueService.getQueueKey()).toBe('flyoverhead:webhooks');
    expect(mockRedisInstance.connect).toBeDefined();
  });

  it('enqueues messages to Redis as JSON', async () => {
    const messages = [
      {
        deliveryId: 'd-1',
        subscriptionId: 1,
        callbackUrl: 'https://example.com/webhook',
        signingSecret: 'secret',
        event: {
          id: 'e-1',
          type: 'aircraft.position.updated',
          occurredAt: new Date().toISOString(),
          payload: { icao24: 'abc123' },
          version: 'v1',
        },
        attempt: 0,
        maxAttempts: 3,
        backoffMs: 1000,
      },
    ];

    await webhookQueueService.enqueue(messages);

    expect(mockRedisInstance.lpush).toHaveBeenCalledWith(
      'flyoverhead:webhooks',
      expect.any(String),
    );

    const payload = mockRedisInstance.lpush.mock.calls[0][1] as string;
    expect(JSON.parse(payload)).toMatchObject({
      deliveryId: 'd-1',
      subscriptionId: 1,
      event: { id: 'e-1', type: 'aircraft.position.updated' },
    });
  });

  it('does nothing when called with an empty array', async () => {
    await webhookQueueService.enqueue([]);
    expect(mockRedisInstance.lpush).not.toHaveBeenCalled();
  });
});
