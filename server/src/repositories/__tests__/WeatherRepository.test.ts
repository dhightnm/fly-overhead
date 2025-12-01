import WeatherRepository from '../WeatherRepository';
import type { METARData, TAFData } from '../WeatherRepository';

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
  result: jest.fn(),
};

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

describe('WeatherRepository', () => {
  let repository: WeatherRepository;

  beforeEach(() => {
    repository = new WeatherRepository(mockDb as any);
    jest.clearAllMocks();
  });

  describe('saveMETAR', () => {
    it('should save METAR data', async () => {
      const metar: METARData = {
        airport_ident: 'KJFK',
        observation_time: new Date(),
        raw_text: 'KJFK METAR',
        temperature_c: 5.6,
        wind_dir_deg: 260,
        wind_speed_kt: 12,
        visibility_statute_mi: 10,
        altim_in_hg: 10.19,
        flight_category: 'MVFR',
        sky_condition: [{ cover: 'OVC', base: 1300 }],
      };

      const saved = {
        id: 1,
        airport_ident: 'KJFK',
        observation_time: new Date(),
        raw_text: 'KJFK METAR',
        created_at: new Date(),
      };

      (mockDb.one as jest.Mock).mockResolvedValue(saved);

      const result = await repository.saveMETAR(metar);

      expect(result).toEqual(saved);
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO metar_observations'),
        expect.arrayContaining([
          'KJFK',
          expect.any(Date),
          'KJFK METAR',
          5.6,
          null,
          260,
          12,
          null,
          10,
          10.19,
          null,
          JSON.stringify([{ cover: 'OVC', base: 1300 }]),
          'MVFR',
          null,
          null,
        ]),
      );
    });

    it('should handle null values', async () => {
      const metar: METARData = {
        airport_ident: 'KJFK',
        observation_time: new Date(),
        raw_text: 'KJFK METAR',
      };

      (mockDb.one as jest.Mock).mockResolvedValue({ id: 1 });

      await repository.saveMETAR(metar);

      expect(mockDb.one).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'KJFK',
          expect.any(Date),
          'KJFK METAR',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          '[]',
          null,
          null,
          null,
        ]),
      );
    });
  });

  describe('getLatestMETAR', () => {
    it('should return latest METAR', async () => {
      const metar = {
        id: 1,
        airport_ident: 'KJFK',
        observation_time: new Date(),
        raw_text: 'KJFK METAR',
        sky_condition: JSON.stringify([{ cover: 'OVC', base: 1300 }]),
      };

      (mockDb.oneOrNone as jest.Mock).mockResolvedValue(metar);

      const result = await repository.getLatestMETAR('KJFK');

      expect(result).not.toBeNull();
      expect(result?.airport_ident).toBe('KJFK');
      expect(result?.sky_condition).toEqual([{ cover: 'OVC', base: 1300 }]);
    });

    it('should return null when no METAR found', async () => {
      (mockDb.oneOrNone as jest.Mock).mockResolvedValue(null);

      const result = await repository.getLatestMETAR('KJFK');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      (mockDb.oneOrNone as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await repository.getLatestMETAR('KJFK');

      expect(result).toBeNull();
    });
  });

  describe('getMETARHistory', () => {
    it('should return METAR history', async () => {
      const history = [
        {
          id: 1,
          airport_ident: 'KJFK',
          observation_time: new Date(),
          sky_condition: JSON.stringify([{ cover: 'OVC' }]),
        },
        {
          id: 2,
          airport_ident: 'KJFK',
          observation_time: new Date(),
          sky_condition: null,
        },
      ];

      (mockDb.manyOrNone as jest.Mock).mockResolvedValue(history);

      const result = await repository.getMETARHistory('KJFK', 24);

      expect(result).toHaveLength(2);
      expect(result[0].sky_condition).toEqual([{ cover: 'OVC' }]);
      expect(result[1].sky_condition).toBeNull();
    });

    it('should return empty array on error', async () => {
      (mockDb.manyOrNone as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await repository.getMETARHistory('KJFK', 24);

      expect(result).toEqual([]);
    });
  });

  describe('saveTAF', () => {
    it('should save TAF data', async () => {
      const taf: TAFData = {
        airport_ident: 'KJFK',
        issue_time: new Date(),
        valid_time_from: new Date(),
        valid_time_to: new Date(),
        raw_text: 'TAF KJFK',
        forecast_data: { remarks: 'Test' },
      };

      const saved = {
        id: 1,
        airport_ident: 'KJFK',
        issue_time: new Date(),
        valid_time_from: new Date(),
        valid_time_to: new Date(),
        raw_text: 'TAF KJFK',
        created_at: new Date(),
      };

      (mockDb.one as jest.Mock).mockResolvedValue(saved);

      const result = await repository.saveTAF(taf);

      expect(result).toEqual(saved);
      expect(mockDb.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO taf_forecasts'),
        expect.arrayContaining([
          'KJFK',
          expect.any(Date),
          expect.any(Date),
          expect.any(Date),
          'TAF KJFK',
          JSON.stringify({ remarks: 'Test' }),
        ]),
      );
    });
  });

  describe('getLatestTAF', () => {
    it('should return latest valid TAF', async () => {
      const taf = {
        id: 1,
        airport_ident: 'KJFK',
        issue_time: new Date(),
        valid_time_from: new Date(),
        valid_time_to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        raw_text: 'TAF KJFK',
        forecast_data: JSON.stringify({ remarks: 'Test' }),
      };

      (mockDb.oneOrNone as jest.Mock).mockResolvedValue(taf);

      const result = await repository.getLatestTAF('KJFK');

      expect(result).not.toBeNull();
      expect(result?.airport_ident).toBe('KJFK');
      expect(result?.forecast_data).toEqual({ remarks: 'Test' });
    });
  });

  describe('updateWeatherCache', () => {
    it('should update weather cache', async () => {
      (mockDb.none as jest.Mock).mockResolvedValue(undefined);

      await repository.updateWeatherCache('KJFK', 1, 2, 30);

      expect(mockDb.none).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO airport_weather_cache'),
        ['KJFK', 1, 2],
      );
    });
  });

  describe('getWeatherCache', () => {
    it('should return weather cache entry', async () => {
      const cache = {
        airport_ident: 'KJFK',
        latest_metar_id: 1,
        latest_taf_id: 2,
        last_updated: new Date(),
      };

      (mockDb.oneOrNone as jest.Mock).mockResolvedValue(cache);

      const result = await repository.getWeatherCache('KJFK');

      expect(result).toEqual(cache);
    });
  });

  describe('cleanupOldWeatherData', () => {
    it('should delete old weather data', async () => {
      (mockDb.result as jest.Mock).mockResolvedValue({ rowCount: 100 });

      const result = await repository.cleanupOldWeatherData(30);

      expect(result).toBe(100);
      expect(mockDb.result).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM metar_observations'),
      );
    });
  });
});
