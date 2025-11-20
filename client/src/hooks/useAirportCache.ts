import { useState, useEffect, useCallback, useRef } from 'react';
import { aircraftService } from '../services';
import type { AirportSearchResult } from '../types';

interface QuadrantBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

// Divide world into 18 quadrants (6x3 grid)
const QUADRANTS: QuadrantBounds[] = [];
for (let latBand = 0; latBand < 3; latBand++) {
  for (let lonBand = 0; lonBand < 6; lonBand++) {
    QUADRANTS.push({
      latMin: -90 + latBand * 60,
      latMax: -90 + (latBand + 1) * 60,
      lonMin: -180 + lonBand * 60,
      lonMax: -180 + (lonBand + 1) * 60,
    });
  }
}

/**
 * Airport caching hook
 * Loads airports by quadrant and caches them in memory
 * This eliminates repeated API calls for static data
 */
export function useAirportCache() {
  const [airportCache] = useState<Map<string, AirportSearchResult[]>>(new Map());
  const loadingQuadrants = useRef<Set<string>>(new Set());

  const getQuadrantKey = useCallback((bounds: QuadrantBounds): string => {
    return `${bounds.latMin},${bounds.lonMin}`;
  }, []);

  const findQuadrantsForBounds = useCallback(
    (latMin: number, lonMin: number, latMax: number, lonMax: number): QuadrantBounds[] => {
      return QUADRANTS.filter((quad) => {
        // Check if quadrant intersects with current bounds
        return !(
          quad.latMax < latMin ||
          quad.latMin > latMax ||
          quad.lonMax < lonMin ||
          quad.lonMin > lonMax
        );
      });
    },
    []
  );

  const loadQuadrant = useCallback(
    async (quadrant: QuadrantBounds): Promise<void> => {
      const key = getQuadrantKey(quadrant);

      // Skip if already cached or loading
      if (airportCache.has(key) || loadingQuadrants.current.has(key)) {
        return;
      }

      loadingQuadrants.current.add(key);

      try {
        // Fetch all airports in this quadrant (high limit to get all airports)
        // Quadrants can be large (60x60 degrees), so we need a high limit
        // With prioritized ordering, important airports will be included first
        const airports = await aircraftService.getAirportsInBounds(
          {
            southWest: { lat: quadrant.latMin, lng: quadrant.lonMin },
            northEast: { lat: quadrant.latMax, lng: quadrant.lonMax },
          },
          50000 // High limit to get all airports in quadrant (prioritized ordering ensures important ones first)
        );

        airportCache.set(key, airports);
        console.log(`Loaded ${airports.length} airports for quadrant ${key}`);
      } catch (error) {
        console.error(`Error loading airports for quadrant ${key}:`, error);
      } finally {
        loadingQuadrants.current.delete(key);
      }
    },
    [airportCache, getQuadrantKey]
  );

  const getAirportsInBounds = useCallback(
    (latMin: number, lonMin: number, latMax: number, lonMax: number): AirportSearchResult[] => {
      const relevantQuadrants = findQuadrantsForBounds(latMin, lonMin, latMax, lonMax);

      // Trigger loading for any uncached quadrants (async, don't wait)
      relevantQuadrants.forEach((quad) => {
        const key = getQuadrantKey(quad);
        if (!airportCache.has(key) && !loadingQuadrants.current.has(key)) {
          loadQuadrant(quad);
        }
      });

      // Return cached airports filtered to current bounds
      const allAirports: AirportSearchResult[] = [];
      relevantQuadrants.forEach((quad) => {
        const key = getQuadrantKey(quad);
        const cached = airportCache.get(key);
        if (cached) {
          allAirports.push(...cached);
        }
      });

      // Filter to exact bounds
      return allAirports.filter(
        (airport) =>
          airport.latitude_deg >= latMin &&
          airport.latitude_deg <= latMax &&
          airport.longitude_deg >= lonMin &&
          airport.longitude_deg <= lonMax
      );
    },
    [airportCache, findQuadrantsForBounds, getQuadrantKey, loadQuadrant]
  );

  // Preload USA quadrants on mount (most common usage)
  useEffect(() => {
    const usaQuadrants = findQuadrantsForBounds(25, -125, 50, -65);
    usaQuadrants.forEach((quad) => loadQuadrant(quad));
  }, [findQuadrantsForBounds, loadQuadrant]);

  return { getAirportsInBounds };
}

