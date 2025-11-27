import type postgresRepository from '../../repositories/PostgresRepository';
import type liveStateStore from '../../services/LiveStateStore';
import type { AircraftQueueMessage } from '../../services/QueueService';
import type redisClientManager from '../../lib/redis/RedisClientManager';

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    database: {
      postgres: {
        url: 'postgresql://test:test@localhost:5432/test',
        rejectUnauthorized: false,
        pool: {
          min: 0,
          max: 1,
        },
      },
    },
    queue: {
      enabled: true,
      redisUrl: 'redis://localhost:6379',
      key: 'flyoverhead:aircraft_ingest',
      dlqKey: 'flyoverhead:aircraft_ingest:dlq',
      delayedKey: 'flyoverhead:aircraft_ingest:delayed',
      batchSize: 5,
      pollIntervalMs: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      retryJitterMs: 0,
      delayedPromotionBatchSize: 10,
      worker: {
        enabled: true,
      },
    },
    redis: {
      rejectUnauthorized: false,
    },
  },
}));

jest.mock('../../lib/redis/RedisClientManager', () => ({
  __esModule: true,
  default: {
    getClient: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getHealth: jest.fn(),
  },
}));

// Mock dependencies
jest.mock('pg-promise', () => {
  const mockDb = {
    connect: jest.fn().mockResolvedValue({
      done: jest.fn(),
    }),
    query: jest.fn(),
    one: jest.fn(),
    any: jest.fn(),
    none: jest.fn(),
  };
  const pgPromise = jest.fn(() => jest.fn(() => mockDb));
  return pgPromise;
});
jest.mock('../../repositories/PostgresRepository', () => ({
  __esModule: true,
  default: {
    upsertAircraftStateWithPriority: jest.fn(),
  },
}));
jest.mock('../../services/LiveStateStore', () => ({
  __esModule: true,
  default: {
    upsertState: jest.fn(),
  },
}));

