/**
 * Hook for managing aircraft data state and operations
 */
import { useState, useCallback } from 'react';
import { aircraftService } from '../services';
import type { Aircraft } from '../types';

interface UseAircraftDataReturn {
  planes: Aircraft[];
  setPlanes: React.Dispatch<React.SetStateAction<Aircraft[]>>;
  searchAircraft: (query: string) => Promise<Aircraft | null>;
  updateAircraftCategory: (icao24: string, category: number) => void;
}

export const useAircraftData = (): UseAircraftDataReturn => {
  const [planes, setPlanes] = useState<Aircraft[]>([]);

  const searchAircraft = useCallback(async (query: string): Promise<Aircraft | null> => {
    if (!query || query.trim().length === 0) {
      return null;
    }

    try {
      const aircraft = await aircraftService.searchAircraft(query.trim());
      return aircraft;
    } catch (error) {
      console.error('Error searching for aircraft:', error);
      return null;
    }
  }, []);

  const updateAircraftCategory = useCallback((icao24: string, category: number) => {
    setPlanes((prevPlanes) =>
      prevPlanes.map((p) => (p.icao24 === icao24 ? { ...p, category } : p))
    );
  }, []);

  return {
    planes,
    setPlanes,
    searchAircraft,
    updateAircraftCategory,
  };
};

