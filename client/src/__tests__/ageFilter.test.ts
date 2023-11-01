/**
 * Unit tests for age-based aircraft filtering logic
 * Tests the synchronization between backend poll interval and frontend filters
 */

import type { Aircraft } from '../types';

// Configuration constants (matching implementation)
const BACKEND_POLL_INTERVAL = 10 * 60; // 10 minutes in seconds
const MERGE_AGE_THRESHOLD = 12 * 60; // 12 minutes in seconds (20% buffer)
const VISIBILITY_AGE_THRESHOLD = 15 * 60; // 15 minutes in seconds (50% buffer)

/**
 * Simulates the merge logic from useMapEvents.ts
 * Determines if a plane should be preserved in the merged state
 */
function shouldPreservePlaneInMerge(
  plane: Partial<Aircraft>,
  currentTime: number
): boolean {
  if (!plane.last_contact) return true; // No timestamp = always keep
  
  const age = currentTime - plane.last_contact;
  return age <= MERGE_AGE_THRESHOLD;
}

/**
 * Simulates the visibility logic from Home.tsx
 * Determines if a plane should be displayed on the map
 */
function shouldDisplayPlane(
  plane: Partial<Aircraft>,
  currentTime: number,
  isSelected: boolean = false,
  isHighlighted: boolean = false,
  isManuallyAdded: boolean = false,
  isRotorcraft: boolean = false
): boolean {
  // Always show special cases
  if (isSelected || isHighlighted || isManuallyAdded || isRotorcraft) {
    return true;
  }

  // Check age threshold
  if (!plane.last_contact) return true; // No timestamp = always show
  
  const age = currentTime - plane.last_contact;
  return age <= VISIBILITY_AGE_THRESHOLD;
}

