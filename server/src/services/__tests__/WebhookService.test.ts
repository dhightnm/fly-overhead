// Set up mocks before importing the service
const mockRepository = {
  createWebhookSubscription: jest.fn(),
  listWebhookSubscriptions: jest.fn(),
  findActiveWebhookSubscriptions: jest.fn(),
  createWebhookEvent: jest.fn(),
  createWebhookDelivery: jest.fn(),
  updateWebhookDelivery: jest.fn(),
  markWebhookSubscriptionSuccess: jest.fn(),
};

const mockQueue = {
  enqueue: jest.fn(),
};

const mockRedisInstance = {
  publish: jest.fn().mockResolvedValue(1),
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  webhooks: {
    enabled: true,
    redisUrl: 'redis://localhost:6379',
    queueKey: 'flyoverhead:webhooks',
    batchSize: 10,
    pollIntervalMs: 500,
    maxAttempts: 6,
    backoffMs: 15000,
    deliveryTimeoutMs: 10000,
    signatureHeader: 'x-flyover-signature',
    timestampHeader: 'x-flyover-timestamp',
    spawnWorkerInProcess: true,
  },
};

const mockRandomBytes = jest.fn((size?: number) => {
  const buffer = Buffer.from(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'hex',
  );
  if (typeof size === 'number' && size > 0) {
    return buffer.subarray(0, size);
  }
  return buffer;
});

const mockRandomUUID = jest.fn(() => 'uuid-1');

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: (size: number) => mockRandomBytes(size),
    randomUUID: () => mockRandomUUID(),
  };
});

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('../../config', () => ({
  __esModule: true,
  default: mockConfig,
}));

jest.mock('../../repositories/PostgresRepository', () => ({
  __esModule: true,
  default: mockRepository,
}));

