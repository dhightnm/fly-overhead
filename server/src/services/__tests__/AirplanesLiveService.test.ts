import airplanesLiveService from '../AirplanesLiveService';
import axios from 'axios';

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
      const aircraft = {
        hex: 'a1b2c3',
        flight: 'AAL123  ',
        lat: 40.7128,
        lon: -74.0060,
        alt_baro: 35000, // feet
        gs: 450, // knots
        track: 180,
        baro_rate: 2000, // ft/min
        alt_geom: 35100, // feet
        squawk: '1200',
        category: 'A3',
        t: 'B738',
        desc: 'BOEING 737-800',
        r: 'N12345',
        emergency: 'none',
        nav_qnh: 1013.2,
        nav_altitude_mcp: 35000, // feet
        nav_heading: 180,
        mlat: false,
        seen_pos: 1.5,
        seen: 1.0,
      };

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);

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
      const aircraft = {
        hex: 'a1b2c3',
        lat: 40.0,
        lon: -105.0,
        seen: 1.0,
      };

      const result = airplanesLiveService.prepareStateForDatabase(aircraft);

      expect(result[1]).toBeNull(); // callsign
      expect(result[7]).toBeNull(); // baro_altitude
      expect(result[19]).toBeNull(); // aircraft_type
      expect(result[20]).toBeNull(); // aircraft_description
    });

    it('should handle "ground" altitude as null', () => {
      const aircraft = {
        hex: 'a1b2c3',
        lat: 40.0,
        lon: -105.0,
        alt_baro: 'ground', // Sometimes sent as string
        gs: 10,
        seen: 1.0,
      };

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
        const aircraft = {
          hex: 'test',
          lat: 40.0,
          lon: -105.0,
          category,
          seen: 1.0,
        };

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
        radiusNm: 300 // Exceeds max of 250
      });

      // Should clamp to 250nm
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/250'),
        expect.any(Object)
      );
    });
  });
});

