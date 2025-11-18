/**
 * Hook for handling Leaflet map events and data fetching
 */
import { useEffect, useCallback, useRef } from "react";
import { useMapEvents as useLeafletMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { aircraftService } from "../services";
import { mergePlaneRecords } from "../utils/aircraftMerge";
import type { Aircraft, StarlinkSatellite } from "../types";
import type { AirportSearchResult } from "../types";
import { useAirportCache } from "./useAirportCache";

interface UseMapEventsProps {
  setUserPosition: (position: [number, number]) => void;
  setPlanes: React.Dispatch<React.SetStateAction<Aircraft[]>>;
  setStarlink: React.Dispatch<React.SetStateAction<StarlinkSatellite[]>>;
  setAirports: React.Dispatch<React.SetStateAction<AirportSearchResult[]>>;
  showAirports: boolean;
  websocketConnected: boolean;
  fetchDataRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

export const useMapDataFetcher = ({
  setUserPosition,
  setPlanes,
  setStarlink,
  setAirports,
  showAirports,
  websocketConnected,
  fetchDataRef,
}: UseMapEventsProps) => {
  const mapRef = useRef<LeafletMap | null>(null);
  const hasInitiallyLoaded = useRef(false);
  const moveEndTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBoundsRef = useRef<string | null>(null);
  
  // Airport caching hook - loads airports by quadrant and caches them
  const { getAirportsInBounds: getCachedAirports } = useAirportCache();

  const fetchData = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const wrapBounds = map.wrapLatLngBounds(bounds);
    const center = map.getCenter();
    const seaLevel = 0;

    // Fetch plane data FIRST (most important)
    try {
      const southWest = wrapBounds.getSouthWest();
      const northEast = wrapBounds.getNorthEast();
      const aircraft = await aircraftService.getAircraftInBounds({
        southWest: { lat: southWest.lat, lng: southWest.lng },
        northEast: { lat: northEast.lat, lng: northEast.lng },
      });

      if (aircraft) {
        // Smart merge: only preserve recent planes, avoid accumulation
        setPlanes((prevPlanes) => {
          const currentTime = Math.floor(Date.now() / 1000);
          // Backend polls every 10 minutes, preserve planes for 30 minutes
          // This prevents flickering and shows planes even if update is delayed
          const MERGE_AGE_THRESHOLD = 40; 
          const maxAge = MERGE_AGE_THRESHOLD;

          const normalizedAircraft = aircraft.map((plane) => ({
            ...plane,
            source: plane.source ?? "database",
            predicted: plane.predicted === true,
          }));

          const existingPlanesMap = new Map(
            prevPlanes.map((p) => [p.icao24, p])
          );
          const newPlanesMap = new Map(
            normalizedAircraft.map((p) => [p.icao24, p])
          );

          // Merge new data with existing metadata
          const mergedPlanes = normalizedAircraft.map((newPlane) => {
            const existing = existingPlanesMap.get(newPlane.icao24);
            return mergePlaneRecords(existing, newPlane);
          });

          // Only preserve planes that:
          // 1. Are NOT in the new data
          // 2. Are less than 5 minutes old
          // 3. OR have valid position data
          const preservedPlanes = prevPlanes.filter((p) => {
            if (newPlanesMap.has(p.icao24)) return false; // Already in new data

            const isRecent =
              !p.last_contact || currentTime - p.last_contact <= maxAge;
            const hasPosition =
              p.latitude !== undefined && p.longitude !== undefined;

            return isRecent && hasPosition;
          });

          return [...mergedPlanes, ...preservedPlanes];
        });
      }
    } catch (error) {
      console.error("Error fetching plane data:", error);
      // Don't clear planes on error - preserve existing state
    }

    // Fetch starlink data SECOND (after planes loaded)
    try {
      const satellites = await aircraftService.getStarlinkSatellites(
        center.lat,
        center.lng,
        seaLevel
      );
      setStarlink(satellites);
    } catch (error) {
      console.error("Error fetching starlink data:", error);
      setStarlink([]);
    }

    // Get airports from cache (no API call needed - static data cached by quadrant)
    if (showAirports) {
      const southWest = wrapBounds.getSouthWest();
      const northEast = wrapBounds.getNorthEast();
      const cachedAirports = getCachedAirports(
        southWest.lat,
        southWest.lng,
        northEast.lat,
        northEast.lng
      );
      setAirports(cachedAirports);
    } else {
      setAirports([]);
    }
  }, [setPlanes, setStarlink, setAirports, showAirports, getCachedAirports]);

  // Expose fetchData to parent via ref
  useEffect(() => {
    if (fetchDataRef) {
      fetchDataRef.current = fetchData;
    }
  }, [fetchData, fetchDataRef]);

  const map = useLeafletMapEvents({
    load: () => {
      map.locate();
    },
    click: () => {},
    locationfound: (location) => {
      setUserPosition([location.latlng.lat, location.latlng.lng]);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: () => {
      if (moveEndTimerRef.current) {
        clearTimeout(moveEndTimerRef.current);
      }

      const currentBounds = map.getBounds();
      const boundsKey = `${currentBounds.getSouth().toFixed(2)},${currentBounds
        .getWest()
        .toFixed(2)},${currentBounds.getNorth().toFixed(2)},${currentBounds
        .getEast()
        .toFixed(2)}`;

      if (lastBoundsRef.current === boundsKey) {
        return;
      }

      lastBoundsRef.current = boundsKey;

      moveEndTimerRef.current = setTimeout(() => {
        fetchData();
      }, 300);
    },
  });

  mapRef.current = map;

  useEffect(() => {
    if (map && !hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      setTimeout(() => {
        fetchData();
        console.log("Initial aircraft data fetch triggered");
      }, 100);
    }
  }, [map, fetchData]);

  useEffect(() => {
    const pollInterval = websocketConnected ? 30 * 1000 : 15 * 1000;

    const interval = setInterval(() => {
      if (mapRef.current) {
        fetchData();
        console.log(
          `Data fetched on interval (${
            websocketConnected ? "WebSocket" : "polling"
          } mode)`
        );
      }
    }, pollInterval);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websocketConnected]);

  return null;
};
