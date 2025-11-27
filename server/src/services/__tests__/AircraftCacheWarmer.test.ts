import aircraftCacheWarmer from '../AircraftCacheWarmer';
import postgresRepository from '../../repositories/PostgresRepository';
import redisAircraftCache from '../RedisAircraftCache';

jest.mock('../../repositories/PostgresRepository', () => ({
  __esModule: true,
  default: {
    getDb: jest.fn(() => ({
      any: jest.fn(),
    })),
  },
}));

jest.mock('../RedisAircraftCache', () => ({
  __esModule: true,
  default: {
    cacheRecord: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    isEnabled: jest.fn().mockReturnValue(true),
  },
}));

describe('AircraftCacheWarmer', () => {
  const mockGetDb = postgresRepository.getDb as unknown as jest.Mock;
  const mockCache = redisAircraftCache as unknown as { cacheRecord: jest.Mock; isEnabled: jest.Mock };
  let mockDb: { any: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = { any: jest.fn() };
    mockGetDb.mockReturnValue(mockDb);
    mockCache.cacheRecord.mockReset();
    mockCache.cacheRecord.mockImplementation(() => Promise.resolve(undefined));
    mockCache.isEnabled.mockReset();
    mockCache.isEnabled.mockReturnValue(true);
  });

  it('warms cache using recent raw records', async () => {
    mockDb.any.mockResolvedValue([
      {
        icao24: 'abc111',
        callsign: 'TEST01',
        latitude: 10,
        longitude: 20,
      },
    ]);

    await aircraftCacheWarmer.warmCache({ lookbackMinutes: 5, batchSize: 10 });

    expect(mockDb.any).toHaveBeenCalled();
    expect(mockCache.cacheRecord).toHaveBeenCalled();
    const status = aircraftCacheWarmer.getStatus();
    expect(status.lastRowCount).toBe(1);
  });
});
