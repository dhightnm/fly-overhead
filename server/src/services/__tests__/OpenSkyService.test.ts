import openSkyService from '../OpenSkyService';
import rateLimitManager from '../RateLimitManager';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('../RateLimitManager');
jest.mock('../../config', () => ({
  external: {
    opensky: {
      baseUrl: 'https://opensky-network.org/api',
      user: 'testuser',
      pass: 'testpass',
    },
  },
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockRateLimitManager = rateLimitManager as jest.Mocked<typeof rateLimitManager>;

describe('OpenSkyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllStates', () => {
    it('should fetch all aircraft states successfully', async () => {
      const mockResponse = {
        data: {
          time: Math.floor(Date.now() / 1000),
          states: [
            ['abc123', 'TEST01', null, null, Math.floor(Date.now() / 1000)],
            ['def456', 'TEST02', null, null, Math.floor(Date.now() / 1000)],
          ],
        },
      };

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockResolvedValue(mockResponse);

      const result = await openSkyService.getAllStates();

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://opensky-network.org/api/states/all',
        expect.objectContaining({
          params: { extended: 1 },
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
          timeout: 30000,
        }),
      );
      expect(result).toEqual(mockResponse.data);
      expect(mockRateLimitManager.recordSuccess).toHaveBeenCalled();
    });

    it('should throw rate limit error when rate limited', async () => {
      mockRateLimitManager.isRateLimited.mockReturnValue(true);
      mockRateLimitManager.getSecondsUntilRetry.mockReturnValue(60);

      await expect(openSkyService.getAllStates()).rejects.toMatchObject({
        rateLimited: true,
        retryAfter: 60,
      });

      expect(mockAxios.get).not.toHaveBeenCalled();
    });

    it('should handle 429 rate limit response', async () => {
      const rateLimitError: any = new Error('Rate limited');
      rateLimitError.response = {
        status: 429,
        headers: {
          'x-rate-limit-retry-after-seconds': '120',
        },
      };

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockRejectedValue(rateLimitError);

      await expect(openSkyService.getAllStates()).rejects.toMatchObject({
        rateLimited: true,
        retryAfter: 120,
      });

      expect(mockRateLimitManager.recordRateLimit).toHaveBeenCalledWith(120);
    });

    it('should retry on timeout errors', async () => {
      const timeoutError: any = new Error('ETIMEDOUT');
      timeoutError.code = 'ETIMEDOUT';

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          data: {
            time: Math.floor(Date.now() / 1000),
            states: [],
          },
        });

      const result = await openSkyService.getAllStates();

      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('should retry on connection reset errors', async () => {
      const resetError: any = new Error('ECONNRESET');
      resetError.code = 'ECONNRESET';

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get
        .mockRejectedValueOnce(resetError)
        .mockResolvedValueOnce({
          data: {
            time: Math.floor(Date.now() / 1000),
            states: [],
          },
        });

      const result = await openSkyService.getAllStates();

      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('should retry on DNS errors', async () => {
      const dnsError: any = new Error('ENOTFOUND');
      dnsError.code = 'ENOTFOUND';

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get
        .mockRejectedValueOnce(dnsError)
        .mockResolvedValueOnce({
          data: {
            time: Math.floor(Date.now() / 1000),
            states: [],
          },
        });

      const result = await openSkyService.getAllStates();

      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('should throw error after max retries', async () => {
      jest.setTimeout(10000); // Increase timeout for this test
      const timeoutError: any = new Error('ETIMEDOUT');
      timeoutError.code = 'ETIMEDOUT';

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockRejectedValue(timeoutError);

      await expect(openSkyService.getAllStates()).rejects.toThrow();
      expect(mockAxios.get).toHaveBeenCalledTimes(3); // Max retries
    }, 10000);

    it('should use correct authentication header', async () => {
      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockResolvedValue({
        data: {
          time: Math.floor(Date.now() / 1000),
          states: [],
        },
      });

      await openSkyService.getAllStates();

      const callArgs = mockAxios.get.mock.calls[0];
      const headers = callArgs[1]?.headers;
      expect(headers?.Authorization).toMatch(/^Basic /);
    });
  });

  describe('getStatesInBounds', () => {
    it('should fetch states within bounding box', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      const mockResponse = {
        data: {
          time: Math.floor(Date.now() / 1000),
          states: [['abc123', 'TEST01', null, null, Math.floor(Date.now() / 1000)]],
        },
      };

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockResolvedValue(mockResponse);

      const result = await openSkyService.getStatesInBounds(boundingBox);

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://opensky-network.org/api/states/all',
        expect.objectContaining({
          params: {
            extended: 1,
            lamin: 39.0,
            lomin: -75.0,
            lamax: 41.0,
            lomax: -73.0,
          },
        }),
      );
      expect(result).toEqual(mockResponse.data);
      expect(mockRateLimitManager.recordSuccess).toHaveBeenCalled();
    });

    it('should throw rate limit error when rate limited', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      mockRateLimitManager.isRateLimited.mockReturnValue(true);
      mockRateLimitManager.getSecondsUntilRetry.mockReturnValue(60);

      await expect(openSkyService.getStatesInBounds(boundingBox)).rejects.toMatchObject({
        rateLimited: true,
        retryAfter: 60,
      });
    });

    it('should handle 429 rate limit response', async () => {
      const boundingBox = {
        lamin: 39.0,
        lomin: -75.0,
        lamax: 41.0,
        lomax: -73.0,
      };

      const rateLimitError: any = new Error('Rate limited');
      rateLimitError.response = {
        status: 429,
        headers: {
          'x-rate-limit-retry-after-seconds': '120',
        },
      };

      mockRateLimitManager.isRateLimited.mockReturnValue(false);
      mockAxios.get.mockRejectedValue(rateLimitError);

      await expect(openSkyService.getStatesInBounds(boundingBox)).rejects.toMatchObject({
        rateLimited: true,
        retryAfter: 120,
      });
    });
  });

  describe('getFlightsByAircraft', () => {
    it('should fetch flights for aircraft', async () => {
      const icao24 = 'abc123';
      const begin = Math.floor(Date.now() / 1000) - 86400;
      const end = Math.floor(Date.now() / 1000);

      const mockResponse = {
        data: [
          {
            icao24,
            firstSeen: begin,
            lastSeen: end,
          },
        ],
      };

      mockAxios.get.mockResolvedValue(mockResponse);

      const result = await openSkyService.getFlightsByAircraft(icao24, begin, end);

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://opensky-network.org/api/flights/aircraft',
        expect.objectContaining({
          params: {
            icao24: icao24.toLowerCase(),
            begin,
            end,
          },
        }),
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should return empty array on 404 (no flights found)', async () => {
      const icao24 = 'abc123';
      const begin = Math.floor(Date.now() / 1000) - 86400;
      const end = Math.floor(Date.now() / 1000);

      const notFoundError: any = new Error('Not found');
      notFoundError.response = { status: 404 };

      mockAxios.get.mockRejectedValue(notFoundError);

      const result = await openSkyService.getFlightsByAircraft(icao24, begin, end);

      expect(result).toEqual([]);
    });

    it('should return empty array on 400 (bad request)', async () => {
      const icao24 = 'abc123';
      const begin = Math.floor(Date.now() / 1000) - 86400;
      const end = Math.floor(Date.now() / 1000);

      const badRequestError: any = new Error('Bad request');
      badRequestError.response = { status: 400 };

      mockAxios.get.mockRejectedValue(badRequestError);

      const result = await openSkyService.getFlightsByAircraft(icao24, begin, end);

      expect(result).toEqual([]);
    });

    it('should convert icao24 to lowercase', async () => {
      const icao24 = 'ABC123';
      const begin = Math.floor(Date.now() / 1000) - 86400;
      const end = Math.floor(Date.now() / 1000);

      mockAxios.get.mockResolvedValue({ data: [] });

      await openSkyService.getFlightsByAircraft(icao24, begin, end);

      const callArgs = mockAxios.get.mock.calls[0];
      expect(callArgs[1]?.params?.icao24).toBe('abc123');
    });
  });

  describe('prepareStateForDatabase', () => {
    it('should prepare state with category', () => {
      const state = [
        'abc123',
        'TEST01',
        null,
        null,
        Math.floor(Date.now() / 1000),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        5, // category at index 17
      ];

      const result = openSkyService.prepareStateForDatabase(state);

      expect(result.length).toBe(19); // 18 original + created_at
      expect(result[17]).toBe(5); // category preserved
      expect(result[18]).toBeInstanceOf(Date); // created_at added
    });

    it('should handle null category', () => {
      const state = [
        'abc123',
        'TEST01',
        null,
        null,
        Math.floor(Date.now() / 1000),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null, // null category
      ];

      const result = openSkyService.prepareStateForDatabase(state);

      expect(result[17]).toBeNull();
    });

    it('should clamp invalid category values', () => {
      const state = [
        'abc123',
        'TEST01',
        null,
        null,
        Math.floor(Date.now() / 1000),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        25, // invalid category (> 19)
      ];

      const result = openSkyService.prepareStateForDatabase(state);

      expect(result[17]).toBeNull(); // Invalid category should be set to null
    });

    it('should handle negative category values', () => {
      const state = [
        'abc123',
        'TEST01',
        null,
        null,
        Math.floor(Date.now() / 1000),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        -1, // invalid category (< 0)
      ];

      const result = openSkyService.prepareStateForDatabase(state);

      expect(result[17]).toBeNull(); // Invalid category should be set to null
    });
  });
});

