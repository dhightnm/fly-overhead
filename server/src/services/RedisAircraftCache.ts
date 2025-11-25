import config from '../config';
import redisClientManager from '../lib/redis/RedisClientManager';
import logger from '../utils/logger';
import type { AircraftStateArray, AircraftStateRecord } from '../types/aircraftState.types';
import type { DbAircraftRow } from '../utils/aircraftState';
import { mapStateArrayToRecord } from '../utils/aircraftState';

interface CacheMetadata {
  data_source?: string | null;
  source_priority?: number | null;
  ingestion_timestamp?: string | null;
  feeder_id?: string | null;
}

type CachedAircraftRecord = AircraftStateRecord & CacheMetadata & {
  cache_timestamp: string;
};

export interface CacheMetrics {
  hits: number;
  misses: number;
  boundsQueries: number;
  boundsResults: number;
  lastBoundsDurationMs: number | null;
}

class RedisAircraftCache {
  private enabled = config.cache.aircraft.enabled;

  private ttlSeconds = config.cache.aircraft.ttlSeconds;

  private prefix = config.cache.aircraft.prefix;

  private redisUrl = config.cache.aircraft.redisUrl;

  private clientName = 'cache:aircraft';

  private redis = this.enabled
    ? redisClientManager.getClient(this.clientName, this.redisUrl)
    : null;

  private scanBatchSize = 200;

