import { portalService } from '../portal.service';
import api from '../api';
import type { Aircraft, UserPlane } from '../../types';
import { createAircraft } from '../../test/fixtures/aircraft';
import { createPlane } from '../../test/fixtures/plane';

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

  describe('user planes', () => {
    const buildApiPlane = (plane: UserPlane) => ({
      id: plane.id,
      user_id: 1,
      tail_number: plane.tailNumber,
      display_name: plane.displayName,
      callsign: plane.callsign,
      serial_number: plane.serialNumber,
      manufacturer: plane.manufacturer,
      model: plane.model,
      year_of_manufacture: plane.yearOfManufacture,
      aircraft_type: plane.aircraftType,
      category: plane.category,
      primary_color: plane.primaryColor,
      secondary_color: plane.secondaryColor,
      home_airport_code: plane.homeAirportCode,
      airspeed_unit: plane.airspeedUnit,
      length_unit: plane.lengthUnit,
      weight_unit: plane.weightUnit,
      fuel_unit: plane.fuelUnit,
      fuel_type: plane.fuelType,
      engine_type: plane.engineType,
      engine_count: plane.engineCount,
      prop_configuration: plane.propConfiguration,
      avionics: plane.avionics,
      default_cruise_altitude: plane.defaultCruiseAltitude,
      service_ceiling: plane.serviceCeiling,
      cruise_speed: plane.cruiseSpeed,
      max_speed: plane.maxSpeed,
      stall_speed: plane.stallSpeed,
      best_glide_speed: plane.bestGlideSpeed,
      best_glide_ratio: plane.bestGlideRatio,
      empty_weight: plane.emptyWeight,
      max_takeoff_weight: plane.maxTakeoffWeight,
      max_landing_weight: plane.maxLandingWeight,
      fuel_capacity_total: plane.fuelCapacityTotal,
      fuel_capacity_usable: plane.fuelCapacityUsable,
      start_taxi_fuel: plane.startTaxiFuel,
      fuel_burn_per_hour: plane.fuelBurnPerHour,
      operating_cost_per_hour: plane.operatingCostPerHour,
      total_flight_hours: plane.totalFlightHours,
      notes: plane.notes,
      created_at: plane.createdAt,
      updated_at: plane.updatedAt,
    });

    it('fetches and maps user planes', async () => {
      const plane = createPlane();
      mockApi.get = jest.fn().mockResolvedValue({
        data: { planes: [buildApiPlane(plane)] },
      });

      const result = await portalService.getUserPlanes();

      expect(mockApi.get).toHaveBeenCalledWith('/api/portal/planes');
      expect(result).toEqual([plane]);
    });

    it('creates a user plane', async () => {
      const plane = createPlane({ id: 5, tailNumber: 'N90000' });
      mockApi.post = jest.fn().mockResolvedValue({
        data: { plane: buildApiPlane(plane) },
      });

      const payload = { tailNumber: 'N90000', manufacturer: 'Cirrus' };

      const result = await portalService.createUserPlane(payload);

      expect(mockApi.post).toHaveBeenCalledWith('/api/portal/planes', payload);
      expect(result).toEqual(plane);
    });

    it('updates a user plane', async () => {
      const plane = createPlane({ id: 7, tailNumber: 'N160RA', manufacturer: 'Cessna' });
      mockApi.put = jest.fn().mockResolvedValue({
        data: { plane: buildApiPlane(plane) },
      });

      const payload = { tailNumber: 'N160RA', manufacturer: 'Cessna' };
      const result = await portalService.updateUserPlane(7, payload);

      expect(mockApi.put).toHaveBeenCalledWith('/api/portal/planes/7', payload);
      expect(result).toEqual(plane);
    });
  });
});
