/**
 * API response and error type definitions
 */

export interface ApiError {
  message: string;
  error?: string;
  status?: number;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
    status?: number;
  };
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
}

export interface Bounds {
  southWest: {
    lat: number;
    lng: number;
  };
  northEast: {
    lat: number;
    lng: number;
  };
}

export interface AirportSearchResult {
  id?: number;
  icao?: string | null;
  iata?: string | null;
  name?: string;
  latitude_deg?: number;
  longitude_deg?: number;
  elevation_ft?: number;
  municipality?: string;
  country?: string;
  type?: string;
}

