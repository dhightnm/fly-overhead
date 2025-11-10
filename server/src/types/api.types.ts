/**
 * API request and response type definitions
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
}

export interface AircraftBoundsRequest {
  latmin: number;
  lonmin: number;
  latmax: number;
  lonmax: number;
}

export interface AircraftBoundsResponse {
  aircraft: any[];
  count: number;
}

export interface RouteData {
  callsign?: string | null;
  icao24?: string | null;
  departureAirport?: {
    iata?: string | null;
    icao?: string | null;
    name?: string | null;
  };
  arrivalAirport?: {
    iata?: string | null;
    icao?: string | null;
    name?: string | null;
  };
  source?: string;
  aircraft?: {
    type?: string;
    model?: string;
  };
  aircraft_type?: string;
  aircraft_model?: string;
  flightData?: {
    scheduledDeparture?: number;
    scheduledArrival?: number;
    actualDeparture?: number;
    actualArrival?: number;
    firstSeen?: number;
    lastSeen?: number;
    duration?: number;
    filedEte?: number;
  };
  flightStatus?: string;
  registration?: string;
  route?: string;
  routeDistance?: number;
  baggageClaim?: string;
  gateOrigin?: string;
  gateDestination?: string;
  terminalOrigin?: string;
  terminalDestination?: string;
  actualRunwayOff?: Date | null;
  actualRunwayOn?: Date | null;
  progressPercent?: number;
  filedAirspeed?: number;
  blocked?: boolean;
  diverted?: boolean;
  cancelled?: boolean;
  departureDelay?: number;
  arrivalDelay?: number;
}

export interface AuthRequest {
  email: string;
  password?: string;
  googleId?: string;
}

export interface AuthResponse {
  user: {
    id: number;
    email: string;
    name: string;
    is_premium: boolean;
  };
  token?: string;
}

export interface FeederRegistrationRequest {
  feeder_id: string;
  api_key_hash: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, any>;
}

export interface ApiKeyCreateRequest {
  name: string;
  description?: string;
  userId?: number;
  scopes?: string[];
  expiresAt?: Date;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  database: {
    connected: boolean;
    latency?: number;
  };
  services?: Record<string, any>;
}

