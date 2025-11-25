jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    cache: {
      aircraft: {
        enabled: true,
        redisUrl: 'redis://test',
        prefix: 'test:aircraft',
        ttlSeconds: 60,
      },
    },
  },
}));

const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockScan = jest.fn();
const mockMget = jest.fn();

jest.mock('../../lib/redis/RedisClientManager', () => ({
  __esModule: true,
  default: {
    getClient: jest.fn(() => ({
      set: mockSet,
      get: mockGet,
      del: mockDel,
      scan: mockScan,
      mget: mockMget,
    })),
  },
}));

import redisAircraftCache from '../RedisAircraftCache';

describe('RedisAircraftCache', () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockGet.mockReset();
    mockDel.mockReset();
    mockScan.mockReset();
    mockMget.mockReset();
    redisAircraftCache.resetMetrics();
  });

  it('caches state array and indexes', async () => {
    const state = [
      'abc123', 'TEST01', 'USA', 0, 1, 10.1, 20.2, 3000, false, 200, 180, 0, null, 3200,
      '7500', false, 1, 0, null, 'A20N', 'A320-251N', 'N123AA', 'normal', null, null, null, null,
    ];

    await redisAircraftCache.cacheStateArray(state, {
      data_source: 'airplanes.live',
      source_priority: 10,
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('test:aircraft:icao:abc123'),
      expect.any(String),
      'EX',
      60,
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('test:aircraft:callsign:TEST01'),
      'abc123',
      'EX',
      60,
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('test:aircraft:registration:N123AA'),
      'abc123',
      'EX',
      60,
    );
  });

  it('returns cached aircraft by callsign', async () => {
    mockGet
      .mockResolvedValueOnce('abc123') // resolve callsign to icao
      .mockResolvedValueOnce(JSON.stringify({ icao24: 'abc123', callsign: 'TEST01' }));

    const result = await redisAircraftCache.getByIdentifier('TEST01');

    expect(result).toEqual(expect.objectContaining({ icao24: 'abc123' }));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('returns states in bounds via scan', async () => {
    const payload = JSON.stringify({
      icao24: 'abc321',
      latitude: 10,
      longitude: 20,
      last_contact: 200,
    });
    mockScan.mockResolvedValueOnce(['0', ['test:aircraft:icao:abc321']]);
    mockMget.mockResolvedValueOnce([payload]);

    const result = await redisAircraftCache.getStatesInBounds(5, 15, 15, 25, 100);

    expect(result).toHaveLength(1);
    expect(result[0].icao24).toBe('abc321');
    expect(mockScan).toHaveBeenCalled();
    expect(mockMget).toHaveBeenCalledWith('test:aircraft:icao:abc321');
  });

  it('tracks cache hit and miss metrics', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ icao24: 'abc123' }));
    await redisAircraftCache.getByIcao('abc123');
    mockGet.mockResolvedValueOnce(null);
    await redisAircraftCache.getByIdentifier('missing');
    const metrics = redisAircraftCache.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
  });
});
