import config from '../config';
import logger from '../utils/logger';
import redisClientManager, { type ConnectionMeta } from '../lib/redis/RedisClientManager';

const { webhooks } = config;

export interface WebhookQueueMessage {
  deliveryId: string;
  subscriptionId: number;
  callbackUrl: string;
  signingSecret: string;
  event: {
    id: string;
    type: string;
    occurredAt: string;
    payload: Record<string, any>;
    version: string;
  };
  attempt: number;
  maxAttempts: number;
  backoffMs: number;
  availableAt?: number;
  rateLimitPerMinute?: number;
}

export class WebhookQueueService {
  private enabled: boolean = webhooks.enabled;

  private queueKey = webhooks.queueKey;

  private delayedKey = webhooks.delayedKey;

  private dlqKey = webhooks.dlqKey;

  private redisClientName = 'webhook:producer';

  constructor(private readonly manager = redisClientManager) {
    if (!this.enabled) {
      logger.info('WebhookQueueService disabled via configuration');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getQueueKey(): string {
    return this.queueKey;
  }

  getHealth(): ConnectionMeta | { status: 'disabled' } | { status: 'unknown' } {
    if (!this.enabled) {
      return { status: 'disabled' };
    }
    const health = this.manager.getHealth()[this.redisClientName];
    return health || { status: 'unknown' };
  }

  private getRedis() {
    if (!this.enabled) {
      return null;
    }
    return this.manager.getClient(this.redisClientName, webhooks.redisUrl);
  }

  async enqueue(messages: WebhookQueueMessage[]): Promise<void> {
    if (!this.isEnabled() || messages.length === 0) {
      return;
    }

    const redis = this.getRedis();
    if (!redis) {
      return;
    }

    try {
      const payloads = messages.map((message) => JSON.stringify(message));
      await redis.lpush(this.queueKey, ...payloads);
      logger.debug('Queued webhook deliveries', { count: messages.length });
    } catch (error) {
      logger.error('Failed to enqueue webhook deliveries', {
        error: (error as Error).message,
        count: messages.length,
      });
    }
  }

  async getStats(): Promise<{ queueDepth: number | null; delayedDepth: number | null; dlqDepth: number | null }> {
    if (!this.isEnabled()) {
      return { queueDepth: null, delayedDepth: null, dlqDepth: null };
    }

    const redis = this.getRedis();
    if (!redis) {
      return { queueDepth: null, delayedDepth: null, dlqDepth: null };
    }

    try {
      const pipeline = redis.pipeline();
      pipeline.llen(this.queueKey);
      pipeline.zcard(this.delayedKey);
      pipeline.llen(this.dlqKey);
      const results = await pipeline.exec();

      const parseResult = (entry: [Error | null, any] | null | undefined) => {
        if (!entry || entry[0]) {
          return null;
        }
        const value = Number(entry[1]);
        return Number.isNaN(value) ? null : value;
      };

      return {
        queueDepth: parseResult(results?.[0] as any),
        delayedDepth: parseResult(results?.[1] as any),
        dlqDepth: parseResult(results?.[2] as any),
      };
    } catch (error) {
      logger.warn('Failed to retrieve webhook queue metrics', { error: (error as Error).message });
      return { queueDepth: null, delayedDepth: null, dlqDepth: null };
    }
  }
}

const webhookQueueService = new WebhookQueueService();

export default webhookQueueService;
