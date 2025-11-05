/**
 * Flight history and trajectory type definitions
 */

export interface FlightHistoryDataPoint {
  latitude: number;
  longitude: number;
  baro_altitude?: number | null;
  geo_altitude?: number | null;
  velocity?: number | null;
  true_track?: number | null;
  vertical_rate?: number | null;
  squawk?: string | null;
  on_ground?: boolean;
  created_at: string;
}

export interface FlightHistory {
  icao24: string;
  callsign?: string | null;
  dataPoints: number;
  startTime: string;
  endTime: string;
  flightPath: FlightHistoryDataPoint[];
}

export interface FlightPathPoint {
  lat: number;
  lng: number;
  altitude?: number | null;
  geoAltitude?: number | null;
  velocity?: number | null;
  heading?: number | null;
  verticalRate?: number | null;
  squawk?: string | null;
  onGround?: boolean;
  timestamp: string;
}

export interface FlightPathResponse {
  icao24: string;
  callsign?: string | null;
  dataPoints: number;
  startTime: string;
  endTime: string;
  flightPath: FlightPathPoint[];
}

