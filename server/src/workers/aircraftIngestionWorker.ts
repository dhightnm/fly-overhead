import type Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import type { AircraftQueueMessage } from '../services/QueueService';
import liveStateStore from '../services/LiveStateStore';
import webhookService from '../services/WebhookService';
import redisClientManager from '../lib/redis/RedisClientManager';
import redisAircraftCache from '../services/RedisAircraftCache';

const {
  queue: {
    redisUrl,
    key: queueKey,
    dlqKey,
    delayedKey,
    batchSize,
    pollIntervalMs,
    maxAttempts,
    retryBackoffMs,
    retryJitterMs,
    delayedPromotionBatchSize,
  },
} = config;

let running = true;
let pollPromise: Promise<void> | null = null;

export function createRedisClient(): Redis {
  const client = redisClientManager.getClient('queue:worker:ingestion', redisUrl);
  logger.info('Ingestion worker connected to Redis', { redisUrl, queueKey });
  return client;
}

// Keep mutable for runtime assignment
let redis: ReturnType<typeof createRedisClient> | null = null;

type QueueResult = null | AircraftQueueMessage;

async function scheduleDelayed(
  message: AircraftQueueMessage,
  availableAt: number,
): Promise<void> {
  if (!redis) return;
  const payload = JSON.stringify({ ...message, availableAt });
  await redis.zadd(delayedKey, availableAt, payload);
}

export async function fetchMessage(timeoutSeconds = 5): Promise<QueueResult> {
  if (!redis || !running) return null;
  const result = await redis.brpop(queueKey, timeoutSeconds);
  if (!result) {
    return null;
  }
  try {
    const message = JSON.parse(result[1]) as AircraftQueueMessage;
    if (message.availableAt && message.availableAt > Date.now()) {
      await scheduleDelayed(message, message.availableAt);
      return null;
    }
    return message;
  } catch (error) {
    logger.error('Failed to parse queue message', { error: (error as Error).message });
    return null;
  }
}

function calculateRetryDelay(attempt: number): number {
  const exponential = retryBackoffMs * (2 ** (attempt - 1));
  const jitter = retryJitterMs > 0
    ? Math.floor(Math.random() * retryJitterMs)
    : 0;
  return exponential + jitter;
}

async function moveToDlq(message: AircraftQueueMessage, error?: Error): Promise<void> {
  if (!redis) return;
  const payload = JSON.stringify({
    failedAt: new Date().toISOString(),
    error: error?.message,
    message,
  });
  await redis.lpush(dlqKey, payload);
  logger.error('Moved aircraft message to DLQ after max retries', {
    icao24: message.state?.[0],
    dlqKey,
  });
}

export async function requeueMessage(message: AircraftQueueMessage, error?: Error): Promise<void> {
  if (!redis) return;
  const retries = (message.retries || 0) + 1;
  if (retries > maxAttempts) {
    await moveToDlq(message, error);
    return;
  }

  const delay = calculateRetryDelay(retries);
  const availableAt = Date.now() + delay;
  await scheduleDelayed({ ...message, retries }, availableAt);
  logger.warn('Scheduled aircraft message retry', {
    icao24: message.state?.[0],
    retries,
    delayMs: delay,
  });
}

async function promoteDelayedMessages(limit: number): Promise<number> {
  if (!redis) return 0;
  const now = Date.now();
  const due = await redis.zrangebyscore(delayedKey, 0, now, 'LIMIT', 0, limit);
  if (!due.length) {
    return 0;
  }

  const pipeline = redis.pipeline();
  due.forEach((payload) => {
    pipeline.lpush(queueKey, payload);
    pipeline.zrem(delayedKey, payload);
  });
  await pipeline.exec();
  logger.debug('Promoted delayed aircraft messages', { count: due.length });
  return due.length;
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
      redisAircraftCache.cacheStateArray(message.state, {
        data_source: message.source,
        source_priority: message.sourcePriority,
        ingestion_timestamp: ingestionTimestamp.toISOString(),
      }).catch((error: Error) => {
        logger.debug('Failed to cache aircraft state', { error: error.message });
      });
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
      await requeueMessage(message, error as Error);
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
    await promoteDelayedMessages(delayedPromotionBatchSize);
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
  while (running) {
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

export async function stopAircraftIngestionWorker(): Promise<void> {
  running = false;
  if (redis) {
    try {
      await redisClientManager.disconnect('queue:worker:ingestion');
    } catch (error) {
      logger.warn('Error closing Redis connection in ingestion worker', { error: (error as Error).message });
    }
    redis = null;
  }
  if (pollPromise) {
    await pollPromise;
  }
}

export default async function startAircraftIngestionWorker(): Promise<void> {
  running = true;
  initializeWorker();

  if (!redis) return;

  logger.info('Starting aircraft ingestion worker', {
    queueKey,
    redisUrl,
    batchSize,
    pollIntervalMs,
  });

  pollPromise = pollQueue();
  await pollPromise;
}

if (require.main === module) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down ingestion worker`);
    await stopAircraftIngestionWorker();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  startAircraftIngestionWorker().catch((error) => {
    logger.error('Fatal error in ingestion worker', { error: error.message });
    process.exit(1);
  });
}
