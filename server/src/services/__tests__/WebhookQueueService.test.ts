const mockRedisInstance = {
  lpush: jest.fn().mockResolvedValue(1),
  brpop: jest.fn().mockResolvedValue(null),
  rpush: jest.fn().mockResolvedValue(1),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  quit: jest.fn(),
  pipeline: jest.fn(),
};

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    webhooks: {
      enabled: true,
      redisUrl: 'redis://localhost:6379',
      queueKey: 'flyoverhead:webhooks',
      delayedKey: 'flyoverhead:webhooks:delayed',
      dlqKey: 'flyoverhead:webhooks:dlq',
      batchSize: 10,
      pollIntervalMs: 500,
      maxAttempts: 3,
      backoffMs: 1000,
      retryJitterMs: 100,
      delayedPromotionBatchSize: 50,
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
// eslint-disable-next-line import/first
import { WebhookQueueService as WebhookQueueServiceClass } from '../WebhookQueueService';

describe('WebhookQueueService', () => {
  const mockManager = {
    getClient: jest.fn(() => mockRedisInstance),
    getHealth: jest.fn(() => ({ 'webhook:producer': { status: 'ready' } })),
  };

  let webhookQueueService: WebhookQueueServiceClass;

  beforeEach(() => {
    mockRedisInstance.lpush.mockClear();
    mockRedisInstance.brpop.mockClear();
    mockRedisInstance.rpush.mockClear();
    mockRedisInstance.on.mockClear();
    mockRedisInstance.pipeline.mockReturnValue({
      llen: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 0], [null, 0], [null, 0]]),
    });
    mockManager.getClient.mockClear();
    mockManager.getHealth.mockClear();
    webhookQueueService = new WebhookQueueServiceClass(mockManager as any);
    jest.spyOn(webhookQueueService as any, 'getRedis').mockReturnValue(mockRedisInstance as any);
  });

  it('initializes Redis when enabled', () => {
    expect(webhookQueueService.isEnabled()).toBe(true);
    expect(webhookQueueService.getQueueKey()).toBe('flyoverhead:webhooks');
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

  it('returns queue metrics from Redis', async () => {
    const llen = jest.fn().mockReturnThis();
    const zcard = jest.fn().mockReturnThis();
    const exec = jest.fn().mockResolvedValue([[null, 3], [null, 1], [null, 0]]);
    mockRedisInstance.pipeline.mockReturnValue({ llen, zcard, exec });

    const stats = await webhookQueueService.getStats();

    expect(mockRedisInstance.pipeline).toHaveBeenCalled();
    expect(stats).toEqual({ queueDepth: 3, delayedDepth: 1, dlqDepth: 0 });
  });
});
