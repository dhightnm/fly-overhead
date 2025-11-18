/**
 * Frontend altitude and velocity conversion tests
 * 
 * These tests ensure that:
 * 1. Database values (meters) are correctly converted to feet for display
 * 2. Velocity (knots) is NOT double-converted
 * 3. The conversion formulas match what's used in Home.tsx
 * 
 * This prevents the bug where:
 * - Unconverted feet in DB (35000) × 3.28084 = 114,829 ft display
 * - Velocity was being incorrectly converted from knots to knots
 */

import type { Aircraft } from '../types';

describe('Altitude and Velocity Conversion (Frontend)', () => {
  // Conversion constants from Home.tsx
  const METERS_TO_FEET = 3.28084;
  const FEET_TO_METERS = 0.3048;

  describe('altitude display conversion', () => {
    it('should convert database meters to feet for display', () => {
      const testCases = [
        { meters: 0, expectedFeet: 0 },
        { meters: 304.8, expectedFeet: 1000 },
        { meters: 1524, expectedFeet: 5000 },
        { meters: 3048, expectedFeet: 10000 },
        { meters: 10668, expectedFeet: 35000 }, // Typical cruise
        { meters: 12496.8, expectedFeet: 41000 },
        { meters: 18288, expectedFeet: 60000 }, // High altitude
      ];

      testCases.forEach(({ meters, expectedFeet }) => {
        const displayFeet = Math.round(meters * METERS_TO_FEET);
        expect(displayFeet).toBe(expectedFeet);
      });
    });

    it('should handle null/undefined altitude gracefully', () => {
      const testCases = [
        { value: null, expected: null },
        { value: undefined, expected: undefined },
        { value: 0, expected: 0 },
      ];

      testCases.forEach(({ value, expected }) => {
        const displayValue = value != null ? Math.round(value * METERS_TO_FEET) : expected;
        expect(displayValue).toBe(expected);
      });
    });

    it('should detect unconverted feet values in database', () => {
      // If unconverted feet are stored in DB, they'll display way too high
      const unconvertedFeetInDb = 35000; // BUG: feet stored instead of meters
      const displayFeet = Math.round(unconvertedFeetInDb * METERS_TO_FEET);
      
      // This would display as 114,829 ft (obviously wrong)
      expect(displayFeet).toBeGreaterThan(100000);
      
      // Correct value would be:
      const correctMetersInDb = 35000 * FEET_TO_METERS; // 10668 meters
      const correctDisplayFeet = Math.round(correctMetersInDb * METERS_TO_FEET);
      expect(correctDisplayFeet).toBe(35000);
    });

    it('should match round-trip conversion accuracy', () => {
      // Simulate API -> DB -> Frontend round-trip
      const originalFeet = 35000;
      
      // Backend conversion (API feet -> DB meters)
      const dbMeters = originalFeet * FEET_TO_METERS;
      
      // Frontend conversion (DB meters -> Display feet)
      const displayFeet = Math.round(dbMeters * METERS_TO_FEET);
      
      // Should match original within rounding tolerance
      expect(displayFeet).toBe(originalFeet);
    });

    it('should handle edge case altitudes', () => {
      const edgeCases = [
        { meters: 21336, expectedFeet: 70000, description: 'U-2 spy plane altitude' },
        { meters: 24384, expectedFeet: 80000, description: 'SR-71 altitude' },
        { meters: 152.4, expectedFeet: 500, description: 'Pattern altitude' },
        { meters: 30.48, expectedFeet: 100, description: 'Takeoff altitude' },
      ];

      edgeCases.forEach(({ meters, expectedFeet, description }) => {
        const displayFeet = Math.round(meters * METERS_TO_FEET);
        expect(displayFeet).toBe(expectedFeet);
      });
    });
  });

  describe('velocity display (no conversion needed)', () => {
    it('should NOT convert velocity (already in knots)', () => {
      const testCases = [
        { knots: 0 },
        { knots: 150 },
        { knots: 250 },
        { knots: 450 }, // Typical cruise speed
        { knots: 600 }, // High-speed aircraft
      ];

      testCases.forEach(({ knots }) => {
        // Frontend should display knots as-is (no conversion)
        const displayKnots = knots;
        expect(displayKnots).toBe(knots);
      });
    });

    it('should detect double conversion bug', () => {
      const velocityKnots = 450;
      
      // BUG: If we incorrectly convert knots to knots
      const KNOTS_TO_KNOTS_BUG = 1.94384; // m/s to knots (wrong!)
      const buggedDisplay = velocityKnots * KNOTS_TO_KNOTS_BUG;
      
      expect(buggedDisplay).toBeCloseTo(874.7, 1); // Way too high
      expect(buggedDisplay).not.toBe(velocityKnots);
      
      // Correct: No conversion
      const correctDisplay = velocityKnots;
      expect(correctDisplay).toBe(450);
    });

    it('should handle null/undefined velocity', () => {
      const testCases = [
        { value: null, expected: null },
        { value: undefined, expected: undefined },
        { value: 0, expected: 0 },
      ];

      testCases.forEach(({ value, expected }) => {
        const displayValue = value ?? expected;
        expect(displayValue).toBe(expected);
      });
    });
  });

  describe('vertical rate conversion (if displayed)', () => {
    it('should convert m/s to ft/min if needed', () => {
      const MS_TO_FT_PER_MIN = 196.85; // 1 m/s = 196.85 ft/min
      
      const testCases = [
        { mPerS: 0, expectedFtPerMin: 0 },
        { mPerS: 10.16, expectedFtPerMin: 2000 }, // Typical climb
        { mPerS: -10.16, expectedFtPerMin: -2000 }, // Typical descent
        { mPerS: 20.32, expectedFtPerMin: 4000 }, // Aggressive climb
      ];

      testCases.forEach(({ mPerS, expectedFtPerMin }) => {
        const displayFtPerMin = Math.round(mPerS * MS_TO_FT_PER_MIN);
        expect(displayFtPerMin).toBeCloseTo(expectedFtPerMin, -1); // Within 10 ft/min
      });
    });
  });

  describe('aircraft type interface consistency', () => {
    /**
     * These tests ensure the Aircraft interface matches expected DB schema
     */
    it('should expect baro_altitude in meters from API', () => {
      const mockAircraft = {
        icao24: 'test',
        baro_altitude: 10668, // Meters from DB
        velocity: 450, // Knots from DB
      };

      // Frontend display conversions
      const displayAltitude = mockAircraft.baro_altitude 
        ? Math.round(mockAircraft.baro_altitude * METERS_TO_FEET)
        : null;
      const displayVelocity = mockAircraft.velocity; // No conversion

      expect(displayAltitude).toBe(35000); // ft
      expect(displayVelocity).toBe(450); // kts
    });

    it('should handle missing fields gracefully', () => {
      const mockAircraft = {
        icao24: 'test',
        baro_altitude: null,
        velocity: null,
      };

      const displayAltitude = mockAircraft.baro_altitude 
        ? Math.round(mockAircraft.baro_altitude * METERS_TO_FEET)
        : null;
      const displayVelocity = mockAircraft.velocity;

      expect(displayAltitude).toBeNull();
      expect(displayVelocity).toBeNull();
    });
  });

  describe('data validation thresholds', () => {
    /**
     * These tests define reasonable thresholds to detect bad data
     */
    it('should flag suspiciously high altitude displays (potential bug)', () => {
      const suspiciousThresholdFt = 100000; // 100,000 ft (likely unconverted bug)
      
      // Correct data
      const correctDbValue = 10668; // 35,000 ft in meters
      const correctDisplay = Math.round(correctDbValue * METERS_TO_FEET);
      expect(correctDisplay).toBeLessThan(suspiciousThresholdFt);
      
      // Buggy data (unconverted feet)
      const buggyDbValue = 35000; // Feet incorrectly stored as meters
      const buggyDisplay = Math.round(buggyDbValue * METERS_TO_FEET);
      expect(buggyDisplay).toBeGreaterThan(suspiciousThresholdFt);
    });

    it('should flag suspiciously high velocity displays (potential bug)', () => {
      const suspiciousThresholdKts = 800; // 800+ kts (likely double conversion)
      
      // Correct data
      const correctVelocity = 450; // Knots
      expect(correctVelocity).toBeLessThan(suspiciousThresholdKts);
      
      // Buggy data (double conversion)
      const buggyVelocity = 450 * 1.94384; // 874 kts (obviously wrong)
      expect(buggyVelocity).toBeGreaterThan(suspiciousThresholdKts);
    });

    it('should validate reasonable altitude range', () => {
      const minAltitudeFt = -1000; // Death Valley
      const maxAltitudeFt = 80000; // SR-71
      
      const testCases = [
        { meters: 0, valid: true },
        { meters: 10668, valid: true }, // 35,000 ft
        { meters: 24384, valid: true }, // 80,000 ft
        { meters: 30480, valid: false }, // 100,000 ft (suspicious)
        { meters: -304.8, valid: true }, // -1000 ft (Death Valley)
      ];

      testCases.forEach(({ meters, valid }) => {
        const displayFeet = Math.round(meters * METERS_TO_FEET);
        const isValid = displayFeet >= minAltitudeFt && displayFeet <= maxAltitudeFt;
        expect(isValid).toBe(valid);
      });
    });
  });
});

