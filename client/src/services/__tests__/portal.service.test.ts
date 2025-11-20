import { portalService } from '../portal.service';
import api from '../api';
import type { Aircraft } from '../../types';
import { createAircraft } from '../../test/fixtures/aircraft';

// Mock the API service
jest.mock('../api');

const mockApi = api as jest.Mocked<typeof api>;

describe('PortalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserFeeders', () => {
    it('should fetch and return user feeders', async () => {
      const mockFeeders = [
        {
          feeder_id: 'feeder_123',
          name: 'Test Feeder',
          status: 'active',
          last_seen_at: '2025-01-20T10:00:00.000Z',
          latitude: 40.7128,
          longitude: -74.0060,
          created_at: '2025-01-01T00:00:00.000Z',
        },
      ];

      mockApi.get = jest.fn().mockResolvedValue({
        data: { feeders: mockFeeders },
      });

      const result = await portalService.getUserFeeders();

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/feeders');
      expect(result).toEqual(mockFeeders);
    });

    it('should handle API errors', async () => {
      const error = new Error('Network error');
      mockApi.get = jest.fn().mockRejectedValue(error);

      await expect(portalService.getUserFeeders()).rejects.toThrow('Network error');
    });

    it('should handle empty feeders array', async () => {
      mockApi.get = jest.fn().mockResolvedValue({
        data: { feeders: [] },
      });

      const result = await portalService.getUserFeeders();

      expect(result).toEqual([]);
    });
  });

  describe('getUserAircraft', () => {
    it('should fetch aircraft without pagination', async () => {
      const mockAircraft: Aircraft[] = [
        createAircraft({
          callsign: 'UAL123',
          latitude: 40.7128,
          longitude: -74.006,
          baro_altitude: 35000,
          geo_altitude: 36000,
          velocity: 450,
          true_track: 90,
          vertical_rate: 0,
          on_ground: false,
          category: 1,
          last_contact: 1705756800,
          feeder_id: 'feeder_123',
          data_source: 'feeder',
          source_priority: 10,
        }),
      ];

      mockApi.get = jest.fn().mockResolvedValue({
        data: {
          aircraft: mockAircraft,
          total: 1,
        },
      });

      const result = await portalService.getUserAircraft();

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/aircraft?');
      expect(result).toEqual({
        aircraft: mockAircraft,
        total: 1,
      });
    });

    it('should fetch aircraft with pagination', async () => {
      const mockAircraft: Aircraft[] = [];
      mockApi.get = jest.fn().mockResolvedValue({
        data: {
          aircraft: mockAircraft,
          total: 0,
        },
      });

      const result = await portalService.getUserAircraft(50, 10);

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/aircraft?limit=50&offset=10');
      expect(result).toEqual({
        aircraft: mockAircraft,
        total: 0,
      });
    });

    it('should handle API errors', async () => {
      const error = new Error('Unauthorized');
      mockApi.get = jest.fn().mockRejectedValue(error);

      await expect(portalService.getUserAircraft()).rejects.toThrow('Unauthorized');
    });

    it('should handle pagination with only limit', async () => {
      const mockAircraft: Aircraft[] = [];
      mockApi.get = jest.fn().mockResolvedValue({
        data: {
          aircraft: mockAircraft,
          total: 0,
        },
      });

      const result = await portalService.getUserAircraft(25);

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/aircraft?limit=25');
      expect(result).toEqual({
        aircraft: mockAircraft,
        total: 0,
      });
    });
  });

  describe('getPortalStats', () => {
    it('should fetch and return portal statistics', async () => {
      const mockStats = {
        totalAircraft: 150,
        activeFeeders: 2,
        totalApiKeys: 3,
        recentAircraft: 150,
      };

      mockApi.get = jest.fn().mockResolvedValue({
        data: { stats: mockStats },
      });

      const result = await portalService.getPortalStats();

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/stats');
      expect(result).toEqual(mockStats);
    });

    it('should handle API errors', async () => {
      const error = new Error('Server error');
      mockApi.get = jest.fn().mockRejectedValue(error);

      await expect(portalService.getPortalStats()).rejects.toThrow('Server error');
    });

    it('should handle zero statistics', async () => {
      const mockStats = {
        totalAircraft: 0,
        activeFeeders: 0,
        totalApiKeys: 0,
        recentAircraft: 0,
      };

      mockApi.get = jest.fn().mockResolvedValue({
        data: { stats: mockStats },
      });

      const result = await portalService.getPortalStats();

      expect(result).toEqual(mockStats);
    });
  });
});
