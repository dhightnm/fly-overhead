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
  data_source?: 'opensky' | 'feeder' | 'flightaware' | string; // Data source from backend (opensky, feeder, etc.)
  feeder_id?: string | null; // Feeder ID if data is from a feeder
  source_priority?: number | null; // Priority of the data source (lower = higher priority)
  position_source?: 'websocket' | 'database' | 'manual' | 'search' | string; // Where this specific position came from
  data_age_seconds?: number | null; // How old the position data is in seconds
  last_update_age_seconds?: number | null; // Alias for data_age_seconds
  predicted?: boolean;
  prediction_confidence?: number;
  route?: Route | null; // Route data included from backend (if cached)
  
  // Development mode fields (when rate limited)
  isStale?: boolean; // True if data is older than normal threshold
  staleReason?: 'rate_limited' | string; // Why the data is stale
  ageMinutes?: number; // How old the data is in minutes
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
    category?: number | null;
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

