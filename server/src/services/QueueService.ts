import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

export interface AircraftQueueMessage {
  state: any[];
  source: string;
  sourcePriority: number;
  ingestionTimestamp: string;
  retries?: number;
}

const { queue } = config;

class QueueService {
  private redis: Redis | null = null;

  private enabled: boolean = queue.enabled;

  private queueKey = queue.key;

  constructor() {
    if (!this.enabled) {
      logger.info('QueueService disabled via configuration');
      return;
    }

    this.redis = new Redis(queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.redis.on('connect', () => {
      logger.info('QueueService connected to Redis', { url: queue.redisUrl, key: this.queueKey });
    });

    this.redis.on('error', (error) => {
      logger.error('QueueService Redis error', { error: error.message });
    });

    this.redis.connect().catch((error) => {
      logger.error('QueueService failed to connect to Redis', { error: error.message });
      this.enabled = false;
    });
  }

  isEnabled(): boolean {
    return this.enabled && !!this.redis;
  }

  getQueueKey(): string {
    return this.queueKey;
  }

  async enqueueAircraftStates(messages: AircraftQueueMessage[]): Promise<void> {
    if (!this.isEnabled() || !this.redis || messages.length === 0) {
      return;
    }

    const payloads = messages.map((message) => JSON.stringify(message));

    try {
      await this.redis.lpush(this.queueKey, ...payloads);
      logger.debug('Queued aircraft states for ingestion', { count: messages.length });
    } catch (error) {
      logger.error('Failed to enqueue aircraft states', {
        error: (error as Error).message,
        count: messages.length,
      });
    }
  }
}

const queueService = new QueueService();

export default queueService;
