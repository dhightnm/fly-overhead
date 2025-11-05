/**
 * Component that uses the useMapDataFetcher hook to handle map events and data fetching
 */
import React from 'react';
import { useMapDataFetcher } from '../../hooks/useMapEvents';
import type { Aircraft, StarlinkSatellite } from '../../types';
import type { AirportSearchResult } from '../../types';

interface MapDataFetcherProps {
  setUserPosition: (position: [number, number]) => void;
  setPlanes: React.Dispatch<React.SetStateAction<Aircraft[]>>;
  setStarlink: React.Dispatch<React.SetStateAction<StarlinkSatellite[]>>;
  setAirports: React.Dispatch<React.SetStateAction<AirportSearchResult[]>>;
  showAirports: boolean;
  websocketConnected: boolean;
  fetchDataRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

const MapDataFetcher: React.FC<MapDataFetcherProps> = ({
  setUserPosition,
  setPlanes,
  setStarlink,
  setAirports,
  showAirports,
  websocketConnected,
  fetchDataRef,
}) => {
  useMapDataFetcher({
    setUserPosition,
    setPlanes,
    setStarlink,
    setAirports,
    showAirports,
    websocketConnected,
    fetchDataRef,
  });

  return null;
};

export default MapDataFetcher;

