/**
 * Aircraft data service - handles all aircraft-related API calls
 */
import api from './api';
import type { Aircraft, Route, FlightPlanRoute, Bounds, StarlinkSatellite } from '../types';
import type { AirportSearchResult } from '../types';

class AircraftService {
  /**
   * Fetch aircraft in a geographic bounds
   */
  async getAircraftInBounds(bounds: Bounds): Promise<Aircraft[]> {
    const { southWest, northEast } = bounds;
    const response = await api.get<Aircraft[]>(
      `/api/area/${southWest.lat}/${southWest.lng}/${northEast.lat}/${northEast.lng}`
    );
    return response.data.map((plane) => ({
      ...plane,
      source: plane.source ?? 'database',
      position_source: 'database',
    }));
  }

  /**
   * Fetch route information for a specific aircraft
   */
  async getRoute(icao24: string, callsign?: string | null): Promise<Route> {
    const identifier = callsign || icao24;
    const response = await api.get<Route>(`/api/route/${identifier}`, {
      params: {
        icao24,
        callsign: callsign || undefined,
      },
    });
    return response.data;
  }

  /**
   * Fetch flight plan route for a specific aircraft
   */
  async getFlightPlanRoute(icao24: string, callsign?: string | null): Promise<FlightPlanRoute> {
    const identifier = callsign || icao24;
    const response = await api.get<FlightPlanRoute>(`/api/flightplan/${identifier}`, {
      params: {
        icao24,
        callsign: callsign || undefined,
      },
    });
    return response.data;
  }

  /**
   * Search for aircraft by ICAO24 or callsign
   */
  async searchAircraft(query: string): Promise<Aircraft | null> {
    try {
      const response = await api.get<Aircraft>(`/api/planes/${encodeURIComponent(query.trim())}`);
      return response.data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch Starlink satellites above a location
   */
  async getStarlinkSatellites(lat: number, lng: number, altitude: number = 0): Promise<StarlinkSatellite[]> {
    try {
      const response = await api.get<{ above: StarlinkSatellite[] }>(
        `/api/starlink/${lat}/${lng}/${altitude}/`
      );
      return response.data.above || [];
    } catch (error) {
      console.error('Error fetching Starlink data:', error);
      return [];
    }
  }

  /**
   * Fetch airports within bounds
   */
  async getAirportsInBounds(bounds: Bounds, limit: number = 150): Promise<AirportSearchResult[]> {
    try {
      const { southWest, northEast } = bounds;
      const response = await api.get<{ airports: AirportSearchResult[] }>(
        `/api/airports/bounds/${southWest.lat}/${southWest.lng}/${northEast.lat}/${northEast.lng}?limit=${limit}`
      );
      return response.data.airports || [];
    } catch (error) {
      console.error('Error fetching airport data:', error);
      return [];
    }
  }

  /**
   * Search airports by query string
   */
  async searchAirports(query: string, limit: number = 10): Promise<AirportSearchResult[]> {
    try {
      const response = await api.get<{ airports: AirportSearchResult[] }>(
        `/api/airports/search/${encodeURIComponent(query.trim())}?limit=${limit}`
      );
      return response.data.airports || [];
    } catch (error) {
      console.error('Error searching airports:', error);
      return [];
    }
  }
}

export const aircraftService = new AircraftService();

