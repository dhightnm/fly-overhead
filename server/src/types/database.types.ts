/**
 * Database model type definitions
 * These types represent the structure of data in PostgreSQL tables
 */

export interface AircraftState {
  id: number;
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  time_position: number | null;
  last_contact: number | null;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  sensors: number[] | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean | null;
  position_source: number | null;
  category: number | null;
  created_at: Date;
  geom?: any; // PostGIS geometry
  feeder_id?: string | null;
  ingestion_timestamp?: Date | null;
  data_source?: string | null;
  source_priority?: number | null;
}

export interface AircraftHistory extends AircraftState {
  // Same structure as AircraftState but for history table
}

export interface FlightRouteCache {
  id: number;
  cache_key: string;
  callsign: string | null;
  icao24: string | null;
  departure_iata: string | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_iata: string | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  source: string | null;
  aircraft_type: string | null;
  created_at: Date;
  last_used: Date;
}

export interface FlightRouteHistory {
  id: number;
  icao24: string | null;
  callsign: string | null;
  flight_key: string | null;
  route_key: string | null;
  aircraft_type: string | null;
  aircraft_model: string | null;
  departure_iata: string | null;
  departure_icao: string | null;
  departure_name: string | null;
  departure_city: string | null;
  departure_country: string | null;
  arrival_iata: string | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  arrival_city: string | null;
  arrival_country: string | null;
  source: string | null;
  first_seen: number | null;
  last_seen: number | null;
  scheduled_flight_start: Date | null;
  scheduled_flight_end: Date | null;
  actual_flight_start: Date | null;
  actual_flight_end: Date | null;
  scheduled_ete: number | null;
  actual_ete: number | null;
  registration: string | null;
  flight_status: string | null;
  route: string | null;
  route_distance: number | null;
  baggage_claim: string | null;
  gate_origin: string | null;
  gate_destination: string | null;
  terminal_origin: string | null;
  terminal_destination: string | null;
  actual_runway_off: Date | null;
  actual_runway_on: Date | null;
  progress_percent: number | null;
  filed_airspeed: number | null;
  blocked: boolean;
  diverted: boolean;
  cancelled: boolean;
  departure_delay: number | null;
  arrival_delay: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: number;
  email: string;
  google_id: string | null;
  password: string | null;
  name: string;
  picture: string | null;
  is_premium: boolean;
  premium_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Feeder {
  id: number;
  feeder_id: string;
  name: string | null;
  location: any | null; // PostGIS geography
  api_key_hash: string;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
  is_active: boolean;
  status?: string;
  latitude?: number;
  longitude?: number;
}

export interface FeederStats {
  id: number;
  feeder_id: string;
  timestamp: Date;
  messages_received: number;
  unique_aircraft: number;
  created_at: Date;
  date?: Date;
}

export interface ApiKey {
  id: number;
  key_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  description: string | null;
  user_id: number | null;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  last_used_at: Date | null;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  created_by: number | null;
  revoked_at: Date | null;
  revoked_by: number | null;
  revoked_reason: string | null;
}

export interface Airport {
  id: number;
  airport_id: number;
  ident: string;
  type: string;
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  elevation_ft: number | null;
  iso_country: string;
  iso_region: string;
  municipality: string | null;
  iata_code: string | null;
  gps_code: string | null;
  geom: any; // PostGIS geometry
  runways?: any;
  frequencies?: any;
  distance_km?: number;
}

export interface Navaid {
  id: number;
  navaid_id: number;
  filename: string;
  ident: string;
  name: string;
  type: string;
  frequency_khz: number | null;
  latitude_deg: number;
  longitude_deg: number;
  elevation_ft: number | null;
  iso_country: string;
  geom: any; // PostGIS geometry
  distance_km?: number;
}

