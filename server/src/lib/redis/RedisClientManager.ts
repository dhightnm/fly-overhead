import fs from 'fs';
import Redis, { RedisOptions } from 'ioredis';
import logger from '../../utils/logger';

export interface ConnectionMeta {
  status: 'connecting' | 'ready' | 'reconnecting' | 'error' | 'closed';
  lastError?: string;
  createdAt: Date;
}

interface ManagedConnection {
  client: Redis;
  meta: ConnectionMeta;
}

const DEFAULT_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
};

const readFile = (filePath?: string): string | undefined => {
  if (!filePath) {
    return undefined;
  }
  if (!fs.existsSync(filePath)) {
    logger.warn('Configured Redis TLS file not found', { filePath });
    return undefined;
  }
  return fs.readFileSync(filePath, 'utf8');
};

export class RedisClientManager {
  private connections = new Map<string, ManagedConnection>();

  getClient(name: string, url: string, overrides: RedisOptions = {}): Redis {
    const existing = this.connections.get(name);
    if (existing) {
      return existing.client;
    }

    const options: RedisOptions = { ...DEFAULT_OPTIONS, ...overrides };

    try {
      const parsedUrl = new URL(url);
      const isTls = parsedUrl.protocol === 'rediss:';
      if (isTls) {
        const explicitRejectUnauthorized = process.env.REDIS_REJECT_UNAUTHORIZED;
        let rejectUnauthorized = false;
        if (explicitRejectUnauthorized !== undefined) {
          rejectUnauthorized = explicitRejectUnauthorized === 'true';
        }

        const ca = process.env.REDIS_TLS_CA || readFile(process.env.REDIS_TLS_CA_PATH);
        const cert = process.env.REDIS_TLS_CERT || readFile(process.env.REDIS_TLS_CERT_PATH);
        const key = process.env.REDIS_TLS_KEY || readFile(process.env.REDIS_TLS_KEY_PATH);

        options.tls = {
          rejectUnauthorized,
          ...options.tls,
        };

        if (ca) {
          options.tls = { ...options.tls, ca };
        }
        if (cert) {
          options.tls = { ...options.tls, cert };
        }
        if (key) {
          options.tls = { ...options.tls, key };
        }
      }
    } catch (error) {
      logger.warn('Failed to parse Redis URL for TLS configuration', { name, error: (error as Error).message });
    }

    const client = new Redis(url, options);
    const meta: ConnectionMeta = {
      status: 'connecting',
      createdAt: new Date(),
    };
    this.connections.set(name, { client, meta });

    client.on('ready', () => {
      meta.status = 'ready';
      meta.lastError = undefined;
      logger.info('Redis client ready', { name, url });
    });

    client.on('error', (error) => {
      meta.status = 'error';
      meta.lastError = error.message;
      logger.error('Redis client error', { name, error: error.message });
    });

    client.on('reconnecting', () => {
      meta.status = 'reconnecting';
      logger.warn('Redis client reconnecting', { name });
    });

    client.on('close', () => {
      meta.status = 'closed';
      logger.warn('Redis client connection closed', { name });
    });

    client.connect().catch((error) => {
      meta.status = 'error';
      meta.lastError = error.message;
      logger.error('Redis client failed to connect', { name, error: error.message });
    });

    return client;
  }

  getHealth(): Record<string, ConnectionMeta> {
    const result: Record<string, ConnectionMeta> = {};
    for (const [name, connection] of this.connections.entries()) {
      result[name] = { ...connection.meta };
    }
    return result;
  }

  async disconnect(name?: string): Promise<void> {
    if (name) {
      const managed = this.connections.get(name);
      if (managed) {
        await managed.client.quit();
        this.connections.delete(name);
      }
      return;
    }

    const entries = Array.from(this.connections.values());
    await Promise.all(entries.map(async ({ client }) => client.quit()));
    this.connections.clear();
  }
}

const redisClientManager = new RedisClientManager();

export default redisClientManager;
