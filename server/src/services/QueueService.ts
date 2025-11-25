import config from '../config';
import logger from '../utils/logger';
import redisClientManager from '../lib/redis/RedisClientManager';

export interface AircraftQueueMessage {
  state: any[];
  source: string;
  sourcePriority: number;
  ingestionTimestamp: string;
  retries?: number;
  availableAt?: number;
}

const { queue } = config;

export class QueueService {
  private enabled: boolean = queue.enabled;

  private queueKey = queue.key;

  private delayedKey = queue.delayedKey;

  private dlqKey = queue.dlqKey;

  private redisClientName = 'queue:producer';

  constructor(private readonly manager = redisClientManager) {
    if (!this.enabled) {
      logger.info('QueueService disabled via configuration');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getQueueKey(): string {
    return this.queueKey;
  }

  getHealth() {
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
    return this.manager.getClient(this.redisClientName, queue.redisUrl);
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
      logger.warn('Failed to retrieve queue metrics', { error: (error as Error).message });
      return { queueDepth: null, delayedDepth: null, dlqDepth: null };
    }
  }

  async enqueueAircraftStates(messages: AircraftQueueMessage[]): Promise<void> {
    if (!this.isEnabled() || messages.length === 0) {
      return;
    }

    const redis = this.getRedis();
    if (!redis) {
      return;
    }

    const payloads = messages.map((message) => JSON.stringify(message));

    try {
      await redis.lpush(this.queueKey, ...payloads);
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
