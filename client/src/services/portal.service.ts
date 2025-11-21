/**
 * Portal service - handles all portal-related API calls
 */
import api from './api';
import type { Aircraft, UserPlane, CreatePlaneRequest, PlaneAvionicsEntry } from '../types';

export interface Feeder {
  feeder_id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface PortalStats {
  totalAircraft: number;
  activeFeeders: number;
  totalApiKeys: number;
  recentAircraft: number;
}

export interface UserFeedersResponse {
  feeders: Feeder[];
}

export interface UserAircraftResponse {
  aircraft: Aircraft[];
  total: number;
}

export interface PortalStatsResponse {
  stats: PortalStats;
}

interface PlaneProfileApiModel {
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
  avionics: PlaneAvionicsEntry[] | null;
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
  created_at: string;
  updated_at: string;
}

export interface UserPlanesResponse {
  planes: PlaneProfileApiModel[];
}

export interface CreatePlaneResponse {
  plane: PlaneProfileApiModel;
}

const mapPlaneFromApi = (plane: PlaneProfileApiModel): UserPlane => ({
  id: plane.id,
  tailNumber: plane.tail_number,
  displayName: plane.display_name,
  callsign: plane.callsign,
  serialNumber: plane.serial_number,
  manufacturer: plane.manufacturer,
  model: plane.model,
  yearOfManufacture: plane.year_of_manufacture,
  aircraftType: plane.aircraft_type,
  category: plane.category as UserPlane['category'],
  primaryColor: plane.primary_color,
  secondaryColor: plane.secondary_color,
  homeAirportCode: plane.home_airport_code,
  airspeedUnit: plane.airspeed_unit,
  lengthUnit: plane.length_unit,
  weightUnit: plane.weight_unit,
  fuelUnit: plane.fuel_unit,
  fuelType: plane.fuel_type,
  engineType: plane.engine_type,
  engineCount: plane.engine_count,
  propConfiguration: plane.prop_configuration,
  avionics: Array.isArray(plane.avionics) ? plane.avionics : [],
  defaultCruiseAltitude: plane.default_cruise_altitude,
  serviceCeiling: plane.service_ceiling,
  cruiseSpeed: plane.cruise_speed,
  maxSpeed: plane.max_speed,
  stallSpeed: plane.stall_speed,
  bestGlideSpeed: plane.best_glide_speed,
  bestGlideRatio: plane.best_glide_ratio,
  emptyWeight: plane.empty_weight,
  maxTakeoffWeight: plane.max_takeoff_weight,
  maxLandingWeight: plane.max_landing_weight,
  fuelCapacityTotal: plane.fuel_capacity_total,
  fuelCapacityUsable: plane.fuel_capacity_usable,
  startTaxiFuel: plane.start_taxi_fuel,
  fuelBurnPerHour: plane.fuel_burn_per_hour,
  operatingCostPerHour: plane.operating_cost_per_hour,
  totalFlightHours: plane.total_flight_hours,
  notes: plane.notes,
  createdAt: plane.created_at,
  updatedAt: plane.updated_at,
});

class PortalService {
  /**
   * Get user's associated feeders
   */
  async getUserFeeders(): Promise<Feeder[]> {
    const response = await api.get<UserFeedersResponse>('/api/portal/feeders');
    return response.data.feeders;
  }

  /**
   * Get aircraft from user's feeders
   */
  async getUserAircraft(limit?: number, offset?: number): Promise<UserAircraftResponse> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    
    const response = await api.get<UserAircraftResponse>(
      `/api/portal/aircraft?${params.toString()}`
    );
    return response.data;
  }

  /**
   * Get portal statistics
   */
  async getPortalStats(): Promise<PortalStats> {
    const response = await api.get<PortalStatsResponse>('/api/portal/stats');
    return response.data.stats;
  }

  /**
   * Get the current user's saved aircraft profiles
   */
  async getUserPlanes(): Promise<UserPlane[]> {
    const response = await api.get<UserPlanesResponse>('/api/portal/planes');
    return (response.data.planes || []).map(mapPlaneFromApi);
  }

  /**
   * Create a new aircraft profile for the user
   */
  async createUserPlane(payload: CreatePlaneRequest): Promise<UserPlane> {
    const response = await api.post<CreatePlaneResponse>('/api/portal/planes', payload);
    return mapPlaneFromApi(response.data.plane);
  }

  /**
   * Update an existing aircraft profile
   */
  async updateUserPlane(planeId: number, payload: CreatePlaneRequest): Promise<UserPlane> {
    const response = await api.put<CreatePlaneResponse>(`/api/portal/planes/${planeId}`, payload);
    return mapPlaneFromApi(response.data.plane);
  }
}

export const portalService = new PortalService();
