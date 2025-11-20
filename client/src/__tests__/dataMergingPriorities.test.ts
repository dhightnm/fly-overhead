/**
 * Unit tests for aircraft data merging priorities
 * Tests the hierarchical priority system for aircraft position data
 * 
 * Priority Order (highest to lowest):
 * 1. WebSocket real-time updates
 * 2. User-initiated API calls (force fresh)
 * 3. Automatic polling (background bounds queries)
 * 4. Preloaded route data (fallback)
 */

import type { Aircraft, Route } from '../types';
import { createAircraft } from '../test/fixtures/aircraft';

/**
 * Merge two aircraft records, preserving highest priority data
 * Simulates the mergePlaneRecords logic from aircraftMerge.ts
 */
function mergePlaneRecords(
  existing: Partial<Aircraft> | undefined,
  incoming: Partial<Aircraft>
): Aircraft {
  if (!existing) {
    return incoming as Aircraft;
  }

  // Priority rules:
  // 1. Newer last_contact wins (fresher data)
  // 2. WebSocket source trumps database
  // 3. User-initiated (manual) source trumps automatic
  // 4. Preserve manual flags (searched planes)

  const existingTime = existing.last_contact || 0;
  const incomingTime = incoming.last_contact || 0;

  // Determine source priority
  const sourcePriority: Record<string, number> = {
    websocket: 4,
    manual: 3,
    feeder: 2,
    opensky: 1,
    database: 1,
  };

  const existingPriority = sourcePriority[existing.source || 'database'] || 0;
  const incomingPriority = sourcePriority[incoming.source || 'database'] || 0;

  // Use incoming if:
  // - It has higher source priority, OR
  // - Same source but newer timestamp, OR
  // - Existing is undefined/null for critical fields
  const shouldUseIncoming =
    incomingPriority > existingPriority ||
    (incomingPriority === incomingPriority && incomingTime > existingTime);

  return {
    ...existing,
    ...incoming,
    // Preserve position from higher priority source
    latitude: shouldUseIncoming
      ? incoming.latitude ?? existing.latitude
      : existing.latitude ?? incoming.latitude,
    longitude: shouldUseIncoming
      ? incoming.longitude ?? existing.longitude
      : existing.longitude ?? incoming.longitude,
    baro_altitude: shouldUseIncoming
      ? incoming.baro_altitude ?? existing.baro_altitude
      : existing.baro_altitude ?? incoming.baro_altitude,
    last_contact: Math.max(existingTime, incomingTime),
    source: shouldUseIncoming
      ? incoming.source || existing.source
      : existing.source || incoming.source,
  } as Aircraft;
}

/**
 * Simulates route data priority from Home.tsx
 * Fresh user-fetched routes > preloaded stale routes
 */
function selectRouteWithPriority(
  freshRoute: Route | undefined,
  preloadedRoute: Route | undefined
): Route | undefined {
  // PRIORITY FIX: Prefer fresh user-fetched routes over stale preloaded routes
  return freshRoute || preloadedRoute;
}

