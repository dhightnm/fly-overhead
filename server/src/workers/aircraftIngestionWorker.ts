import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import type { AircraftQueueMessage } from '../services/QueueService';
import liveStateStore from '../services/LiveStateStore';
import webhookService from '../services/WebhookService';

const {
  queue: {
    redisUrl, key: queueKey, batchSize, pollIntervalMs,
  },
} = config;

const MAX_RETRIES = 3;

export function createRedisClient(): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on('connect', () => {
    logger.info('Ingestion worker connected to Redis', { redisUrl, queueKey });
  });

  client.on('error', (error) => {
    logger.error('Ingestion worker Redis error', { error: error.message });
  });

  return client;
}

// Keep mutable for runtime assignment
// eslint-disable-next-line prefer-const
let redis: Redis;

type QueueResult = null | AircraftQueueMessage;

export async function fetchMessage(timeoutSeconds = 5): Promise<QueueResult> {
  const result = await redis.brpop(queueKey, timeoutSeconds);
  if (!result) {
    return null;
  }
  try {
    return JSON.parse(result[1]) as AircraftQueueMessage;
  } catch (error) {
    logger.error('Failed to parse queue message', { error: (error as Error).message });
    return null;
  }
}

export async function requeueMessage(message: AircraftQueueMessage): Promise<void> {
  const retries = (message.retries || 0) + 1;
  if (retries > MAX_RETRIES) {
    logger.error('Dropping aircraft message after max retries', { icao24: message.state?.[0], retries });
    return;
  }

  await redis.rpush(queueKey, JSON.stringify({ ...message, retries }));
  logger.warn('Re-queued aircraft message for retry', { icao24: message.state?.[0], retries });
}

export async function processBatch(messages: AircraftQueueMessage[]): Promise<void> {
  if (!messages.length) {
    return;
  }

  const ops = messages.map(async (message) => {
    try {
      const ingestionTimestamp = message.ingestionTimestamp
        ? new Date(message.ingestionTimestamp)
        : new Date();

      await postgresRepository.upsertAircraftStateWithPriority(
        message.state,
        null,
        ingestionTimestamp,
        message.source,
        message.sourcePriority,
        false,
      );
      liveStateStore.upsertState(message.state);
      webhookService.publishAircraftPositionUpdate(
        message.state,
        message.source,
        ingestionTimestamp,
        message.sourcePriority,
      ).catch((error: Error) => {
        logger.warn('Failed to publish webhook for aircraft state', {
          icao24: message.state?.[0],
          error: error.message,
        });
      });
    } catch (error) {
      logger.error('Failed to ingest aircraft state', {
        error: (error as Error).message,
        icao24: message.state?.[0],
      });
      await requeueMessage(message);
    }
  });

  await Promise.all(ops);
  logger.debug('Ingested aircraft batch', { count: messages.length });
}

/**
 * Processes one iteration of the queue loop.
 * Fetches a batch of messages and processes them.
 * Returns the number of messages processed.
 */
export async function processQueueIteration(): Promise<number> {
  const messages: AircraftQueueMessage[] = [];
  try {
    // Fetch up to batchSize messages
    while (messages.length < batchSize) {
      // Use a shorter timeout for subsequent messages in the batch to keep things moving
      // First message waits normally (5s default in fetchMessage)
      // Subsequent messages wait less since we already have one
      const timeout = messages.length > 0 ? 1 : 5;
      const message = await fetchMessage(timeout);

      if (!message) {
        break;
      }
      messages.push(message);
    }

    await processBatch(messages);
    return messages.length;
  } catch (error) {
    logger.error('Error in ingestion worker loop', { error: (error as Error).message });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
    return 0;
  }
}

async function pollQueue(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await processQueueIteration();
  }
}

export function initializeWorker(): void {
  if (!config.queue.enabled) {
    logger.warn('Queue ingestion worker not started because queue is disabled');
    return;
  }
  redis = createRedisClient();
}

export default async function startAircraftIngestionWorker(): Promise<void> {
  initializeWorker();

  if (!redis) return;

  logger.info('Starting aircraft ingestion worker', {
    queueKey,
    redisUrl,
    batchSize,
    pollIntervalMs,
  });

  await pollQueue();
}

if (require.main === module) {
  startAircraftIngestionWorker().catch((error) => {
    logger.error('Fatal error in ingestion worker', { error: error.message });
    process.exit(1);
  });
}