  private maxScanResults = 1000;

  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    boundsQueries: 0,
    boundsResults: 0,
    lastBoundsDurationMs: null,
  };

  isEnabled(): boolean {
    return this.enabled && !!this.redis;
  }

  private stateKey(icao24: string): string {
    return `${this.prefix}:icao:${icao24.toLowerCase()}`;
  }

  private callsignKey(callsign: string): string {
    return `${this.prefix}:callsign:${callsign.toUpperCase()}`;
  }

  private registrationKey(registration: string): string {
    return `${this.prefix}:registration:${registration.toUpperCase()}`;
  }

  private normalizeIdentifier(identifier: string): string {
    return identifier.trim();
  }

  private async setWithTtl(key: string, value: string): Promise<void> {
    if (!this.isEnabled() || !this.redis) return;
    try {
      await this.redis.set(key, value, 'EX', this.ttlSeconds);
    } catch (error) {
      const err = error as Error;
      logger.debug('Failed to set Redis aircraft cache entry', { key, error: err.message });
    }
  }

  private async writeIndexes(record: AircraftStateRecord): Promise<void> {
    if (!this.redis) return;
    if (record.callsign) {
      await this.setWithTtl(this.callsignKey(record.callsign), record.icao24);
    }
    if (record.registration) {
      await this.setWithTtl(this.registrationKey(record.registration), record.icao24);
    }
  }

  private buildPayload(record: AircraftStateRecord, metadata: CacheMetadata = {}): CachedAircraftRecord {
    return {
      ...record,
      ...metadata,
      cache_timestamp: new Date().toISOString(),
    };
  }

  async cacheStateArray(
    state: AircraftStateArray,
    metadata: CacheMetadata = {},
  ): Promise<void> {
    if (!this.isEnabled()) return;
    const record = mapStateArrayToRecord(state);
    await this.cacheRecord(record, metadata);
  }

  async cacheRecord(record: AircraftStateRecord | DbAircraftRow, metadata: CacheMetadata = {}): Promise<void> {
    if (!this.isEnabled() || !this.redis) return;

    const normalized: AircraftStateRecord = {
      icao24: String(record.icao24 || '').trim().toLowerCase(),
      callsign: record.callsign || null,
      origin_country: record.origin_country || null,
      time_position: record.time_position ?? null,
      last_contact: record.last_contact ?? null,
      longitude: record.longitude ?? null,
      latitude: record.latitude ?? null,
      baro_altitude: record.baro_altitude ?? null,
      on_ground: record.on_ground ?? null,
      velocity: record.velocity ?? null,
      true_track: record.true_track ?? null,
      vertical_rate: record.vertical_rate ?? null,
      geo_altitude: record.geo_altitude ?? null,
      squawk: record.squawk ?? null,
      spi: record.spi ?? null,
      position_source: record.position_source ?? null,
      category: record.category ?? null,
      aircraft_type: record.aircraft_type ?? null,
      aircraft_description: record.aircraft_description ?? null,
      registration: record.registration ?? null,
      emergency_status: record.emergency_status ?? null,
    };

    if (!normalized.icao24) {
      return;
    }

    const payload = this.buildPayload(normalized, metadata);
    await this.setWithTtl(this.stateKey(normalized.icao24), JSON.stringify(payload));
    await this.writeIndexes(normalized);
  }

  private async resolveIcaoFromIdentifier(identifier: string): Promise<string | null> {
    if (!this.isEnabled() || !this.redis) return null;
    const trimmed = this.normalizeIdentifier(identifier);
    const possibleIcao = trimmed.length === 6 && /^[0-9A-Fa-f]+$/.test(trimmed);
    if (possibleIcao) {
      return trimmed.toLowerCase();
    }

    const upper = trimmed.toUpperCase();
    const callsignKey = this.callsignKey(upper);
    const cachedCallsign = await this.redis.get(callsignKey);
    if (cachedCallsign) {
      return cachedCallsign;
    }

    const regKey = this.registrationKey(upper);
    const cachedReg = await this.redis.get(regKey);
    if (cachedReg) {
      return cachedReg;
    }

    return null;
  }

  async getByIdentifier(identifier: string): Promise<CachedAircraftRecord | null> {
    if (!this.isEnabled() || !this.redis) return null;
    const icao = await this.resolveIcaoFromIdentifier(identifier);
    if (!icao) {
      this.metrics.misses += 1;
      return null;
    }
    return this.getByIcao(icao);
  }

  async getByIcao(icao24: string): Promise<CachedAircraftRecord | null> {
    if (!this.isEnabled() || !this.redis) return null;
    const payload = await this.redis.get(this.stateKey(icao24));
    if (!payload) {
      this.metrics.misses += 1;
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as CachedAircraftRecord;
      this.metrics.hits += 1;
      return parsed;
    } catch (error) {
      const err = error as Error;
      logger.debug('Failed to parse aircraft cache payload', { error: err.message });
      this.metrics.misses += 1;
      return null;
    }
  }

  async invalidate(icao24: string): Promise<void> {
    if (!this.isEnabled() || !this.redis) return;
    try {
      await this.redis.del(this.stateKey(icao24));
    } catch (error) {
      const err = error as Error;
      logger.debug('Failed to invalidate aircraft cache entry', { error: err.message });
    }
  }

  async getStatesInBounds(
    latMin: number,
    lonMin: number,
    latMax: number,
    lonMax: number,
    recentThreshold: number,
    maxResults?: number,
  ): Promise<CachedAircraftRecord[]> {
    if (!this.isEnabled() || !this.redis) return [];
    const results: CachedAircraftRecord[] = [];
    const limit = maxResults ?? this.maxScanResults;
    let cursor = '0';
    const start = Date.now();
    this.metrics.boundsQueries += 1;

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.prefix}:icao:*`,
        'COUNT',
        this.scanBatchSize,
      );
      cursor = nextCursor;
      if (keys.length) {
        const values = await this.redis.mget(...keys);
        values.forEach((payload) => {
          if (!payload) return;
          try {
            const record = JSON.parse(payload) as CachedAircraftRecord;
            if (
              typeof record.latitude === 'number'
              && typeof record.longitude === 'number'
              && record.latitude >= latMin
              && record.latitude <= latMax
              && record.longitude >= lonMin
              && record.longitude <= lonMax
              && typeof record.last_contact === 'number'
              && record.last_contact >= recentThreshold
            ) {
              results.push(record);
            }
          } catch (error) {
            const err = error as Error;
            logger.debug('Failed to parse cached aircraft during bounds scan', { error: err.message });
          }
        });
      }
      if (results.length >= limit) {
        break;
      }
    } while (cursor !== '0');

    const sliced = results.slice(0, limit);
    this.metrics.boundsResults += sliced.length;
    this.metrics.lastBoundsDurationMs = Date.now() - start;
    return sliced;
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      boundsQueries: 0,
      boundsResults: 0,
      lastBoundsDurationMs: null,
    };
  }
}

const redisAircraftCache = new RedisAircraftCache();
export default redisAircraftCache;
