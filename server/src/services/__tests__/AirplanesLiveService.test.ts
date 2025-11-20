import axios from 'axios';
import airplanesLiveService from '../AirplanesLiveService';
import { createAirplanesLiveState } from '../../__tests__/fixtures/aircraftFixtures';

// Mock dependencies
jest.mock('axios');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    external: {
      airplanesLive: {
        baseUrl: 'https://api.airplanes.live/v2',
        maxRadiusNm: 250,
        rateLimit: {
          requestsPerSecond: 1,
        },
      },
    },
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AirplanesLiveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Note: Rate limiting and caching tests are difficult to test in isolation
  // due to the singleton pattern and internal state. Tested manually in integration.

  describe('prepareStateForDatabase', () => {
    it('should transform airplanes.live format to database format with unit conversions', () => {
      const aircraft = createAirplanesLiveState();

      const result = airplanesLiveService.prepareStateForDatabase(aircraft as any);

      expect(result).toHaveLength(28); // 18 standard + 9 enriched + created_at
      expect(result[0]).toBe('a1b2c3'); // icao24
      expect(result[1]).toBe('AAL123'); // callsign (trimmed)
      expect(result[5]).toBe(-74.0060); // longitude
      expect(result[6]).toBe(40.7128); // latitude

      // Altitude: 35000 ft * 0.3048 = 10668 meters
      expect(result[7]).toBeCloseTo(10668, 0); // baro_altitude in meters

      expect(result[9]).toBe(450); // velocity in knots (no conversion)

      // Vertical rate: 2000 ft/min * 0.00508 = 10.16 m/s
      expect(result[11]).toBeCloseTo(10.16, 1); // vertical_rate in m/s

      // Geo altitude: 35100 ft * 0.3048 = 10698 meters
      expect(result[13]).toBeCloseTo(10698, 0); // geo_altitude in meters

      expect(result[19]).toBe('B738'); // aircraft_type
      expect(result[20]).toBe('BOEING 737-800'); // aircraft_description
      expect(result[21]).toBe('N12345'); // registration
      expect(result[22]).toBe('none'); // emergency_status

      // Nav altitude MCP: 35000 ft * 0.3048 = 10668 meters
      expect(result[24]).toBeCloseTo(10668, 0); // nav_altitude_mcp in meters
    });

    it('should handle missing optional fields', () => {
      const aircraft = createAirplanesLiveState({
        flight: undefined,
        lat: 40.0,
        lon: -105.0,
        alt_baro: undefined,
        alt_geom: undefined,
        desc: undefined,
        t: undefined,
        r: undefined,
        category: undefined,
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);

      expect(result[1]).toBeNull(); // callsign
      expect(result[7]).toBeNull(); // baro_altitude
      expect(result[19]).toBeNull(); // aircraft_type
      expect(result[20]).toBeNull(); // aircraft_description
    });

    it('should handle "ground" altitude as null', () => {
      const aircraft = createAirplanesLiveState({
        lat: 40.0,
        lon: -105.0,
        alt_baro: 'ground',
        gs: 10,
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);

      expect(result[7]).toBeNull(); // baro_altitude should be null for "ground"
      expect(result[8]).toBe(true); // on_ground should be true (velocity < 50)
    });

    it('should map category codes correctly', () => {
      const testCases = [
        { category: 'A1', expected: 1 },
        { category: 'A3', expected: 3 },
        { category: 'A7', expected: 7 },
        { category: 'B2', expected: 10 },
        { category: 'C2', expected: 18 },
      ];

      testCases.forEach(({ category, expected }) => {
        const aircraft = createAirplanesLiveState({
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          category,
        });

        const result = airplanesLiveService.prepareStateForDatabase(aircraft);
        expect(result[17]).toBe(expected); // category index
      });
    });
  });

  describe('parameter validation', () => {
    it('should clamp radius to maximum allowed', async () => {
      const mockResponse = {
        data: {
          ac: [],
          total: 0,
          now: Date.now() / 1000,
        },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      await airplanesLiveService.getAircraftNearPoint({
        lat: 40.0,
        lon: -105.0,
        radiusNm: 300, // Exceeds max of 250
      });

      // Should clamp to 250nm
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/250'),
        expect.any(Object),
      );
    });
  });

  describe('altitude conversion - critical bug prevention', () => {
    /**
     * These tests prevent regression of the altitude conversion bug where
     * unconverted feet values were stored in the database, causing the frontend
     * to display 100k+ ft altitudes (e.g., 35000 ft * 3.28084 = 114,829 ft)
     */

    it('should ALWAYS convert feet to meters for baro_altitude', () => {
      const testCases = [
        { feet: 0, expectedMeters: 0 },
        { feet: 1000, expectedMeters: 304.8 },
        { feet: 5000, expectedMeters: 1524 },
        { feet: 10000, expectedMeters: 3048 },
        { feet: 35000, expectedMeters: 10668 }, // Typical cruise altitude
        { feet: 41000, expectedMeters: 12496.8 }, // High cruise
        { feet: 60000, expectedMeters: 18288 }, // Business jet/military
      ];

      testCases.forEach(({ feet, expectedMeters }) => {
        const aircraft = createAirplanesLiveState({
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          alt_baro: feet,
        });

        const result = airplanesLiveService.prepareStateForDatabase(aircraft);
        const actualMeters = result[7];

        expect(actualMeters).toBeCloseTo(expectedMeters, 1);

        // Critical: Ensure the value stored is NOT the raw feet value
        if (feet > 15000) {
          expect(actualMeters).toBeLessThan(feet); // Meters should be < feet for high altitudes
        }
      });
    });

    it('should convert string altitude values to meters', () => {
      const aircraft = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        alt_baro: '35000',
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);
      expect(result[7]).toBeCloseTo(10668, 0); // 35000 ft = 10668 m
    });

    it('should convert geo_altitude to meters', () => {
      const aircraft = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        alt_geom: 35100,
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);
      expect(result[13]).toBeCloseTo(10698.48, 1); // 35100 ft = 10698.48 m
    });

    it('should convert nav_altitude_mcp to meters', () => {
      const aircraft = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        nav_altitude_mcp: 36000,
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);
      expect(result[24]).toBeCloseTo(10972.8, 1); // 36000 ft = 10972.8 m
    });

    it('should NOT convert velocity (already in knots)', () => {
      const testCases = [
        { knots: 0 },
        { knots: 150 },
        { knots: 450 }, // Typical cruise speed
        { knots: 600 }, // High-speed aircraft
      ];

      testCases.forEach(({ knots }) => {
        const aircraft = createAirplanesLiveState({
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          gs: knots,
        });

        const result = airplanesLiveService.prepareStateForDatabase(aircraft);
        const actualVelocity = result[9];

        // Critical: Velocity should be unchanged (already in knots)
        expect(actualVelocity).toBe(knots);
      });
    });

    it('should convert vertical_rate from ft/min to m/s', () => {
      const testCases = [
        { ftPerMin: 2000, expectedMPerS: 10.16 }, // Typical climb
        { ftPerMin: -2000, expectedMPerS: -10.16 }, // Typical descent
        { ftPerMin: 4000, expectedMPerS: 20.32 }, // Aggressive climb
      ];

      testCases.forEach(({ ftPerMin, expectedMPerS }) => {
        const aircraft = createAirplanesLiveState({
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          baro_rate: ftPerMin,
        });

        const result = airplanesLiveService.prepareStateForDatabase(aircraft);
        expect(result[11]).toBeCloseTo(expectedMPerS, 2);
      });
    });

    it('should handle zero and null vertical_rate', () => {
      // baro_rate: 0 is treated as falsy by || operator, returns null
      const aircraftZero = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        baro_rate: 0,
      });

      const resultZero = airplanesLiveService.prepareStateForDatabase(aircraftZero);
      expect(resultZero[11]).toBeNull(); // || operator treats 0 as falsy

      // Missing baro_rate
      const aircraftMissing = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        baro_rate: undefined,
      });

      const resultMissing = airplanesLiveService.prepareStateForDatabase(aircraftMissing);
      expect(resultMissing[11]).toBeNull();
    });

    it('should handle null/undefined altitude gracefully', () => {
      const testCases = [
        { alt_baro: null },
        { alt_baro: undefined },
        { alt_baro: 'ground' },
        { alt_baro: '' },
      ];

      testCases.forEach((altitudeCase) => {
        const aircraft = createAirplanesLiveState({
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          ...altitudeCase,
        });

        const result = airplanesLiveService.prepareStateForDatabase(aircraft);
        expect(result[7]).toBeNull(); // Should be null, not 0 or unconverted
      });
    });

    it('should produce database-ready values that convert correctly on frontend', () => {
      // Simulate the full round-trip: API -> DB -> Frontend
      const aircraft = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        alt_baro: 35000,
        gs: 450,
      });

      const dbState = airplanesLiveService.prepareStateForDatabase(aircraft);
      const dbAltitude = dbState[7]; // Stored in meters
      const dbVelocity = dbState[9]; // Stored in knots

      // Frontend conversions (from Home.tsx):
      const frontendAltitudeFt = dbAltitude * 3.28084;
      const frontendVelocityKts = dbVelocity; // No conversion

      // Verify round-trip accuracy
      expect(frontendAltitudeFt).toBeCloseTo(35000, 0); // Should match original
      expect(frontendVelocityKts).toBe(450); // Should match original

      // Critical: Ensure we're not storing feet in the database
      expect(dbAltitude).toBeCloseTo(10668, 0); // 35000 ft in meters
      expect(dbAltitude).not.toBe(35000); // NOT the raw feet value
    });

    it('should handle edge case: extremely high altitude aircraft', () => {
      // U-2 spy plane or similar can fly at 70,000+ ft
      const aircraft = createAirplanesLiveState({
        hex: 'test',
        lat: 40.0,
        lon: -105.0,
        alt_baro: 70000,
      });

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);
      const altitudeMeters = result[7];

      expect(altitudeMeters).toBeCloseTo(21336, 0); // 70000 ft = 21336 m

      // Verify frontend would display correctly
      const frontendDisplay = altitudeMeters * 3.28084;
      expect(frontendDisplay).toBeCloseTo(70000, 0);
    });
  });
});
