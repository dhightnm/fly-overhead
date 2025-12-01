import { decodeMETAR, decodeTAF } from '../weatherDecoder';
import type { METARData, TAFData } from '../../repositories/WeatherRepository';

describe('weatherDecoder', () => {
  describe('decodeMETAR', () => {
    it('returns null when metar is null', () => {
      expect(decodeMETAR(null)).toBeNull();
    });

    it('produces friendly strings from METAR data', () => {
      const metar: METARData = {
        airport_ident: 'KTEST',
        observation_time: new Date(),
        raw_text: 'KTEST 011200Z 22012G20KT 10SM FEW020 SCT050 20/15 A2992',
        temperature_c: null,
        dewpoint_c: null,
        wind_dir_deg: null,
        wind_speed_kt: null,
        wind_gust_kt: null,
        visibility_statute_mi: null,
        altim_in_hg: null,
        sea_level_pressure_mb: null,
        sky_condition: [
          { cover: 'FEW', base: 20 },
          { cover: 'SCT', base: 50 },
        ],
        flight_category: 'VFR',
        metar_type: 'METAR',
        elevation_m: 1000,
      };

      const decoded = decodeMETAR(metar);

      expect(decoded).not.toBeNull();
      if (!decoded) return;

      expect(decoded.temperature).toBe('+20°C');
      expect(decoded.dewpoint).toBe('+15°C');
      expect(decoded.wind).toContain('220');
      expect(decoded.wind).toContain('12');
      expect(decoded.visibility).toBe('10.0 mi');
      expect(decoded.altimeter).toBe('29.92 inHg');
      expect(decoded.clouds.length).toBeGreaterThan(0);
      expect(decoded.flightCategoryLabel).toContain('VFR');
      expect(decoded.summary).toContain('Temp');
    });
  });

  describe('decodeTAF', () => {
    it('returns null when taf is null', () => {
      expect(decodeTAF(null)).toBeNull();
    });

    it('produces a basic summary and valid period', () => {
      const now = new Date();
      const later = new Date(now.getTime() + 6 * 60 * 60 * 1000);

      const taf: TAFData = {
        airport_ident: 'KTEST',
        issue_time: now,
        valid_time_from: now,
        valid_time_to: later,
        raw_text: 'TAF KTEST 011130Z 0112/0212 22010KT P6SM FEW020',
      };

      const decoded = decodeTAF(taf);

      expect(decoded).not.toBeNull();
      if (!decoded) return;

      expect(decoded.validPeriod).toContain('to');
      expect(decoded.summary).toContain('TAF KTEST');
    });
  });
});
