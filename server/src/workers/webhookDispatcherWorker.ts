import Redis from 'ioredis';
import crypto from 'crypto';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import type { WebhookQueueMessage } from '../services/WebhookQueueService';
import httpClient from '../utils/httpClient';

const {
  webhooks: {
    redisUrl,
    queueKey,
    batchSize,
    pollIntervalMs,
    maxAttempts,
    backoffMs,
    deliveryTimeoutMs,
    signatureHeader,
    timestampHeader,
    enabled,
  },
} = config;

const DEFAULT_BACKOFF_MS = backoffMs;
const DEFAULT_MAX_ATTEMPTS = maxAttempts;

let redis: Redis | null = null;
let running = true;
let pollPromise: Promise<void> | null = null;

function createRedisClient(): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on('connect', () => {
    logger.info('Webhook dispatcher connected to Redis', { redisUrl, queueKey });
  });

  client.on('error', (error) => {
    logger.error('Webhook dispatcher Redis error', { error: error.message });
  });

  return client;
}

async function fetchMessage(timeoutSeconds = 5): Promise<WebhookQueueMessage | null> {
  if (!redis || !running) return null;
  const result = await redis.brpop(queueKey, timeoutSeconds);
  if (!result) {
    return null;
  }
  try {
    return JSON.parse(result[1]) as WebhookQueueMessage;
  } catch (error) {
    logger.error('Failed to parse webhook queue message', { error: (error as Error).message });
    return null;
  }
}

function computeSignature(secret: string, timestamp: string, body: any): string {
  const payload = `${timestamp}.${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function dispatchWebhook(message: WebhookQueueMessage): Promise<boolean> {
  const timestamp = Date.now().toString();
  const body = {
    id: message.event.id,
    type: message.event.type,
    occurred_at: message.event.occurredAt,
    version: message.event.version,
    data: message.event.payload,
  };

  const signature = computeSignature(message.signingSecret, timestamp, body);

  try {
    const response = await httpClient.post(message.callbackUrl, body, {
      timeout: deliveryTimeoutMs,
      headers: {
        'content-type': 'application/json',
        'x-flyover-event': message.event.type,
        'x-flyover-delivery': message.deliveryId,
        'x-flyover-event-id': message.event.id,
        [signatureHeader]: `v1=${signature}`,
        [timestampHeader]: timestamp,
      },
      validateStatus: () => true,
      retry: false,
    });

    const success = response.status >= 200 && response.status < 300;
    await postgresRepository.updateWebhookDelivery(message.deliveryId, {
      status: success ? 'success' : (message.attempt + 1 >= message.maxAttempts ? 'failed' : 'pending'),
      attempt_count: message.attempt + 1,
      response_status: response.status,
      response_body: typeof response.data === 'string' ? response.data.slice(0, 500) : JSON.stringify(response.data).slice(0, 500),
      last_attempt_at: new Date(),
      next_attempt_at: success ? null : new Date(Date.now() + message.backoffMs),
      last_error: success ? null : `Non-2xx response (${response.status})`,
    });

    if (success) {
      await postgresRepository.markWebhookSubscriptionSuccess(message.subscriptionId);
      logger.debug('Webhook delivery succeeded', {
        deliveryId: message.deliveryId,
        subscriptionId: message.subscriptionId,
        status: response.status,
      });
      return true;
    }

    logger.warn('Webhook delivery failed (non-2xx)', {
      deliveryId: message.deliveryId,
      subscriptionId: message.subscriptionId,
      status: response.status,
    });
    return false;
  } catch (error) {
    const err = error as Error;
    await postgresRepository.updateWebhookDelivery(message.deliveryId, {
      status: message.attempt + 1 >= message.maxAttempts ? 'failed' : 'pending',
      attempt_count: message.attempt + 1,
      last_error: err.message,
      last_attempt_at: new Date(),
      next_attempt_at: new Date(Date.now() + message.backoffMs),
    });

    logger.warn('Webhook delivery error', {
      deliveryId: message.deliveryId,
      subscriptionId: message.subscriptionId,
      error: err.message,
    });
    return false;
  }
}

async function requeueMessage(message: WebhookQueueMessage): Promise<void> {
  if (!redis || !running) return;

  const nextAttempt = message.attempt + 1;
  if (nextAttempt >= (message.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
    logger.error('Dropping webhook delivery after max attempts', {
      deliveryId: message.deliveryId,
      subscriptionId: message.subscriptionId,
      attempts: nextAttempt,
    });
    return;
  }

  const delayMs = (message.backoffMs || DEFAULT_BACKOFF_MS) * 2 ** message.attempt;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

  const nextMessage: WebhookQueueMessage = {
    ...message,
    attempt: nextAttempt,
  };

  await redis.rpush(queueKey, JSON.stringify(nextMessage));
  logger.info('Re-queued webhook delivery', {
    deliveryId: message.deliveryId,
    subscriptionId: message.subscriptionId,
    attempt: nextAttempt,
    delayMs,
  });
}

async function processBatch(messages: WebhookQueueMessage[]): Promise<void> {
  if (!messages.length) return;

  const ops = messages.map(async (message) => {
    const succeeded = await dispatchWebhook(message);
    if (!succeeded) {
      await requeueMessage(message);
    }
  });

  await Promise.all(ops);
}

async function processQueueIteration(): Promise<number> {
  const messages: WebhookQueueMessage[] = [];
  while (messages.length < batchSize) {
    const message = await fetchMessage(messages.length > 0 ? 1 : 5);
    if (!message) break;
    messages.push({
      ...message,
      backoffMs: message.backoffMs || DEFAULT_BACKOFF_MS,
      maxAttempts: message.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    });
  }

  await processBatch(messages);
  return messages.length;
}

async function pollQueue(): Promise<void> {
  while (running) {
    const processed = await processQueueIteration();
    if (processed === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }
  }
}

export function initializeWebhookDispatcher(): void {
  if (!enabled) {
    logger.warn('Webhook dispatcher not started because webhooks are disabled');
    return;
  }
  redis = createRedisClient();
}

export async function stopWebhookDispatcher(): Promise<void> {
  running = false;
  if (redis) {
    try {
      await redis.quit();
    } catch (error) {
      logger.warn('Error closing Redis connection in webhook dispatcher', { error: (error as Error).message });
    }
    redis = null;
  }
  if (pollPromise) {
    await pollPromise;
  }
}

export default async function startWebhookDispatcher(): Promise<void> {
  running = true;
  initializeWebhookDispatcher();

  if (!redis) return;

  logger.info('Starting webhook dispatcher worker', {
    queueKey,
    redisUrl,
    batchSize,
    pollIntervalMs,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  });

  pollPromise = pollQueue();
  await pollPromise;
}

if (require.main === module) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down webhook dispatcher`);
    await stopWebhookDispatcher();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  startWebhookDispatcher().catch((error) => {
    logger.error('Fatal error in webhook dispatcher', { error: (error as Error).message });
    process.exit(1);
  });
}
