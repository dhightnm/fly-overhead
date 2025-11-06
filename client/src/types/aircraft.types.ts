/**
 * Core aircraft and route type definitions
 */

export interface Aircraft {
  icao24: string;
  callsign?: string | null;
  latitude: number;
  longitude: number;
  baro_altitude?: number | null;
  geo_altitude?: number | null;
  velocity: number;
  true_track?: number | null;
  vertical_rate?: number | null;
  squawk?: string | null;
  on_ground?: boolean;
  category?: number | null;
  last_contact?: number | null;
  id?: string;
  type?: string | null;
  typecode?: string | null;
  type_code?: string | null;
  aircraft_type?: string | null;
  aircraft_model?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  source?: 'manual' | 'live' | 'websocket' | 'database' | string;
  predicted?: boolean;
  prediction_confidence?: number;
}

export interface Airport {
  icao?: string | null;
  iata?: string | null;
  name?: string | null;
  location?: {
    lat: number;
    lng: number;
  };
  inferred?: boolean;
}

export interface Route {
  icao24: string;
  callsign?: string | null;
  departureAirport?: Airport | null;
  arrivalAirport?: Airport | null;
  aircraft?: {
    model?: string | null;
    type?: string | null;
  } | null;
  aircraftCategory?: number | null;
  source?: string;
}

export interface FlightPlanRoute {
  icao24: string;
  callsign?: string | null;
  waypoints?: Array<{
    code: string;
    name?: string;
    type?: string;
    latitude: number;
    longitude: number;
  }>;
  routeString?: string;
  available?: boolean;
  message?: string;
}

export interface RouteAvailabilityStatus {
  available: boolean;
  message?: string;
}

export interface StarlinkSatellite {
  satid: number;
  satname: string;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  visibility: string;
  footprint: number;
  timestamp: number;
  daynum: number;
  solar_lat: number;
  solar_lon: number;
  units: string;
}

