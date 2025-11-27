import NodeCache from 'node-cache';
import logger from '../utils/logger';

const cache = new NodeCache({
  stdTTL: 2,
  maxKeys: 1000,
  checkperiod: 10,
});

const roundToHundredth = (value: number, mode: 'floor' | 'ceil'): number => {
  const multiplier = 100;
  return mode === 'floor'
    ? Math.floor(value * multiplier) / multiplier
    : Math.ceil(value * multiplier) / multiplier;
};

function buildCacheKey(latmin: number, lonmin: number, latmax: number, lonmax: number): string {
  const roundedLatMin = roundToHundredth(latmin, 'floor');
  const roundedLonMin = roundToHundredth(lonmin, 'floor');
  const roundedLatMax = roundToHundredth(latmax, 'ceil');
  const roundedLonMax = roundToHundredth(lonmax, 'ceil');
  return `/area/${roundedLatMin}/${roundedLonMin}/${roundedLatMax}/${roundedLonMax}`;
}

const boundsCacheService = {
  buildCacheKey,
  has(key: string): boolean {
    return cache.has(key);
  },
  get<T>(key: string): T | undefined {
    return cache.get<T>(key);
  },
  set<T>(key: string, value: T): void {
    cache.set(key, value);
  },
  flushAll(reason?: string): void {
    cache.flushAll();
    logger.info('Cleared bounds cache', { reason: reason || 'unspecified' });
  },
};

export default boundsCacheService;
