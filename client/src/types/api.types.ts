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
  ident?: string | null; // ICAO code (primary identifier)
  gps_code?: string | null; // ICAO code (GPS code, used for weather API)
  icao?: string | null; // Alternative ICAO field
  iata?: string | null;
  iata_code?: string | null; // IATA code from database
  name?: string;
  latitude_deg?: number;
  longitude_deg?: number;
  elevation_ft?: number;
  municipality?: string;
  country?: string;
  type?: string;
  runways?: Array<{
    runway_id?: number;
    length_ft?: number;
    width_ft?: number;
    surface?: string;
    lighted?: boolean;
    closed?: boolean;
    low_end?: {
      ident?: string;
      latitude_deg?: number;
      longitude_deg?: number;
      elevation_ft?: number;
      heading_degT?: number;
      displaced_threshold_ft?: number;
    };
    high_end?: {
      ident?: string;
      latitude_deg?: number;
      longitude_deg?: number;
      elevation_ft?: number;
      heading_degT?: number;
      displaced_threshold_ft?: number;
    };
  }>;
  frequencies?: Array<{
    frequency_id?: number;
    type?: string;
    description?: string;
    frequency_mhz?: number;
  }>;
}

