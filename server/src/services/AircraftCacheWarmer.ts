import config from '../config';
import postgresRepository from '../repositories/PostgresRepository';
import redisAircraftCache from './RedisAircraftCache';
import logger from '../utils/logger';

interface CacheWarmerOptions {
  lookbackMinutes?: number;
  batchSize?: number;
}

export interface CacheWarmerStatus {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastRowCount: number;
  intervalSeconds: number;
  lookbackMinutes: number;
  batchSize: number;
}

class AircraftCacheWarmer {
  private running = false;

  private interval: NodeJS.Timeout | null = null;

  private status: CacheWarmerStatus = {
    enabled: config.cache.aircraft.warmerEnabled,
    running: false,
    lastRunAt: null,
    lastDurationMs: null,
    lastRowCount: 0,
    intervalSeconds: config.cache.aircraft.warmIntervalSeconds,
    lookbackMinutes: config.cache.aircraft.warmLookbackMinutes,
    batchSize: config.cache.aircraft.warmBatchSize,
  };

  async warmCache(options: CacheWarmerOptions = {}): Promise<void> {
    if (!redisAircraftCache.isEnabled() || this.running) return;
    this.running = true;
    this.status.running = true;
    const lookbackMinutes = options.lookbackMinutes ?? config.cache.aircraft.warmLookbackMinutes;
    const batchSize = options.batchSize ?? config.cache.aircraft.warmBatchSize;
    const db = postgresRepository.getDb();
    try {
      const started = Date.now();
      const result = await db.any(
        `
          SELECT *
          FROM aircraft_states_raw
          WHERE created_at >= NOW() - INTERVAL $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [`${lookbackMinutes} minutes`, batchSize],
      );

      await Promise.all(
        result.map((row) => redisAircraftCache.cacheRecord(row, {
          data_source: row.data_source,
          source_priority: row.source_priority,
          ingestion_timestamp: row.ingestion_timestamp
            ? new Date(row.ingestion_timestamp).toISOString()
            : null,
          feeder_id: row.feeder_id,
        }).catch((error: Error) => {
          logger.debug('Cache warmer failed to cache record', { error: error.message });
        })),
      );

      this.status.lastRunAt = new Date().toISOString();
      this.status.lastDurationMs = Date.now() - started;
      this.status.lastRowCount = result.length;
      this.status.lookbackMinutes = lookbackMinutes;
      this.status.batchSize = batchSize;
    } catch (error) {
      const err = error as Error;
      logger.warn('Aircraft cache warmer error', { error: err.message });
    } finally {
      this.running = false;
      this.status.running = false;
    }
  }

  start(): void {
    if (!config.cache.aircraft.warmerEnabled || this.interval) {
      return;
    }
    const intervalMs = config.cache.aircraft.warmIntervalSeconds * 1000;
    this.interval = setInterval(() => {
      this.warmCache().catch((error: Error) => {
        logger.warn('Cache warmer iteration failed', { error: error.message });
      });
    }, intervalMs);
    this.status.enabled = true;
    this.status.intervalSeconds = config.cache.aircraft.warmIntervalSeconds;
    this.warmCache().catch((error: Error) => {
      logger.warn('Initial cache warm failed', { error: error.message });
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.status.running = false;
  }

  getStatus(): CacheWarmerStatus {
    return { ...this.status };
  }
}

const aircraftCacheWarmer = new AircraftCacheWarmer();
export default aircraftCacheWarmer;