// Mock WebhookQueueService and WebhookService to prevent Redis instantiation during import
jest.mock('../../services/WebhookQueueService', () => ({
  __esModule: true,
  default: {
    isEnabled: jest.fn().mockReturnValue(true),
    getQueueKey: jest.fn().mockReturnValue('flyoverhead:webhooks'),
    enqueue: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/WebhookService', () => ({
  __esModule: true,
  default: {
    publishAircraftPositionUpdate: jest.fn().mockResolvedValue({
      eventId: 'test-event',
      deliveriesEnqueued: 0,
    }),
  },
}));

jest.mock('../../services/RedisAircraftCache', () => ({
  __esModule: true,
  default: {
    cacheStateArray: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock config needs to be handled carefully since it's imported by the worker
// We'll use doMock in tests to change values if needed

let mockedPostgresRepository: jest.Mocked<typeof postgresRepository>;
let mockedLiveStateStore: jest.Mocked<typeof liveStateStore>;
let mockedRedisAircraftCache: { cacheStateArray: jest.MockedFunction<any> };
let redisManager: jest.Mocked<typeof redisClientManager>;
let initializeWorker: typeof import('../aircraftIngestionWorker').initializeWorker;
let processQueueIteration: typeof import('../aircraftIngestionWorker').processQueueIteration;
let setRedisClient: typeof import('../aircraftIngestionWorker').__setRedisClient;

describe('aircraftIngestionWorker', () => {
  let mockRedisInstance: any;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useRealTimers();

    // Create a mock Redis instance with all methods needed
    mockRedisInstance = {
      brpop: jest.fn().mockResolvedValue(null),
      rpush: jest.fn().mockResolvedValue(1),
      lpush: jest.fn().mockResolvedValue(1),
      zadd: jest.fn().mockResolvedValue(1),
      zrangebyscore: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue({
        lpush: jest.fn().mockReturnThis(),
        zrem: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(1),
    };

    const workerModule = await import('../aircraftIngestionWorker');
    initializeWorker = workerModule.initializeWorker;
    processQueueIteration = workerModule.processQueueIteration;
    setRedisClient = workerModule.__setRedisClient;

    // Re-acquire mocks after module reset so the worker uses the same instances we assert against
    redisManager = jest.requireMock('../../lib/redis/RedisClientManager')
      .default as jest.Mocked<typeof redisClientManager>;
    mockedPostgresRepository = jest.requireMock('../../repositories/PostgresRepository')
      .default as jest.Mocked<typeof postgresRepository>;
    mockedLiveStateStore = jest.requireMock('../../services/LiveStateStore')
      .default as jest.Mocked<typeof liveStateStore>;
    mockedRedisAircraftCache = jest.requireMock('../../services/RedisAircraftCache')
      .default as { cacheStateArray: jest.MockedFunction<any> };

    redisManager.getClient.mockReturnValue(mockRedisInstance);
    mockedPostgresRepository.upsertAircraftStateWithPriority.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('processQueueIteration', () => {
    beforeEach(() => {
      initializeWorker();
      setRedisClient(mockRedisInstance as any);
    });

    it('should fetch and process a single message', async () => {
      const message: AircraftQueueMessage = {
        state: ['a1b2c3', 'AAL123'],
        source: 'airplanes.live',
        sourcePriority: 20,
        ingestionTimestamp: new Date().toISOString(),
      };

      // Mock brpop to return one message then null (to stop batching)
      mockRedisInstance.brpop
        .mockResolvedValueOnce(['flyoverhead:aircraft_ingest', JSON.stringify(message)])
        .mockResolvedValueOnce(null);

      const count = await processQueueIteration();

      expect(count).toBe(1);
      expect(mockRedisInstance.brpop).toHaveBeenCalled();
      expect(mockedPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledWith(
        message.state,
        null,
        expect.any(Date),
        message.source,
        message.sourcePriority,
        false,
      );
      expect(mockedLiveStateStore.upsertState).toHaveBeenCalledWith(message.state);
      expect(mockedRedisAircraftCache.cacheStateArray).toHaveBeenCalledWith(
        message.state,
        expect.objectContaining({
          data_source: message.source,
          source_priority: message.sourcePriority,
        }),
      );
    });

    it('should process a full batch of messages', async () => {
      const messages = [
        {
          state: ['1'], source: 'test', sourcePriority: 1, ingestionTimestamp: new Date().toISOString(),
        },
        {
          state: ['2'], source: 'test', sourcePriority: 1, ingestionTimestamp: new Date().toISOString(),
        },
        {
          state: ['3'], source: 'test', sourcePriority: 1, ingestionTimestamp: new Date().toISOString(),
        },
        {
          state: ['4'], source: 'test', sourcePriority: 1, ingestionTimestamp: new Date().toISOString(),
        },
        {
          state: ['5'], source: 'test', sourcePriority: 1, ingestionTimestamp: new Date().toISOString(),
        },
      ];

      // Mock brpop to return messages
      messages.forEach((msg) => {
        mockRedisInstance.brpop.mockResolvedValueOnce(['flyoverhead:aircraft_ingest', JSON.stringify(msg)]);
      });
      // Sixth call returns null (though loop should stop at batchSize=5)
      mockRedisInstance.brpop.mockResolvedValueOnce(null);

      const count = await processQueueIteration();

      expect(count).toBe(5);
      expect(mockedPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(5);
      expect(mockedRedisAircraftCache.cacheStateArray).toHaveBeenCalledTimes(5);
    });

    it('should handle invalid JSON messages gracefully', async () => {
      mockRedisInstance.brpop
        .mockResolvedValueOnce(['flyoverhead:aircraft_ingest', 'invalid-json'])
        .mockResolvedValueOnce(null);

      const count = await processQueueIteration();

      expect(count).toBe(0); // One message fetched but invalid, so 0 processed
      expect(mockedPostgresRepository.upsertAircraftStateWithPriority).not.toHaveBeenCalled();
    });

    it('should requeue message on database error', async () => {
      const message: AircraftQueueMessage = {
        state: ['err1'],
        source: 'test',
        sourcePriority: 1,
        ingestionTimestamp: new Date().toISOString(),
        retries: 0,
      };

      mockRedisInstance.brpop
        .mockResolvedValueOnce(['flyoverhead:aircraft_ingest', JSON.stringify(message)])
        .mockResolvedValueOnce(null);

      mockedPostgresRepository.upsertAircraftStateWithPriority.mockRejectedValueOnce(new Error('DB Error'));

      const count = await processQueueIteration();

      expect(count).toBe(1); // Processed (attempted) 1 message
      expect(mockRedisInstance.zadd).toHaveBeenCalledWith(
        'flyoverhead:aircraft_ingest:delayed',
        expect.any(Number),
        expect.stringContaining('"retries":1'),
      );
    });

    it('should drop message after max retries', async () => {
      const message: AircraftQueueMessage = {
        state: ['errMax'],
        source: 'test',
        sourcePriority: 1,
        ingestionTimestamp: new Date().toISOString(),
        retries: 5,
      };

      mockRedisInstance.brpop
        .mockResolvedValueOnce(['flyoverhead:aircraft_ingest', JSON.stringify(message)])
        .mockResolvedValueOnce(null);

      mockedPostgresRepository.upsertAircraftStateWithPriority.mockRejectedValueOnce(new Error('DB Error'));

      await processQueueIteration();

      expect(mockRedisInstance.lpush).toHaveBeenCalledWith(
        'flyoverhead:aircraft_ingest:dlq',
        expect.any(String),
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisInstance.brpop.mockRejectedValueOnce(new Error('Redis Error'));

      // Should catch error and return 0
      const count = await processQueueIteration();

      expect(count).toBe(0);
    });
  });
});
