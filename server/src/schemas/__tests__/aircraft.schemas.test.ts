import config from '../../config';
import { flightsQuerySchema, aircraftIdentifierSchema } from '../aircraft.schemas';

describe('aircraft schemas', () => {
  describe('flightsQuerySchema', () => {
    it('parses valid coordinates and coerces string inputs', () => {
      const parsed = flightsQuerySchema.parse({
        lat: '37.7749',
        lon: '-122.4194',
        radius: '150',
      });

      expect(parsed.lat).toBeCloseTo(37.7749);
      expect(parsed.lon).toBeCloseTo(-122.4194);
      expect(parsed.radius).toBe(150);
    });

    it('rejects lat/lon outside allowed ranges', () => {
      expect(() => flightsQuerySchema.parse({ lat: 200, lon: 0, radius: 50 })).toThrow();
      expect(() => flightsQuerySchema.parse({ lat: 45, lon: -500, radius: 50 })).toThrow();
    });

    it('rejects radius values larger than configured maximum', () => {
      const maxRadius = config.external.airplanesLive?.maxRadiusNm || 250;
      expect(() => flightsQuerySchema.parse({
        lat: 0,
        lon: 0,
        radius: maxRadius + 1,
      })).toThrow();
    });
  });

  describe('aircraftIdentifierSchema', () => {
    it('accepts alphanumeric identifiers', () => {
      const parsed = aircraftIdentifierSchema.parse({
        identifier: 'N123AB',
      });

      expect(parsed.identifier).toBe('N123AB');
    });

    it('rejects identifiers that are too short', () => {
      expect(() => aircraftIdentifierSchema.parse({ identifier: 'N1' })).toThrow();
    });
  });
});
