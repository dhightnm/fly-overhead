/**
 * Hook for managing route data (flight routes and flight plan routes)
 */
import { useCallback, useRef, useEffect, useState } from 'react';
import { aircraftService } from '../services';
import type { Aircraft, Route, FlightPlanRoute, RouteAvailabilityStatus } from '../types';

interface UseRouteDataReturn {
  routes: Record<string, Route>;
  flightPlanRoutes: Record<string, FlightPlanRoute>;
  routeAvailabilityStatus: Record<string, RouteAvailabilityStatus>;
  loadingRoutes: Set<string>;
  fetchRouteForAircraft: (plane: Aircraft, isPrefetch?: boolean, forceRefresh?: boolean) => Promise<Route | null>;
  fetchFlightPlanRoute: (plane: Aircraft) => Promise<FlightPlanRoute | null>;
  setRoute: (icao24: string, route: Route) => void; // Expose setter for preloaded routes
}

export const useRouteData = (): UseRouteDataReturn => {
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [flightPlanRoutes, setFlightPlanRoutes] = useState<Record<string, FlightPlanRoute>>({});
  const [routeAvailabilityStatus, setRouteAvailabilityStatus] = useState<
    Record<string, RouteAvailabilityStatus>
  >({});
  const [loadingRoutes, setLoadingRoutes] = useState<Set<string>>(new Set());

  // Track which routes are currently being fetched to prevent duplicate requests
  const fetchingRoutes = useRef(new Set<string>());
  const flightPlanRoutesRef = useRef<Record<string, FlightPlanRoute>>({});
  const routeAvailabilityStatusRef = useRef<Record<string, RouteAvailabilityStatus>>({});

  // Keep refs in sync with state
  useEffect(() => {
    flightPlanRoutesRef.current = flightPlanRoutes;
  }, [flightPlanRoutes]);

  useEffect(() => {
    routeAvailabilityStatusRef.current = routeAvailabilityStatus;
  }, [routeAvailabilityStatus]);

  // Fetch route for a single aircraft (on-demand when user clicks or hovers)
  const fetchRouteForAircraft = useCallback(
    async (plane: Aircraft, isPrefetch = false, forceRefresh = false): Promise<Route | null> => {
      // Check if cached route exists and is complete
      const cachedRoute = routes[plane.icao24];
      if (!forceRefresh && cachedRoute) {
        // If route is complete (has arrival and aircraft type), use cache
        const hasArrival = !!(cachedRoute.arrivalAirport?.icao || cachedRoute.arrivalAirport?.iata);
        const hasAircraftType = !!(cachedRoute.aircraft?.type || cachedRoute.aircraft?.model);
        const isComplete = hasArrival && hasAircraftType;

        if (isComplete) {
          console.log(`Using cached route for ${plane.callsign || plane.icao24}`, {
            hasArrival,
            hasAircraftType,
            source: cachedRoute.source,
          });
          return cachedRoute;
        } else {
          // Incomplete cached route - force refresh to get complete data
          console.log(`Cached route incomplete for ${plane.callsign || plane.icao24}, forcing refresh`, {
            hasArrival,
            hasAircraftType,
            source: cachedRoute.source,
          });
          forceRefresh = true; // Override to fetch fresh data
        }
      }

      // Skip if already fetching (return cached if available, otherwise null)
      if (fetchingRoutes.current.has(plane.icao24)) {
        return routes[plane.icao24] || null;
      }

      // Mark as loading
      fetchingRoutes.current.add(plane.icao24);
      if (!isPrefetch) {
        setLoadingRoutes((prev) => new Set(prev).add(plane.icao24));
        console.log(`Fetching route for ${plane.callsign || plane.icao24} (user-initiated)`);
      }

      try {
        const startTime = performance.now();
        const routeData = await aircraftService.getRoute(plane.icao24, plane.callsign);
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        
        // Cache the route data immediately (don't delay for loading animation)
        setRoutes((prev) => ({ ...prev, [plane.icao24]: routeData }));
        console.log(`✅ Fetched and cached route for ${plane.callsign || plane.icao24}`, {
          duration: `${duration}ms`,
          source: routeData.source,
          departure: routeData.departureAirport?.icao || routeData.departureAirport?.iata || 'N/A',
          arrival: routeData.arrivalAirport?.icao || routeData.arrivalAirport?.iata || 'N/A',
          hasDeparture: !!routeData.departureAirport?.icao,
          hasArrival: !!routeData.arrivalAirport?.icao,
          hasAircraft: !!routeData.aircraft?.type,
          model: routeData.aircraft?.model,
          type: routeData.aircraft?.type,
        });
        
        // Small delay AFTER caching to ensure UI updates before removing loading state
        if (!isPrefetch) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        
        return routeData;
      } catch (error) {
        console.error(`❌ Failed to fetch route for ${plane.callsign || plane.icao24}:`, error);
        return null;
      } finally {
        fetchingRoutes.current.delete(plane.icao24);
        if (!isPrefetch) {
          setLoadingRoutes((prev) => {
            const next = new Set(prev);
            next.delete(plane.icao24);
            return next;
          });
        }
      }
    },
    [routes]
  );

  // Fetch flight plan route for a single aircraft
  const fetchFlightPlanRoute = useCallback(
    async (plane: Aircraft): Promise<FlightPlanRoute | null> => {
      const cacheKey = `${plane.icao24}`;

      // Skip if we're already fetching this route
      if (fetchingRoutes.current.has(cacheKey)) {
        return flightPlanRoutesRef.current[plane.icao24] || null;
      }

      // Skip if we already have the flight plan route (and it's available)
      const existingRoute = flightPlanRoutesRef.current[plane.icao24];
      const existingStatus = routeAvailabilityStatusRef.current[plane.icao24];
      if (existingRoute && existingStatus?.available !== false) {
        return existingRoute;
      }

      // Mark as fetching
      fetchingRoutes.current.add(cacheKey);
      console.log(`Fetching flight plan route for ${plane.callsign || plane.icao24}`);

      try {
        const routeData = await aircraftService.getFlightPlanRoute(plane.icao24, plane.callsign);

        if (routeData) {
          // Check if route is available
          const isAvailable = routeData.available !== false && routeData.waypoints && routeData.waypoints.length > 0;

          // Update availability status
          setRouteAvailabilityStatus((prev) => ({
            ...prev,
            [plane.icao24]: {
              available: isAvailable,
              message: routeData.message || (isAvailable ? undefined : 'Flight route not available for this flight'),
            },
          }));

          // Store route data (available or not, for UI purposes)
          setFlightPlanRoutes((prev) => ({ ...prev, [plane.icao24]: routeData }));

          fetchingRoutes.current.delete(cacheKey);
          return routeData;
        }
      } catch (error: any) {
        // Handle 404 or other errors
        if (error.response?.status === 404 || error.response?.data?.available === false) {
          setRouteAvailabilityStatus((prev) => ({
            ...prev,
            [plane.icao24]: {
              available: false,
              message: error.response?.data?.message || 'Flight route not available for this flight',
            },
          }));
        } else {
          console.error(`Failed to fetch flight plan route for ${plane.callsign || plane.icao24}:`, error);
          setRouteAvailabilityStatus((prev) => ({
            ...prev,
            [plane.icao24]: {
              available: false,
              message: 'Failed to fetch flight route',
            },
          }));
        }
        fetchingRoutes.current.delete(cacheKey);
      }

      return null;
    },
    []
  );

  // Set route data (for preloaded routes from aircraft response)
  const setRoute = useCallback((icao24: string, route: Route) => {
    setRoutes((prev) => {
      // Only set if not already present (don't overwrite user-fetched routes)
      // This prevents stale preloaded routes from overwriting fresh API-fetched routes
      if (!prev[icao24]) {
        console.log(`Setting preloaded route for ${icao24}`, {
          hasDeparture: !!route.departureAirport?.icao,
          hasArrival: !!route.arrivalAirport?.icao,
          source: route.source,
        });
        return { ...prev, [icao24]: route };
      }
      return prev;
    });
  }, []);

  return {
    routes,
    flightPlanRoutes,
    routeAvailabilityStatus,
    loadingRoutes,
    fetchRouteForAircraft,
    fetchFlightPlanRoute,
    setRoute,
  };
};

