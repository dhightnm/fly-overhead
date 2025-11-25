/* eslint-env jest */

import {
  beforeEach, describe, expect, it, jest,
} from '@jest/globals';
import type { Mocked } from 'jest-mock';
import satelliteService from '../SatelliteService';
import httpClient from '../../utils/httpClient';

// Mock dependencies
jest.mock('../../utils/httpClient');
jest.mock('../../config', () => ({
  external: {
    n2yo: {
      baseUrl: 'https://api.n2yo.com/rest/v1',
      apiKey: 'test-api-key',
    },
  },
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockHttpClient = httpClient as Mocked<typeof httpClient>;

describe('SatelliteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSatellitesAbove', () => {
    it('should fetch satellite data successfully', async () => {
      const mockResponse = {
        data: {
          info: {
            satname: 'ISS (ZARYA)',
            satid: 25544,
            transactionscount: 0,
          },
          above: [
            {
              satid: 25544,
              satname: 'ISS (ZARYA)',
              intDesignator: '1998-067A',
              launchDate: '1998-11-20',
              satlat: 51.6721,
              satlng: -129.4366,
              satalt: 408.5,
            },
          ],
        },
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const result = await satelliteService.getSatellitesAbove(40.0, -100.0, 0);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'https://api.n2yo.com/rest/v1/satellite/above/40/-100/0/45/52&apiKey=test-api-key',
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should construct URL with correct parameters', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { above: [] } });

      await satelliteService.getSatellitesAbove(37.7749, -122.4194, 100);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'https://api.n2yo.com/rest/v1/satellite/above/37.7749/-122.4194/100/45/52&apiKey=test-api-key',
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });

    it('should handle negative coordinates', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { above: [] } });

      await satelliteService.getSatellitesAbove(-40.0, -100.0, 0);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'https://api.n2yo.com/rest/v1/satellite/above/-40/-100/0/45/52&apiKey=test-api-key',
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });

    it('should handle high altitude values', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { above: [] } });

      await satelliteService.getSatellitesAbove(40.0, -100.0, 10000);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'https://api.n2yo.com/rest/v1/satellite/above/40/-100/10000/45/52&apiKey=test-api-key',
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });

    it('should throw error when API request fails', async () => {
      const error = new Error('Network error');
      mockHttpClient.get.mockRejectedValue(error);

      await expect(satelliteService.getSatellitesAbove(40.0, -100.0, 0)).rejects.toThrow('Network error');

      expect(mockHttpClient.get).toHaveBeenCalled();
    });

    it('should handle HTTP error responses', async () => {
      const httpError: any = new Error('Request failed');
      httpError.response = {
        status: 500,
        data: { error: 'Internal server error' },
      };

      mockHttpClient.get.mockRejectedValue(httpError);

      await expect(satelliteService.getSatellitesAbove(40.0, -100.0, 0)).rejects.toThrow('Request failed');
    });

    it('should handle timeout errors', async () => {
      const timeoutError: any = new Error('ETIMEDOUT');
      timeoutError.code = 'ETIMEDOUT';

      mockHttpClient.get.mockRejectedValue(timeoutError);

      await expect(satelliteService.getSatellitesAbove(40.0, -100.0, 0)).rejects.toThrow('ETIMEDOUT');
    });

    it('should handle 401 unauthorized errors', async () => {
      const unauthorizedError: any = new Error('Unauthorized');
      unauthorizedError.response = {
        status: 401,
        data: { error: 'Invalid API key' },
      };

      mockHttpClient.get.mockRejectedValue(unauthorizedError);

      await expect(satelliteService.getSatellitesAbove(40.0, -100.0, 0)).rejects.toThrow('Unauthorized');
    });

    it('should handle 429 rate limit errors', async () => {
      const rateLimitError: any = new Error('Too many requests');
      rateLimitError.response = {
        status: 429,
        data: { error: 'Rate limit exceeded' },
      };

      mockHttpClient.get.mockRejectedValue(rateLimitError);

      await expect(satelliteService.getSatellitesAbove(40.0, -100.0, 0)).rejects.toThrow('Too many requests');
    });

    it('should handle empty response data', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { above: [] } });

      const result = await satelliteService.getSatellitesAbove(40.0, -100.0, 0);

      expect(result).toEqual({ above: [] });
    });

    it('should handle response with multiple satellites', async () => {
      const mockResponse = {
        data: {
          info: {
            satname: 'Multiple satellites',
            satid: 0,
            transactionscount: 0,
          },
          above: [
            {
              satid: 25544,
              satname: 'ISS (ZARYA)',
              intDesignator: '1998-067A',
              launchDate: '1998-11-20',
              satlat: 51.6721,
              satlng: -129.4366,
              satalt: 408.5,
            },
            {
              satid: 25545,
              satname: 'HST',
              intDesignator: '1990-037B',
              launchDate: '1990-04-24',
              satlat: 28.5,
              satlng: -80.6,
              satalt: 540.0,
            },
          ],
        },
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const result = await satelliteService.getSatellitesAbove(40.0, -100.0, 0);

      expect(result.above).toHaveLength(2);
      expect(result.above[0].satid).toBe(25544);
      expect(result.above[1].satid).toBe(25545);
    });
  });
});
