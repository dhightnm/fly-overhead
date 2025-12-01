/**
 * Aircraft data service - handles all aircraft-related API calls
 */
import api from "./api";
import type {
  Aircraft,
  Route,
  FlightPlanRoute,
  Bounds,
  StarlinkSatellite,
} from "../types";
import type { AirportSearchResult } from "../types";

class AircraftService {
  /**
   * Fetch aircraft in a geographic bounds
   * Uses /api/flights endpoint which fetches from airplanes.live with proper unit conversions
   */
  async getAircraftInBounds(bounds: Bounds): Promise<Aircraft[]> {
    const { southWest, northEast } = bounds;

    // Calculate center point and radius from bounds
    const centerLat = (southWest.lat + northEast.lat) / 2;
    const centerLng = (southWest.lng + northEast.lng) / 2;

    // Calculate approximate radius in nautical miles
    // Use Haversine formula for accurate distance
    const latDiff = Math.abs(northEast.lat - southWest.lat);
    const lngDiff = Math.abs(northEast.lng - southWest.lng);

    // Convert degrees to nautical miles (1 degree latitude ≈ 60 nm)
    // For longitude, adjust by latitude (cos factor)
    const latDistanceNm = latDiff * 60;
    const lngDistanceNm = lngDiff * 60 * Math.cos((centerLat * Math.PI) / 180);

    // Use the larger distance to ensure coverage, add 10% margin
    const radiusNm = Math.max(latDistanceNm, lngDistanceNm) * 0.6; // 0.6 accounts for diagonal

    // Clamp to max radius (250nm per airplanes.live API limit)
    const clampedRadius = Math.min(Math.ceil(radiusNm), 250);

    const response = await api.get<{ aircraft: Aircraft[] }>(
      "/api/aircraft/flights",
      {
        params: {
          lat: centerLat,
          lon: centerLng,
          radius: clampedRadius,
        },
      }
    );

    return (response.data.aircraft || []).map((plane) => ({
      ...plane,
      source: plane.source ?? "airplanes.live",
      position_source: "airplanes.live",
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
  async getFlightPlanRoute(
    icao24: string,
    callsign?: string | null
  ): Promise<FlightPlanRoute> {
    const identifier = callsign || icao24;
    const response = await api.get<FlightPlanRoute>(
      `/api/flightplan/${identifier}`,
      {
        params: {
          icao24,
          callsign: callsign || undefined,
        },
      }
    );
    return response.data;
  }

  /**
   * Search for aircraft by ICAO24 or callsign
   */
  async searchAircraft(query: string): Promise<Aircraft | null> {
    try {
      const response = await api.get<{ results: Aircraft[] }>(`/api/search`, {
        params: { q: query.trim() },
      });
      const first = response.data?.results?.[0];
      return first || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch Starlink satellites above a location
   */
  async getStarlinkSatellites(
    lat: number,
    lng: number,
    altitude: number = 0
  ): Promise<StarlinkSatellite[]> {
    try {
      const response = await api.get<{ above: StarlinkSatellite[] }>(
        `/api/aircraft/starlink/${lat}/${lng}/${altitude}/`
      );
      return response.data.above || [];
    } catch (error) {
      console.error("Error fetching Starlink data:", error);
      return [];
    }
  }

  /**
   * Fetch airports within bounds
   */
  async getAirportsInBounds(
    bounds: Bounds,
    limit: number = 150
  ): Promise<AirportSearchResult[]> {
    try {
      const { southWest, northEast } = bounds;
      const response = await api.get<{ airports: AirportSearchResult[] }>(
        `/api/airports/bounds/${southWest.lat}/${southWest.lng}/${northEast.lat}/${northEast.lng}?limit=${limit}`
      );
      return response.data.airports || [];
    } catch (error) {
      console.error("Error fetching airport data:", error);
      return [];
    }
  }

  /**
   * Search airports by query string
   */
  async searchAirports(
    query: string,
    limit: number = 10
  ): Promise<AirportSearchResult[]> {
    try {
      const response = await api.get<{ airports: AirportSearchResult[] }>(
        `/api/airports/search/${encodeURIComponent(
          query.trim()
        )}?limit=${limit}`
      );
      return response.data.airports || [];
    } catch (error) {
      console.error("Error searching airports:", error);
      return [];
    }
  }

  /**
   * Get airport by code (includes full runway and frequency data)
   */
  async getAirportByCode(code: string): Promise<AirportSearchResult | null> {
    try {
      const response = await api.get<AirportSearchResult>(
        `/api/airports/${code}`
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching airport:", error);
      return null;
    }
  }
}

export const aircraftService = new AircraftService();