jest.mock('../WebhookQueueService', () => ({
  __esModule: true,
  default: mockQueue,
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Import after mocks
// eslint-disable-next-line import/first
import webhookService from '../WebhookService';
// eslint-disable-next-line import/first
import { STATE_INDEX } from '../../utils/aircraftState';

describe('WebhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.webhooks.enabled = true;
    mockRandomBytes.mockReturnValue(Buffer.alloc(32, 1));
    mockRandomUUID.mockReturnValue('uuid-1');
    mockRedisInstance.publish.mockClear();
    mockRedisInstance.on.mockClear();
    mockRedisInstance.connect.mockClear();
  });

  describe('registerSubscription', () => {
    it('uses provided signing secret when supplied', async () => {
      const created = { id: 1, name: 'test', signing_secret: 'custom' };
      mockRepository.createWebhookSubscription.mockResolvedValue(created);

      const result = await webhookService.registerSubscription({
        name: 'dev listener',
        subscriberId: 'client-1',
        callbackUrl: 'https://example.com/webhook',
        eventTypes: ['aircraft.position.updated'],
        signingSecret: 'custom',
      });

      expect(mockRepository.createWebhookSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          signing_secret: 'custom',
          name: 'dev listener',
          subscriber_id: 'client-1',
          callback_url: 'https://example.com/webhook',
          event_types: ['aircraft.position.updated'],
        }),
      );
      expect(result).toBe(created);
    });

    it('generates a signing secret when none provided', async () => {
      const created = { id: 2, name: 'auto secret' };
      mockRepository.createWebhookSubscription.mockResolvedValue(created);

      const result = await webhookService.registerSubscription({
        name: 'auto secret',
        subscriberId: 'client-2',
        callbackUrl: 'https://example.com/webhook',
        eventTypes: ['*'],
      });

      expect(mockRandomBytes).toHaveBeenCalledWith(32);
      expect(mockRepository.createWebhookSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          signing_secret: expect.stringMatching(/^[0-9a-f]{64}$/i),
        }),
      );
      expect(result).toBe(created);
    });
  });

  describe('publishEvent', () => {
    it('returns early when webhooks disabled', async () => {
      mockConfig.webhooks.enabled = false;
      const result = await webhookService.publishEvent('test.event', { a: 1 });
      expect(result).toEqual({ eventId: 'webhooks-disabled', deliveriesEnqueued: 0 });
      expect(mockRepository.createWebhookEvent).not.toHaveBeenCalled();
    });

    it('creates event, deliveries, and enqueues messages', async () => {
      const eventDate = new Date();
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { foo: 'bar', metadata: { region: 'us' } },
        occurred_at: eventDate,
        version: 'v1',
        created_at: eventDate,
      });

      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([
        {
          id: 10, callback_url: 'https://a.com', signing_secret: 'secret-a', delivery_max_attempts: 4, delivery_backoff_ms: 2000,
        },
        {
          id: 11, callback_url: 'https://b.com', signing_secret: 'secret-b', delivery_max_attempts: 0, delivery_backoff_ms: 0,
        },
      ]);

      mockRepository.createWebhookDelivery.mockResolvedValue({ delivery_id: 'd-1' });
      mockQueue.enqueue.mockResolvedValue(undefined);

      const result = await webhookService.publishEvent(
        'aircraft.position.updated',
        { foo: 'bar' },
        { metadata: { region: 'us' }, version: 'v1' },
      );

      expect(mockRepository.createWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { foo: 'bar', metadata: { region: 'us' } },
        version: 'v1',
      }));

      expect(mockRepository.createWebhookDelivery).toHaveBeenCalledTimes(2);
      expect(mockRepository.createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
        subscription_id: 10,
        event_id: 'uuid-1',
      }));
      expect(mockRepository.createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
        subscription_id: 11,
        event_id: 'uuid-1',
      }));

      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      const enqueued = mockQueue.enqueue.mock.calls[0][0];
      expect(enqueued).toHaveLength(2);
      expect(enqueued[0]).toMatchObject({
        deliveryId: expect.any(String),
        subscriptionId: 10,
        callbackUrl: 'https://a.com',
        signingSecret: 'secret-a',
        event: expect.objectContaining({
          id: 'uuid-1',
          type: 'aircraft.position.updated',
          payload: { foo: 'bar', metadata: { region: 'us' } },
        }),
        maxAttempts: 4,
        backoffMs: 2000,
      });

      expect(result).toEqual({ eventId: 'uuid-1', deliveriesEnqueued: 2 });
    });

    it('skips enqueue when no active subscriptions', async () => {
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { foo: 'bar' },
        occurred_at: new Date(),
        version: 'v1',
        created_at: new Date(),
      });
      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([]);

      const result = await webhookService.publishEvent('aircraft.position.updated', { foo: 'bar' });

      expect(mockQueue.enqueue).not.toHaveBeenCalled();
      expect(result).toEqual({ eventId: 'uuid-1', deliveriesEnqueued: 0 });
    });

    it('publishes to Redis pub/sub for aircraft.position.updated events', async () => {
      const eventDate = new Date('2024-01-01T12:00:00Z');
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { icao24: 'abc123', position: { latitude: 40.0, longitude: -74.0 } },
        occurred_at: eventDate,
        version: 'v1',
        created_at: eventDate,
      });
      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([]);

      const result = await webhookService.publishEvent(
        'aircraft.position.updated',
        { icao24: 'abc123', position: { latitude: 40.0, longitude: -74.0 } },
      );

      // Should publish to Redis pub/sub even without webhook subscriptions
      expect(mockRedisInstance.publish).toHaveBeenCalledWith(
        'flyoverhead:events',
        expect.stringContaining('"eventType":"aircraft.position.updated"'),
      );

      const publishedMessage = JSON.parse(mockRedisInstance.publish.mock.calls[0][1] as string);
      expect(publishedMessage).toMatchObject({
        eventType: 'aircraft.position.updated',
        eventId: 'uuid-1',
        payload: { icao24: 'abc123', position: { latitude: 40.0, longitude: -74.0 } },
        version: 'v1',
      });
      // The occurredAt is set in publishEvent using new Date(), so we just verify it's a valid ISO string
      expect(publishedMessage.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      expect(result).toEqual({ eventId: 'uuid-1', deliveriesEnqueued: 0 });
    });

    it('does not publish to Redis pub/sub for non-aircraft events', async () => {
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'webhook.test',
        payload: { test: true },
        occurred_at: new Date(),
        version: 'v1',
        created_at: new Date(),
      });
      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([]);

      await webhookService.publishEvent('webhook.test', { test: true });

      // Should not publish to Redis pub/sub for non-aircraft events
      expect(mockRedisInstance.publish).not.toHaveBeenCalled();
    });

    it('handles Redis pub/sub publish errors gracefully', async () => {
      const eventDate = new Date();
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { icao24: 'abc123' },
        occurred_at: eventDate,
        version: 'v1',
        created_at: eventDate,
      });
      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([]);
      mockRedisInstance.publish.mockRejectedValue(new Error('Redis connection failed'));

      // Should not throw, should continue processing
      const result = await webhookService.publishEvent(
        'aircraft.position.updated',
        { icao24: 'abc123' },
      );

      expect(mockRedisInstance.publish).toHaveBeenCalled();
      expect(result).toEqual({ eventId: 'uuid-1', deliveriesEnqueued: 0 });
    });

    it('publishes to Redis pub/sub even when webhook subscriptions exist', async () => {
      const eventDate = new Date();
      mockRepository.createWebhookEvent.mockResolvedValue({
        event_id: 'uuid-1',
        event_type: 'aircraft.position.updated',
        payload: { icao24: 'abc123' },
        occurred_at: eventDate,
        version: 'v1',
        created_at: eventDate,
      });
      mockRepository.findActiveWebhookSubscriptions.mockResolvedValue([
        {
          id: 10, callback_url: 'https://a.com', signing_secret: 'secret', delivery_max_attempts: 3, delivery_backoff_ms: 1000,
        },
      ]);
      mockRepository.createWebhookDelivery.mockResolvedValue({ delivery_id: 'd-1' });
      mockQueue.enqueue.mockResolvedValue(undefined);

      const result = await webhookService.publishEvent(
        'aircraft.position.updated',
        { icao24: 'abc123' },
      );

      // Should publish to Redis pub/sub AND enqueue webhook deliveries
      expect(mockRedisInstance.publish).toHaveBeenCalled();
      expect(mockQueue.enqueue).toHaveBeenCalled();
      expect(result).toEqual({ eventId: 'uuid-1', deliveriesEnqueued: 1 });
    });
  });

  describe('publishAircraftPositionUpdate', () => {
    it('maps state array into payload and delegates to publishEvent', async () => {
      const publishSpy = jest.spyOn(webhookService, 'publishEvent').mockResolvedValue({
        eventId: 'uuid-2',
        deliveriesEnqueued: 1,
      });

      const state: any[] = [];
      state[STATE_INDEX.ICAO24] = 'abc123';
      state[STATE_INDEX.CALLSIGN] = 'TEST123';
      state[STATE_INDEX.ORIGIN_COUNTRY] = 'US';
      state[STATE_INDEX.LATITUDE] = 40.0;
      state[STATE_INDEX.LONGITUDE] = -70.0;
      state[STATE_INDEX.BARO_ALTITUDE] = 10000;
      state[STATE_INDEX.GEO_ALTITUDE] = 11000;
      state[STATE_INDEX.VELOCITY] = 250;
      state[STATE_INDEX.TRUE_TRACK] = 180;
      state[STATE_INDEX.VERTICAL_RATE] = 500;
      state[STATE_INDEX.ON_GROUND] = false;
      state[STATE_INDEX.SQUAWK] = '1234';
      state[STATE_INDEX.REGISTRATION] = 'N12345';
      state[STATE_INDEX.AIRCRAFT_TYPE] = 'A320';
      state[STATE_INDEX.AIRCRAFT_DESCRIPTION] = 'Airbus A320';
      state[STATE_INDEX.EMERGENCY_STATUS] = null;

      const ingestionTimestamp = new Date('2024-01-01T00:00:00Z');

      const result = await webhookService.publishAircraftPositionUpdate(
        state,
        'airplanes.live',
        ingestionTimestamp,
        20,
      );

      expect(publishSpy).toHaveBeenCalledWith(
        'aircraft.position.updated',
        expect.objectContaining({
          icao24: 'abc123',
          callsign: 'TEST123',
          position: {
            latitude: 40.0,
            longitude: -70.0,
            baro_altitude: 10000,
            geo_altitude: 11000,
          },
          source: 'airplanes.live',
          source_priority: 20,
          ingestion_timestamp: ingestionTimestamp.toISOString(),
        }),
        { version: 'v1' },
      );
      expect(result).toEqual({ eventId: 'uuid-2', deliveriesEnqueued: 1 });
      publishSpy.mockRestore();
    });
  });
});
jest.setTimeout(15000);
