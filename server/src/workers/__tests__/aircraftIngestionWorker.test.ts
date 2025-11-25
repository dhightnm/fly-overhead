import postgresRepository from '../../repositories/PostgresRepository';
import liveStateStore from '../../services/LiveStateStore';
import type { AircraftQueueMessage } from '../../services/QueueService';
import {
  initializeWorker,
  processQueueIteration,
} from '../aircraftIngestionWorker';
import redisClientManager from '../../lib/redis/RedisClientManager';

jest.mock('../../lib/redis/RedisClientManager', () => {
  const getClient = jest.fn();
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const getHealth = jest.fn();
  return {
    __esModule: true,
    default: {
      getClient,
      disconnect,
      getHealth,
    },
  };
});

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
jest.mock('../../repositories/PostgresRepository');
jest.mock('../../services/LiveStateStore', () => ({
  upsertState: jest.fn(),
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

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock config needs to be handled carefully since it's imported by the worker
// We'll use doMock in tests to change values if needed

const mockedPostgresRepository = postgresRepository as jest.Mocked<typeof postgresRepository>;
const mockedLiveStateStore = liveStateStore as jest.Mocked<typeof liveStateStore>;
const mockedRedisManager = redisClientManager as unknown as {
  getClient: jest.MockedFunction<(name: string, url: string) => any>;
  disconnect: jest.MockedFunction<(name?: string) => Promise<void>>;
};

describe('aircraftIngestionWorker', () => {
  let mockRedisInstance: any;

  beforeEach(() => {
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

    mockedRedisManager.getClient.mockReturnValue(mockRedisInstance);

    // Mock postgres repository
    mockedPostgresRepository.upsertAircraftStateWithPriority = jest.fn().mockResolvedValue(undefined);
    mockedLiveStateStore.upsertState = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.resetModules();
  });

  describe('initialization', () => {
    it('should create Redis client when enabled', async () => {
      // Since the module is already loaded, we might need to reload it or trust the mock config
      // For this test, we'll just call initializeWorker which uses the config

      // Re-import to ensure clean state
      jest.isolateModules(() => {
        const { initializeWorker: initWorker } = require('../aircraftIngestionWorker');
        initWorker();
        expect(mockedRedisManager.getClient).toHaveBeenCalledWith('queue:worker:ingestion', expect.any(String));
      });
    });
  });

  describe('processQueueIteration', () => {
    beforeEach(() => {
      // Ensure worker is initialized with mock redis
      initializeWorker();

      // We need to make sure the exported redis variable in the worker is set to our mock
      // Since we mocked the Redis constructor, calling initializeWorker() sets it up
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