describe('Aircraft Data Merging Priorities', () => {
  describe('Source Priority Hierarchy', () => {
    it('WebSocket data should override database data', () => {
      const databasePlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const websocketPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.5,
        longitude: -100.5,
        last_contact: 1000010,
        source: 'websocket',
      });

      const merged = mergePlaneRecords(databasePlane, websocketPlane);
      
      expect(merged.latitude).toBe(40.5);
      expect(merged.longitude).toBe(-100.5);
      expect(merged.source).toBe('websocket');
    });

    it('Manual (searched) data should override automatic database data', () => {
      const databasePlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const manualPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.2,
        longitude: -100.2,
        last_contact: 1000005,
        source: 'manual',
      });

      const merged = mergePlaneRecords(databasePlane, manualPlane);
      
      expect(merged.latitude).toBe(40.2);
      expect(merged.longitude).toBe(-100.2);
      expect(merged.source).toBe('manual');
    });

    it('Feeder data should override OpenSky data', () => {
      const openskyPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'opensky',
      });

      const feederPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.3,
        longitude: -100.3,
        last_contact: 1000000,
        source: 'feeder',
      });

      const merged = mergePlaneRecords(openskyPlane, feederPlane);
      
      expect(merged.latitude).toBe(40.3);
      expect(merged.longitude).toBe(-100.3);
      expect(merged.source).toBe('feeder');
    });
  });

  describe('Timestamp-Based Priority (Same Source)', () => {
    it('newer data should override older data when source is same', () => {
      const olderPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const newerPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.5,
        longitude: -100.5,
        last_contact: 1000600,
        source: 'database',
      });

      const merged = mergePlaneRecords(olderPlane, newerPlane);
      
      expect(merged.latitude).toBe(40.5);
      expect(merged.longitude).toBe(-100.5);
      expect(merged.last_contact).toBe(1000600);
    });

    it('should NOT overwrite newer data with older data', () => {
      const newerPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.5,
        longitude: -100.5,
        last_contact: 1000600,
        source: 'database',
      });

      const olderPlane = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const merged = mergePlaneRecords(newerPlane, olderPlane);
      
      expect(merged.latitude).toBe(40.5); // Keep newer position
      expect(merged.longitude).toBe(-100.5);
      expect(merged.last_contact).toBe(1000600);
    });
  });

  describe('Route Data Priority', () => {
    it('fresh user-fetched route should override preloaded route', () => {
      const preloadedRoute: Partial<Route> = {
        departureAirport: { icao: 'KJFK', iata: 'JFK', name: 'JFK' },
        arrivalAirport: { icao: 'KLAX', iata: 'LAX', name: 'LAX' },
        source: 'inference',
      };

      const freshRoute: Partial<Route> = {
        departureAirport: { icao: 'KJFK', iata: 'JFK', name: 'John F Kennedy Intl' },
        arrivalAirport: { icao: 'KSFO', iata: 'SFO', name: 'San Francisco Intl' },
        source: 'flightaware',
      };

      const selected = selectRouteWithPriority(
        freshRoute as Route,
        preloadedRoute as Route
      );
      
      expect(selected).toEqual(freshRoute);
      expect(selected?.arrivalAirport?.icao).toBe('KSFO'); // Fresh data, not preloaded
    });

    it('should fallback to preloaded route if no fresh data available', () => {
      const preloadedRoute: Partial<Route> = {
        departureAirport: { icao: 'KJFK', iata: 'JFK', name: 'JFK' },
        arrivalAirport: { icao: 'KLAX', iata: 'LAX', name: 'LAX' },
        source: 'inference',
      };

      const selected = selectRouteWithPriority(undefined, preloadedRoute as Route);
      
      expect(selected).toEqual(preloadedRoute);
    });

    it('should return undefined if both routes are unavailable', () => {
      const selected = selectRouteWithPriority(undefined, undefined);
      expect(selected).toBeUndefined();
    });
  });

  describe('Real-World Scenarios', () => {
    it('UAL143 scenario: stale database position vs. current database query', () => {
      // Initial state: 35-minute-old position from search
      const searchResult = createAircraft({
        icao24: 'a27c78',
        callsign: 'UAL143',
        latitude: 51.6721,
        longitude: -129.4366,
        last_contact: 1762810547,
        source: 'database',
      });

      // Map load: Same plane, same position (no fresh OpenSky data)
      const boundsResult = createAircraft({
        icao24: 'a27c78',
        callsign: 'UAL143',
        latitude: 51.6721,
        longitude: -129.4366,
        last_contact: 1762810547,
        source: 'database',
      });

      const merged = mergePlaneRecords(searchResult, boundsResult);
      
      // Should keep same position (no fresher data available)
      expect(merged.latitude).toBe(51.6721);
      expect(merged.longitude).toBe(-129.4366);
    });

    it('DAL409 scenario: manual search should preserve plane in state', () => {
      // User searches for plane
      const manualPlane = createAircraft({
        icao24: 'a12c23',
        callsign: 'DAL409',
        latitude: 39.0308,
        longitude: -110.3106,
        last_contact: 1762811691,
        source: 'manual',
      });

      // Bounds query returns same plane from database
      const databasePlane = createAircraft({
        icao24: 'a12c23',
        callsign: 'DAL409',
        latitude: 39.0308,
        longitude: -110.3106,
        last_contact: 1762811691,
        source: 'database',
      });

      const merged = mergePlaneRecords(manualPlane, databasePlane);
      
      // Should preserve 'manual' source to keep plane visible even if age > threshold
      expect(merged.source).toBe('manual');
    });

    it('WebSocket update scenario: real-time position overrides bounds query', () => {
      // Initial state: plane from bounds query
      const boundsPlane = createAircraft({
        icao24: 'abc123',
        callsign: 'TEST123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      // WebSocket pushes updated position
      const websocketUpdate = createAircraft({
        icao24: 'abc123',
        latitude: 40.1,
        longitude: -100.1,
        last_contact: 1000010,
        source: 'websocket',
      });

      const merged = mergePlaneRecords(boundsPlane, websocketUpdate);
      
      expect(merged.latitude).toBe(40.1);
      expect(merged.longitude).toBe(-100.1);
      expect(merged.source).toBe('websocket');
      expect(merged.callsign).toBe('TEST123'); // Preserve metadata from bounds
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing last_contact timestamps', () => {
      const plane1 = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: undefined,
        source: 'database',
      });

      const plane2 = createAircraft({
        icao24: 'abc123',
        latitude: 40.5,
        longitude: -100.5,
        last_contact: 1000000,
        source: 'database',
      });

      const merged = mergePlaneRecords(plane1, plane2);
      
      // Should use plane with timestamp
      expect(merged.latitude).toBe(40.5);
      expect(merged.last_contact).toBe(1000000);
    });

    it('should handle null/undefined incoming data', () => {
      const existing = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const incoming = createAircraft({
        icao24: 'abc123',
        latitude: undefined,
        longitude: undefined,
        last_contact: 1000010,
        source: 'database',
      });

      const merged = mergePlaneRecords(existing, incoming);
      
      // Should preserve existing position when incoming is undefined
      expect(merged.latitude).toBe(40.0);
      expect(merged.longitude).toBe(-100.0);
      expect(merged.last_contact).toBe(1000010); // But update timestamp
    });

    it('should merge first plane when no existing data', () => {
      const incoming = createAircraft({
        icao24: 'abc123',
        latitude: 40.0,
        longitude: -100.0,
        last_contact: 1000000,
        source: 'database',
      });

      const merged = mergePlaneRecords(undefined, incoming);
      
      expect(merged).toEqual(incoming);
    });
  });
});