describe('Age-Based Aircraft Filtering', () => {
  describe('Merge Age Threshold (12 minutes)', () => {
    it('should preserve plane that is exactly at backend poll interval (10 min)', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - BACKEND_POLL_INTERVAL,
      };

      expect(shouldPreservePlaneInMerge(plane, currentTime)).toBe(true);
    });

    it('should preserve plane that is 11 minutes old', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (11 * 60),
      };

      expect(shouldPreservePlaneInMerge(plane, currentTime)).toBe(true);
    });

    it('should preserve plane at exactly 12 minutes (threshold)', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - MERGE_AGE_THRESHOLD,
      };

      expect(shouldPreservePlaneInMerge(plane, currentTime)).toBe(true);
    });

    it('should NOT preserve plane older than 12 minutes', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (MERGE_AGE_THRESHOLD + 1),
      };

      expect(shouldPreservePlaneInMerge(plane, currentTime)).toBe(false);
    });

    it('should preserve plane with no last_contact timestamp', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: undefined,
      };

      expect(shouldPreservePlaneInMerge(plane, currentTime)).toBe(true);
    });
  });

  describe('Visibility Age Threshold (15 minutes)', () => {
    it('should display plane that is 10 minutes old (backend poll interval)', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - BACKEND_POLL_INTERVAL,
      };

      expect(shouldDisplayPlane(plane, currentTime)).toBe(true);
    });

    it('should display plane that is 14 minutes old', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (14 * 60),
      };

      expect(shouldDisplayPlane(plane, currentTime)).toBe(true);
    });

    it('should display plane at exactly 15 minutes (threshold)', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - VISIBILITY_AGE_THRESHOLD,
      };

      expect(shouldDisplayPlane(plane, currentTime)).toBe(true);
    });

    it('should NOT display plane older than 15 minutes', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (VISIBILITY_AGE_THRESHOLD + 1),
      };

      expect(shouldDisplayPlane(plane, currentTime)).toBe(false);
    });

    it('should display plane with no last_contact timestamp', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: undefined,
      };

      expect(shouldDisplayPlane(plane, currentTime)).toBe(true);
    });
  });

  describe('Special Cases - Override Age Filter', () => {
    const currentTime = 1000000;
    const oldPlane: Partial<Aircraft> = {
      icao24: 'abc123',
      last_contact: currentTime - (20 * 60), // 20 minutes old (past threshold)
    };

    it('should display old plane if selected', () => {
      expect(shouldDisplayPlane(oldPlane, currentTime, true, false, false, false)).toBe(true);
    });

    it('should display old plane if highlighted', () => {
      expect(shouldDisplayPlane(oldPlane, currentTime, false, true, false, false)).toBe(true);
    });

    it('should display old plane if manually added (searched)', () => {
      expect(shouldDisplayPlane(oldPlane, currentTime, false, false, true, false)).toBe(true);
    });

    it('should display old plane if rotorcraft', () => {
      expect(shouldDisplayPlane(oldPlane, currentTime, false, false, false, true)).toBe(true);
    });

    it('should NOT display old plane if no special conditions apply', () => {
      expect(shouldDisplayPlane(oldPlane, currentTime, false, false, false, false)).toBe(false);
    });
  });

  describe('Buffer Verification', () => {
    it('merge threshold should provide at least 20% buffer over poll interval', () => {
      const bufferPercentage = ((MERGE_AGE_THRESHOLD - BACKEND_POLL_INTERVAL) / BACKEND_POLL_INTERVAL) * 100;
      expect(bufferPercentage).toBeGreaterThanOrEqual(20);
    });

    it('visibility threshold should provide at least 50% buffer over poll interval', () => {
      const bufferPercentage = ((VISIBILITY_AGE_THRESHOLD - BACKEND_POLL_INTERVAL) / BACKEND_POLL_INTERVAL) * 100;
      expect(bufferPercentage).toBeGreaterThanOrEqual(50);
    });

    it('visibility threshold should be greater than merge threshold', () => {
      expect(VISIBILITY_AGE_THRESHOLD).toBeGreaterThan(MERGE_AGE_THRESHOLD);
    });

    it('merge threshold should be greater than poll interval', () => {
      expect(MERGE_AGE_THRESHOLD).toBeGreaterThan(BACKEND_POLL_INTERVAL);
    });
  });

  describe('Edge Cases - Flickering Prevention', () => {
    it('plane at exactly poll interval should not flicker (merge)', () => {
      const currentTime = 1000000;
      const planeAtPollInterval: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - BACKEND_POLL_INTERVAL,
      };

      // Should be preserved through multiple merge cycles
      expect(shouldPreservePlaneInMerge(planeAtPollInterval, currentTime)).toBe(true);
      expect(shouldPreservePlaneInMerge(planeAtPollInterval, currentTime + 1)).toBe(true);
      expect(shouldPreservePlaneInMerge(planeAtPollInterval, currentTime + 60)).toBe(true);
    });

    it('plane at exactly poll interval should remain visible', () => {
      const currentTime = 1000000;
      const planeAtPollInterval: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - BACKEND_POLL_INTERVAL,
      };

      // Should remain visible through multiple render cycles
      expect(shouldDisplayPlane(planeAtPollInterval, currentTime)).toBe(true);
      expect(shouldDisplayPlane(planeAtPollInterval, currentTime + 1)).toBe(true);
      expect(shouldDisplayPlane(planeAtPollInterval, currentTime + 60)).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    it('DAL409 scenario: 11-minute-old data should remain visible', () => {
      const currentTime = 1762812800; // Example timestamp
      const dal409: Partial<Aircraft> = {
        icao24: 'a12c23',
        callsign: 'DAL409',
        last_contact: currentTime - (11 * 60), // 11 minutes old
      };

      expect(shouldDisplayPlane(dal409, currentTime)).toBe(true);
    });

    it('UAL143 scenario: 35-minute-old data should NOT be visible (unless searched)', () => {
      const currentTime = 1762812800;
      const ual143: Partial<Aircraft> = {
        icao24: 'a27c78',
        callsign: 'UAL143',
        last_contact: currentTime - (35 * 60), // 35 minutes old
      };

      expect(shouldDisplayPlane(ual143, currentTime)).toBe(false);
      expect(shouldDisplayPlane(ual143, currentTime, false, false, true)).toBe(true); // Should show if searched
    });

    it('OpenSky data gap: planes should survive 1.5 poll cycles before disappearing', () => {
      const currentTime = 1000000;
      const plane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (15 * 60), // Exactly at visibility threshold
      };

      // Should survive 1.5 poll cycles (15 min)
      expect(shouldDisplayPlane(plane, currentTime)).toBe(true);
      
      // But not longer
      const olderPlane: Partial<Aircraft> = {
        icao24: 'abc123',
        last_contact: currentTime - (15 * 60 + 1),
      };
      expect(shouldDisplayPlane(olderPlane, currentTime)).toBe(false);
    });
  });
});


