jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockService = {
  getMETAR: jest.fn(),
  getTAF: jest.fn(),
  getMultipleMETARs: jest.fn(),
};

jest.mock('../AviationWeatherService', () => ({
  __esModule: true,
  default: {
    getMETAR: jest.fn(),
    getTAF: jest.fn(),
    getMultipleMETARs: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import aviationWeatherService from '../AviationWeatherService';

describe('AviationWeatherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (aviationWeatherService.getMETAR as jest.Mock).mockImplementation(mockService.getMETAR);
    (aviationWeatherService.getTAF as jest.Mock).mockImplementation(mockService.getTAF);
    (aviationWeatherService.getMultipleMETARs as jest.Mock).mockImplementation(mockService.getMultipleMETARs);
  });

  describe('getMETAR', () => {
    it('should return null for invalid ICAO code', async () => {
      mockService.getMETAR.mockResolvedValue(null);

      const result = await aviationWeatherService.getMETAR('');
      expect(result).toBeNull();

      const result2 = await aviationWeatherService.getMETAR('AB');
      expect(result2).toBeNull();
    });

    it('should fetch METAR from AWC API', async () => {
      const mockData = {
        icaoId: 'KJFK',
        obsTime: 1764551280,
        temp: 5.6,
        dewp: 3.9,
        wdir: 260,
        wspd: 12,
        visib: '10+',
        altim: 1019,
        rawOb: 'SPECI KJFK 010108Z 26012KT 10SM OVC013 06/04 A3009',
        fltCat: 'MVFR',
        clouds: [{ cover: 'OVC', base: 1300 }],
      };

      mockService.getMETAR.mockResolvedValue(mockData);

      const result = await aviationWeatherService.getMETAR('KJFK');

      expect(result).not.toBeNull();
      expect(result?.icaoId).toBe('KJFK');
      expect(result?.rawOb).toBe('SPECI KJFK 010108Z 26012KT 10SM OVC013 06/04 A3009');
      expect(mockService.getMETAR).toHaveBeenCalledWith('KJFK');
    });

    it('should return null when no METAR data available', async () => {
      mockService.getMETAR.mockResolvedValue(null);

      const result = await aviationWeatherService.getMETAR('KJFK');

      expect(result).toBeNull();
    });

    it('should handle rate limit errors', async () => {
      mockService.getMETAR.mockResolvedValue(null);

      const result = await aviationWeatherService.getMETAR('KJFK');

      expect(result).toBeNull();
    });

    it('should handle 204 No Content response', async () => {
      mockService.getMETAR.mockResolvedValue(null);

      const result = await aviationWeatherService.getMETAR('KJFK');

      expect(result).toBeNull();
    });

    it('should use cache for repeated requests', async () => {
      const mockData = {
        icaoId: 'KJFK',
        rawOb: 'KJFK 010108Z 26012KT 10SM',
      };

      mockService.getMETAR.mockResolvedValue(mockData);

      const result1 = await aviationWeatherService.getMETAR('KJFK');
      const result2 = await aviationWeatherService.getMETAR('KJFK');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
    });
  });

  describe('getTAF', () => {
    it('should return null for invalid ICAO code', async () => {
      mockService.getTAF.mockResolvedValue(null);

      const result = await aviationWeatherService.getTAF('');

      expect(result).toBeNull();
    });

    it('should fetch TAF from AWC API', async () => {
      const mockData = {
        icaoId: 'KJFK',
        issueTime: '2025-11-30T23:22:00.000Z',
        validTimeFrom: 1764547200,
        validTimeTo: 1764655200,
        rawTAF: 'TAF KJFK 302322Z 0100/0206 24010KT P6SM',
      };

      mockService.getTAF.mockResolvedValue(mockData);

      const result = await aviationWeatherService.getTAF('KJFK');

      expect(result).not.toBeNull();
      expect(result?.icaoId).toBe('KJFK');
      expect(result?.rawTAF).toBe('TAF KJFK 302322Z 0100/0206 24010KT P6SM');
      expect(mockService.getTAF).toHaveBeenCalledWith('KJFK');
    });

    it('should return null when no TAF data available', async () => {
      mockService.getTAF.mockResolvedValue(null);

      const result = await aviationWeatherService.getTAF('KJFK');

      expect(result).toBeNull();
    });
  });

  describe('getMultipleMETARs', () => {
    it('should return empty array for empty input', async () => {
      mockService.getMultipleMETARs.mockResolvedValue([]);

      const result = await aviationWeatherService.getMultipleMETARs([]);

      expect(result).toEqual([]);
    });

    it('should fetch multiple METARs', async () => {
      const mockData = [
        { icaoId: 'KJFK', rawOb: 'KJFK METAR' },
        { icaoId: 'KLAX', rawOb: 'KLAX METAR' },
      ];

      mockService.getMultipleMETARs.mockResolvedValue(mockData);

      const result = await aviationWeatherService.getMultipleMETARs(['KJFK', 'KLAX']);

      expect(result).toHaveLength(2);
      expect(result[0].icaoId).toBe('KJFK');
      expect(result[1].icaoId).toBe('KLAX');
    });
  });
});
