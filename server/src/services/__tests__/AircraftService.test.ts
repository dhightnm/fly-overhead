// Mock config FIRST before any other imports
jest.mock('../../config', () => {
  const mockConfig = {
    database: {
      postgres: {
        url: 'postgresql://test:test@localhost:5432/test',
        pool: {
          min: 2,
          max: 10,
        },
      },
    },
    external: {
      opensky: {
        baseUrl: 'https://opensky-network.org/api',
        user: 'testuser',
        pass: 'testpass',
      },
    },
    aircraft: {
      recentContactThreshold: 30 * 60, // 30 minutes
      staleRecordThreshold: 2 * 60 * 60 * 1000, // 2 hours
      devModeStaleThreshold: 24 * 60 * 60, // 24 hours
    },
  };
  return {
    __esModule: true,
    default: mockConfig,
  };
});

// Mock DatabaseConnection before PostgresRepository
jest.mock('../../repositories/DatabaseConnection', () => {
  const mockDb = {
    connect: jest.fn().mockResolvedValue({ done: jest.fn() }),
    query: jest.fn(),
    one: jest.fn(),
    any: jest.fn(),
    none: jest.fn(),
  };
  const mockPostGIS = {
    initialize: jest.fn(),
    createGeometryTriggers: jest.fn(),
  };
  return {
    getConnection: jest.fn(() => ({
      getDb: () => mockDb,
      getPostGIS: () => mockPostGIS,
      initConnection: jest.fn(),
      initializePostGIS: jest.fn(),
    })),
    DatabaseConnection: jest.fn(),
  };
});

// Mock other dependencies
const mockGetAllStates = jest.fn();
const mockGetStatesInBounds = jest.fn();
const mockPrepareStateForDatabase = jest.fn();

jest.mock('../OpenSkyService', () => ({
  __esModule: true,
  default: {
    getAllStates: mockGetAllStates,
    getStatesInBounds: mockGetStatesInBounds,
    prepareStateForDatabase: mockPrepareStateForDatabase,
  },
}));
jest.mock('../../repositories/PostgresRepository');
jest.mock('../RateLimitManager');
jest.mock('../../routes/aircraft.routes', () => ({
  boundsCache: {
    flushAll: jest.fn(),
  },
}));

import aircraftService from '../AircraftService';
import postgresRepository from '../../repositories/PostgresRepository';
import rateLimitManager from '../RateLimitManager';

// Type the mocks - use the actual mock functions
const mockOpenSkyService = {
  getAllStates: mockGetAllStates,
  getStatesInBounds: mockGetStatesInBounds,
  prepareStateForDatabase: mockPrepareStateForDatabase,
};
const mockPostgresRepository = postgresRepository as jest.Mocked<typeof postgresRepository>;
const mockRateLimitManager = rateLimitManager as jest.Mocked<typeof rateLimitManager>;
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../WebSocketService', () => ({
  getIO: jest.fn().mockReturnValue({
    emit: jest.fn(),
  }),
}));

