import config from '../config';
import logger from '../utils/logger';
import type { AircraftStateArray } from '../types/aircraftState.types';
import { STATE_INDEX } from '../utils/aircraftState';

interface LiveStateEntry {
  state: AircraftStateArray;
  updatedAt: number; // ms
}

class LiveStateStore {
  private enabled: boolean;

  private ttlMs: number;

  private maxEntries: number;

  private cleanupIntervalMs: number;

  private minResultsForCache: number;

  private entries: Map<string, LiveStateEntry>;

  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.enabled = config.liveState.enabled;
    this.ttlMs = config.liveState.ttlSeconds * 1000;
    this.maxEntries = config.liveState.maxEntries;
    this.cleanupIntervalMs = config.liveState.cleanupIntervalSeconds * 1000;
    this.minResultsForCache = config.liveState.minResultsBeforeDbFallback;
    this.entries = new Map();

    if (this.enabled) {
      this.cleanupTimer = setInterval(() => this.pruneStale(), this.cleanupIntervalMs);
      this.cleanupTimer.unref?.();
      logger.info('LiveStateStore initialized', {
        ttlSeconds: config.liveState.ttlSeconds,
        maxEntries: this.maxEntries,
        cleanupIntervalSeconds: config.liveState.cleanupIntervalSeconds,
      });
    } else {
      logger.info('LiveStateStore disabled via configuration');
    }
  }

  getMinResultsBeforeFallback(): number {
    return this.minResultsForCache;
  }

  upsertStates(states: AircraftStateArray[]): void {
    if (!this.enabled || !states?.length) {
      return;
    }
    const now = Date.now();
    states.forEach((state) => this.upsertStateInternal(state, now));
  }

  upsertState(state: AircraftStateArray): void {
    if (!this.enabled) {
      return;
    }
    this.upsertStateInternal(state, Date.now());
  }

  getStatesInBounds(
    latMin: number,
    lonMin: number,
    latMax: number,
    lonMax: number,
    recentThresholdSeconds: number,
  ): AircraftStateArray[] {
    if (!this.enabled) {
      return [];
    }

    const now = Date.now();
    const cutoffMs = now - this.ttlMs;
    const results: AircraftStateArray[] = [];

    for (const [icao24, entry] of this.entries.entries()) {
      if (entry.updatedAt < cutoffMs) {
        this.entries.delete(icao24);
        continue;
      }

      const state = entry.state;
      const latitude = state[STATE_INDEX.LATITUDE];
      const longitude = state[STATE_INDEX.LONGITUDE];
      const lastContact = state[STATE_INDEX.LAST_CONTACT];

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        continue;
      }

      if (
        latitude < latMin
        || latitude > latMax
        || longitude < lonMin
        || longitude > lonMax
      ) {
        continue;
      }

      if (typeof lastContact === 'number' && lastContact < recentThresholdSeconds) {
        continue;
      }

      results.push(state);
    }

    return results;
  }

  getSize(): number {
    return this.entries.size;
  }

  private upsertStateInternal(state: AircraftStateArray, timestampMs: number): void {
    const icao24 = state[STATE_INDEX.ICAO24];
    if (!icao24) {
      return;
    }

    this.entries.set(icao24, {
      state,
      updatedAt: timestampMs,
    });

    if (this.entries.size > this.maxEntries) {
      this.evictOldest();
    }
  }

  private pruneStale(): void {
    if (!this.enabled || this.entries.size === 0) {
      return;
    }
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [icao24, entry] of this.entries.entries()) {
      if (entry.updatedAt < cutoff) {
        this.entries.delete(icao24);
        removed += 1;
      }
    }

    if (removed > 0) {
      logger.debug('LiveStateStore pruned stale entries', {
        removed,
        remaining: this.entries.size,
      });
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;
    for (const [icao24, entry] of this.entries.entries()) {
      if (entry.updatedAt < oldestTimestamp) {
        oldestTimestamp = entry.updatedAt;
        oldestKey = icao24;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
      logger.debug('LiveStateStore evicted oldest entry to enforce max size', {
        icao24: oldestKey,
        maxEntries: this.maxEntries,
      });
    }
  }
}

const liveStateStore = new LiveStateStore();

export default liveStateStore;

