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
      // Return cached route if available and not forcing refresh
      if (!forceRefresh && routes[plane.icao24]) {
        console.log(`Using cached route for ${plane.callsign || plane.icao24}`);
        return routes[plane.icao24];
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
        // Add a small delay to ensure loading state is visible
        // This helps users see the loading animation even for fast API calls
        if (!isPrefetch) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        
        const routeData = await aircraftService.getRoute(plane.icao24, plane.callsign);
        // Cache the route data
        setRoutes((prev) => ({ ...prev, [plane.icao24]: routeData }));
        console.log(`Cached route for ${plane.callsign || plane.icao24}`);
        return routeData;
      } catch (error) {
        console.error(`Failed to fetch route for ${plane.callsign || plane.icao24}:`, error);
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
      if (!prev[icao24]) {
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