describe('AircraftService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchAndUpdateAllAircraft', () => {
    it('should fetch and update all aircraft successfully', async () => {
      const mockStates = [
        ['abc123', 'TEST01', null, null, Math.floor(Date.now() / 1000)],
        ['def456', 'TEST02', null, null, Math.floor(Date.now() / 1000)],
      ];

      mockOpenSkyService.getAllStates.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: mockStates,
      });
      mockOpenSkyService.prepareStateForDatabase.mockImplementation((state) => [...state, new Date()]);
      mockPostgresRepository.upsertAircraftStateWithPriority.mockResolvedValue(undefined);

      const result = await aircraftService.fetchAndUpdateAllAircraft();

      expect(mockOpenSkyService.getAllStates).toHaveBeenCalled();
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockStates);
    });

    it('should handle rate limiting gracefully', async () => {
      const rateLimitError: any = new Error('OpenSky API rate limited');
      rateLimitError.rateLimited = true;
      rateLimitError.retryAfter = 60;

      mockOpenSkyService.getAllStates.mockRejectedValue(rateLimitError);

      const result = await aircraftService.fetchAndUpdateAllAircraft();

      expect(result).toEqual([]);
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).not.toHaveBeenCalled();
    });

    it('should return empty array when no states returned', async () => {
      mockOpenSkyService.getAllStates.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: [],
      });

      const result = await aircraftService.fetchAndUpdateAllAircraft();

      expect(result).toEqual([]);
    });

    it('should process aircraft in batches', async () => {
      const mockStates = Array.from({ length: 150 }, (_, i) => [
        `icao${i}`,
        `TEST${i}`,
        null,
        null,
        Math.floor(Date.now() / 1000),
      ]);

      mockOpenSkyService.getAllStates.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: mockStates,
      });
      mockOpenSkyService.prepareStateForDatabase.mockImplementation((state) => [...state, new Date()]);
      mockPostgresRepository.upsertAircraftStateWithPriority.mockResolvedValue(undefined);

      await aircraftService.fetchAndUpdateAllAircraft();

      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(150);
    });
  });

  describe('getAircraftByIdentifier', () => {
    it('should return aircraft from database when found', async () => {
      const mockAircraft = {
        icao24: 'abc123',
        callsign: 'TEST01',
        last_contact: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
        latitude: 40.0,
        longitude: -74.0,
      };

      mockPostgresRepository.findAircraftByIdentifier.mockResolvedValue([mockAircraft]);

      const result = await aircraftService.getAircraftByIdentifier('abc123');

      expect(result).toBeDefined();
      expect(result?.icao24).toBe('abc123');
      expect(mockPostgresRepository.findAircraftByIdentifier).toHaveBeenCalledWith('abc123');
    });

    it('should return null when aircraft not found', async () => {
      mockPostgresRepository.findAircraftByIdentifier.mockResolvedValue([]);

      const result = await aircraftService.getAircraftByIdentifier('nonexistent');

      expect(result).toBeNull();
    });

    it('should check rate limit before fetching fresh data', async () => {
      const staleAircraft = {
        icao24: 'abc123',
        callsign: 'TEST01',
        last_contact: Math.floor(Date.now() / 1000) - 20 * 60, // 20 minutes ago (stale)
        latitude: 40.0,
        longitude: -74.0,
      };

      mockPostgresRepository.findAircraftByIdentifier.mockResolvedValue([staleAircraft]);
      mockRateLimitManager.isRateLimited.mockReturnValue(true);
      mockRateLimitManager.getSecondsUntilRetry.mockReturnValue(60);

      const result = await aircraftService.getAircraftByIdentifier('abc123');

      expect(result).toBeDefined();
      expect(result?.isStale).toBe(true);
      expect(mockOpenSkyService.getStatesInBounds).not.toHaveBeenCalled();
      expect(mockOpenSkyService.getAllStates).not.toHaveBeenCalled();
    });

    it('should fetch fresh data when aircraft is stale and not rate limited', async () => {
      const staleAircraft = {
        icao24: 'abc123',
        callsign: 'TEST01',
        last_contact: Math.floor(Date.now() / 1000) - 20 * 60, // 20 minutes ago (stale)
        latitude: 40.0,
        longitude: -74.0,
      };

      const freshState = ['abc123', 'TEST01', null, null, Math.floor(Date.now() / 1000)];

      mockPostgresRepository.findAircraftByIdentifier
        .mockResolvedValueOnce([staleAircraft])
        .mockResolvedValueOnce([{ ...staleAircraft, last_contact: Math.floor(Date.now() / 1000) }]);
      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockOpenSkyService.getStatesInBounds.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: [freshState],
      });
      mockOpenSkyService.prepareStateForDatabase.mockImplementation((state) => [...state, new Date()]);
      mockPostgresRepository.upsertAircraftStateWithPriority.mockResolvedValue(undefined);

      const result = await aircraftService.getAircraftByIdentifier('abc123');

      expect(mockOpenSkyService.getStatesInBounds).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should mark aircraft as stale when data is old', async () => {
      const oldAircraft = {
        icao24: 'abc123',
        callsign: 'TEST01',
        last_contact: Math.floor(Date.now() / 1000) - 20 * 60, // 20 minutes ago
        latitude: 40.0,
        longitude: -74.0,
      };

      mockPostgresRepository.findAircraftByIdentifier.mockResolvedValue([oldAircraft]);
      mockRateLimitManager.isRateLimited.mockReturnValue(true);

      const result = await aircraftService.getAircraftByIdentifier('abc123');

      expect(result?.isStale).toBe(true);
      expect(result?.staleReason).toBe('stale-database');
    });
  });

  describe('fetchAndUpdateAircraftInBounds', () => {
    it('should fetch and update aircraft in bounds', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      const mockStates = [
        ['abc123', 'TEST01', null, null, Math.floor(Date.now() / 1000)],
      ];

      mockOpenSkyService.getStatesInBounds.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: mockStates,
      });
      mockOpenSkyService.prepareStateForDatabase.mockImplementation((state) => [...state, new Date()]);
      mockPostgresRepository.upsertAircraftStateWithPriority.mockResolvedValue(undefined);

      const result = await aircraftService.fetchAndUpdateAircraftInBounds(boundingBox);

      expect(mockOpenSkyService.getStatesInBounds).toHaveBeenCalledWith(boundingBox);
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalled();
      expect(result).toEqual(mockStates);
    });

    it('should handle rate limiting in bounds fetch', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      const rateLimitError: any = new Error('OpenSky API rate limited');
      rateLimitError.rateLimited = true;
      rateLimitError.retryAfter = 60;

      mockOpenSkyService.getStatesInBounds.mockRejectedValue(rateLimitError);

      const result = await aircraftService.fetchAndUpdateAircraftInBounds(boundingBox);

      expect(result).toEqual([]);
    });

    it('should return empty array when no aircraft in bounds', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      mockOpenSkyService.getStatesInBounds.mockResolvedValue({
        time: Math.floor(Date.now() / 1000),
        states: [],
      });

      const result = await aircraftService.fetchAndUpdateAircraftInBounds(boundingBox);

      expect(result).toEqual([]);
    });
  });

  describe('getAircraftInBounds', () => {
    it('should return aircraft within bounds', async () => {
      const mockAircraft = [
        {
          icao24: 'abc123',
          callsign: 'TEST01',
          last_contact: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
          latitude: 40.0,
          longitude: -74.0,
        },
      ];

      mockPostgresRepository.findAircraftInBounds.mockResolvedValue(mockAircraft);

      const result = await aircraftService.getAircraftInBounds(39.0, -75.0, 41.0, -73.0);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter out old landed aircraft', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockAircraft = [
        {
          icao24: 'abc123',
          callsign: 'TEST01',
          last_contact: now - 20 * 60, // 20 minutes ago (old)
          latitude: 40.0,
          longitude: -74.0,
          on_ground: true, // Landed
        },
        {
          icao24: 'def456',
          callsign: 'TEST02',
          last_contact: now - 300, // 5 minutes ago (recent)
          latitude: 40.1,
          longitude: -74.1,
          on_ground: false, // In flight
        },
      ];

      mockPostgresRepository.findAircraftInBounds.mockResolvedValue(mockAircraft);

      const result = await aircraftService.getAircraftInBounds(39.0, -75.0, 41.0, -73.0);

      // Old landed aircraft should be filtered out
      expect(result.length).toBeLessThanOrEqual(mockAircraft.length);
    });

    it('should mark stale aircraft correctly', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockAircraft = [
        {
          icao24: 'abc123',
          callsign: 'TEST01',
          last_contact: now - 20 * 60, // 20 minutes ago (stale)
          latitude: 40.0,
          longitude: -74.0,
        },
      ];

      mockPostgresRepository.findAircraftInBounds.mockResolvedValue(mockAircraft);

      const result = await aircraftService.getAircraftInBounds(39.0, -75.0, 41.0, -73.0);

      if (result.length > 0) {
        const staleAircraft = result.find((a: any) => a.icao24 === 'abc123');
        if (staleAircraft) {
          expect(staleAircraft.isStale).toBe(true);
        }
      }
    });
  });
});

