import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

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
}

class WebhookQueueService {
  private redis: Redis | null = null;

  private enabled: boolean = webhooks.enabled;

  private queueKey = webhooks.queueKey;

  constructor() {
    if (!this.enabled) {
      logger.info('WebhookQueueService disabled via configuration');
      return;
    }

    this.redis = new Redis(webhooks.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.redis.on('connect', () => {
      logger.info('WebhookQueueService connected to Redis', { url: webhooks.redisUrl, key: this.queueKey });
    });

    this.redis.on('error', (error) => {
      logger.error('WebhookQueueService Redis error', { error: error.message });
    });

    this.redis.connect().catch((error) => {
      logger.error('WebhookQueueService failed to connect to Redis', { error: error.message });
      this.enabled = false;
    });
  }

  isEnabled(): boolean {
    return this.enabled && !!this.redis;
  }

  getQueueKey(): string {
    return this.queueKey;
  }

  async enqueue(messages: WebhookQueueMessage[]): Promise<void> {
    if (!this.isEnabled() || !this.redis || messages.length === 0) {
      return;
    }

    try {
      const payloads = messages.map((message) => JSON.stringify(message));
      await this.redis.lpush(this.queueKey, ...payloads);
      logger.debug('Queued webhook deliveries', { count: messages.length });
    } catch (error) {
      logger.error('Failed to enqueue webhook deliveries', {
        error: (error as Error).message,
        count: messages.length,
      });
    }
  }
}

const webhookQueueService = new WebhookQueueService();

export default webhookQueueService;
