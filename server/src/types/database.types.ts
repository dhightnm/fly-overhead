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
  is_feeder_provider: boolean;
  is_efb: boolean;
  is_api: boolean;
  stripe_customer_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserAircraftProfile {
  id: number;
  user_id: number;
  tail_number: string;
  display_name: string | null;
  callsign: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  year_of_manufacture: number | null;
  aircraft_type: string | null;
  category: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  home_airport_code: string | null;
  airspeed_unit: 'knots' | 'mph';
  length_unit: 'feet' | 'meters' | 'inches' | 'centimeters';
  weight_unit: 'pounds' | 'kilograms';
  fuel_unit: 'gallons' | 'liters' | 'pounds' | 'kilograms';
  fuel_type: string | null;
  engine_type: string | null;
  engine_count: number | null;
  prop_configuration: string | null;
  avionics: any[];
  default_cruise_altitude: number | null;
  service_ceiling: number | null;
  cruise_speed: number | null;
  max_speed: number | null;
  stall_speed: number | null;
  best_glide_speed: number | null;
  best_glide_ratio: number | null;
  empty_weight: number | null;
  max_takeoff_weight: number | null;
  max_landing_weight: number | null;
  fuel_capacity_total: number | null;
  fuel_capacity_usable: number | null;
  start_taxi_fuel: number | null;
  fuel_burn_per_hour: number | null;
  operating_cost_per_hour: number | null;
  total_flight_hours: number | null;
  notes: string | null;
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

export interface WebhookSubscription {
  id: number;
  name: string;
  subscriber_id: string;
  callback_url: string;
  event_types: string[];
  signing_secret: string;
  status: 'active' | 'paused' | 'disabled';
  rate_limit_per_minute: number;
  delivery_max_attempts: number;
  delivery_backoff_ms: number;
  metadata?: Record<string, any> | null;
  last_success_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookEvent {
  event_id: string;
  event_type: string;
  payload: Record<string, any>;
  occurred_at: Date;
  version: string;
  created_at: Date;
}

export interface WebhookDelivery {
  delivery_id: string;
  event_id: string;
  subscription_id: number;
  status: 'pending' | 'delivering' | 'success' | 'failed';
  attempt_count: number;
  next_attempt_at: Date | null;
  last_attempt_at: Date | null;
  last_error: string | null;
  response_status: number | null;
  response_body: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Subscription {
  id: number;
  user_id: number;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string;
  product_type: 'flight_tracking' | 'efb' | 'api';
  tier_name: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  trial_start: Date | null;
  trial_end: Date | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentMethod {
  id: number;
  user_id: number;
  stripe_payment_method_id: string;
  stripe_customer_id: string;
  type: 'card' | 'bank_account';
  is_default: boolean;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  billing_details: Record<string, any> | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export interface Invoice {
  id: number;
  user_id: number;
  subscription_id: number | null;
  stripe_invoice_id: string;
  stripe_customer_id: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: Date | null;
  period_end: Date | null;
  paid_at: Date | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export interface StripeWebhookEvent {
  id: number;
  stripe_event_id: string;
  event_type: string;
  processed: boolean;
  processing_error: string | null;
  event_data: Record<string, any>;
  created_at: Date;
  processed_at: Date | null;
}
