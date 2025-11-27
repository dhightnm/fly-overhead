import crypto from 'crypto';
import type Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import type { WebhookQueueMessage } from '../services/WebhookQueueService';
import httpClient from '../utils/httpClient';
import redisClientManager from '../lib/redis/RedisClientManager';
import webhookRateLimitService from '../services/WebhookRateLimitService';

const {
  webhooks: {
    redisUrl,
    queueKey,
    delayedKey,
    dlqKey,
    batchSize,
    pollIntervalMs,
    maxAttempts,
    backoffMs,
    retryJitterMs,
    delayedPromotionBatchSize,
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

async function scheduleDelayed(message: WebhookQueueMessage, availableAt: number): Promise<void> {
  if (!redis) return;
  const payload = JSON.stringify({ ...message, availableAt });
  await redis.zadd(delayedKey, availableAt, payload);
}

function createRedisClient(): Redis {
  const client = redisClientManager.getClient('webhook:worker:dispatcher', redisUrl);
  logger.info('Webhook dispatcher connected to Redis', { redisUrl, queueKey });
  return client;
}

async function fetchMessage(timeoutSeconds = 5): Promise<WebhookQueueMessage | null> {
  if (!redis || !running) return null;
  const result = await redis.brpop(queueKey, timeoutSeconds);
  if (!result) {
    return null;
  }
  try {
    const message = JSON.parse(result[1]) as WebhookQueueMessage;
    if (message.availableAt && message.availableAt > Date.now()) {
      await scheduleDelayed(message, message.availableAt);
      return null;
    }
    return message;
  } catch (error) {
    logger.error('Failed to parse webhook queue message', { error: (error as Error).message });
    return null;
  }
}

async function enforceSubscriberControls(message: WebhookQueueMessage): Promise<boolean> {
  const breakerStatus = await webhookRateLimitService.getBreakerStatus(message.subscriptionId);
  if (breakerStatus.tripped && breakerStatus.retryAt) {
    await scheduleDelayed(message, breakerStatus.retryAt);
    logger.warn('Webhook subscriber circuit breaker active', {
      subscriptionId: message.subscriptionId,
      retryAt: breakerStatus.retryAt,
    });
    return false;
  }

  const rateLimitResult = await webhookRateLimitService.checkRateLimit(
    message.subscriptionId,
    message.rateLimitPerMinute,
  );

  if (!rateLimitResult.allowed && rateLimitResult.retryAt) {
    await scheduleDelayed(message, rateLimitResult.retryAt);
    logger.debug('Webhook subscriber rate limited', {
      subscriptionId: message.subscriptionId,
      retryAt: rateLimitResult.retryAt,
    });
    return false;
  }

  return true;
}

function computeSignature(secret: string, timestamp: string, body: any): string {
  const payload = `${timestamp}.${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

interface DispatchResult {
  success: boolean;
  reason?: string;
}

async function dispatchWebhook(message: WebhookQueueMessage): Promise<DispatchResult> {
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
    const nextStatus = (() => {
      if (success) {
        return 'success';
      }
      if (message.attempt + 1 >= message.maxAttempts) {
        return 'failed';
      }
      return 'pending';
    })();

    await postgresRepository.updateWebhookDelivery(message.deliveryId, {
      status: nextStatus,
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
      return { success: true };
    }

    logger.warn('Webhook delivery failed (non-2xx)', {
      deliveryId: message.deliveryId,
      subscriptionId: message.subscriptionId,
      status: response.status,
    });
    return {
      success: false,
      reason: `Non-2xx response (${response.status})`,
    };
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
    return {
      success: false,
      reason: (error as Error).message,
    };
  }
}

function calculateRetryDelay(message: WebhookQueueMessage, attemptNumber: number): number {
  const base = message.backoffMs || DEFAULT_BACKOFF_MS;
  const exponential = base * (2 ** Math.max(0, attemptNumber - 1));
  const jitter = retryJitterMs > 0 ? Math.floor(Math.random() * retryJitterMs) : 0;
  return exponential + jitter;
}

async function moveWebhookToDlq(message: WebhookQueueMessage, reason: string): Promise<void> {
  if (!redis) return;
  const payload = JSON.stringify({
    failedAt: new Date().toISOString(),
    reason,
    message,
  });
  await redis.lpush(dlqKey, payload);
  logger.error('Moved webhook delivery to DLQ', {
    deliveryId: message.deliveryId,
    subscriptionId: message.subscriptionId,
  });
}

async function requeueMessage(message: WebhookQueueMessage, reason: string): Promise<void> {
  if (!redis || !running) return;

  const nextAttempt = message.attempt + 1;
  if (nextAttempt >= (message.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
    await moveWebhookToDlq(message, reason);
    return;
  }

  const delayMs = calculateRetryDelay(message, nextAttempt);
  const availableAt = Date.now() + delayMs;
  const updatedMessage: WebhookQueueMessage = {
    ...message,
    attempt: nextAttempt,
  };
  await scheduleDelayed(updatedMessage, availableAt);
  logger.info('Scheduled webhook delivery retry', {
    deliveryId: message.deliveryId,
    subscriptionId: message.subscriptionId,
    attempt: nextAttempt,
    delayMs,
  });
}

async function processBatch(messages: WebhookQueueMessage[]): Promise<void> {
  if (!messages.length) return;

  const ops = messages.map(async (message) => {
    const ready = await enforceSubscriberControls(message);
    if (!ready) {
      return;
    }
    const result = await dispatchWebhook(message);
    if (!result.success) {
      await requeueMessage(message, result.reason || 'delivery_failed');
      const breaker = await webhookRateLimitService.recordFailure(message.subscriptionId);
      if (breaker.tripped && breaker.retryAt) {
        logger.warn('Webhook subscriber breaker engaged after failures', {
          subscriptionId: message.subscriptionId,
          retryAt: breaker.retryAt,
        });
      }
    } else {
      await webhookRateLimitService.recordSuccess(message.subscriptionId);
    }
  });

  await Promise.all(ops);
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
  logger.debug('Promoted delayed webhook deliveries', { count: due.length });
  return due.length;
}

async function processQueueIteration(): Promise<number> {
  const messages: WebhookQueueMessage[] = [];
  await promoteDelayedMessages(delayedPromotionBatchSize);
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
      await redisClientManager.disconnect('webhook:worker:dispatcher');
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
