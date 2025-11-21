export type PlaneCategory = 'airplane' | 'rotorcraft' | 'glider' | 'experimental' | 'other';

export type AirspeedUnit = 'knots' | 'mph';
export type LengthUnit = 'feet' | 'meters' | 'inches' | 'centimeters';
export type WeightUnit = 'pounds' | 'kilograms';
export type FuelUnit = 'gallons' | 'liters' | 'pounds' | 'kilograms';

export interface PlaneAvionicsEntry {
  manufacturer?: string | null;
  model?: string | null;
  name?: string | null;
}

export interface UserPlane {
  id: number;
  tailNumber: string;
  displayName: string | null;
  callsign: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  yearOfManufacture: number | null;
  aircraftType: string | null;
  category: PlaneCategory | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  homeAirportCode: string | null;
  airspeedUnit: AirspeedUnit;
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
  fuelUnit: FuelUnit;
  fuelType: string | null;
  engineType: string | null;
  engineCount: number | null;
  propConfiguration: string | null;
  avionics: PlaneAvionicsEntry[];
  defaultCruiseAltitude: number | null;
  serviceCeiling: number | null;
  cruiseSpeed: number | null;
  maxSpeed: number | null;
  stallSpeed: number | null;
  bestGlideSpeed: number | null;
  bestGlideRatio: number | null;
  emptyWeight: number | null;
  maxTakeoffWeight: number | null;
  maxLandingWeight: number | null;
  fuelCapacityTotal: number | null;
  fuelCapacityUsable: number | null;
  startTaxiFuel: number | null;
  fuelBurnPerHour: number | null;
  operatingCostPerHour: number | null;
  totalFlightHours: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlaneRequest {
  tailNumber: string;
  displayName?: string | null;
  callsign?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  yearOfManufacture?: number | string | null;
  aircraftType?: string | null;
  category?: PlaneCategory | string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  homeAirportCode?: string | null;
  airspeedUnit?: AirspeedUnit | string | null;
  lengthUnit?: LengthUnit | string | null;
  weightUnit?: WeightUnit | string | null;
  fuelUnit?: FuelUnit | string | null;
  fuelType?: string | null;
  engineType?: string | null;
  engineCount?: number | string | null;
  propConfiguration?: string | null;
  avionics?: (PlaneAvionicsEntry | string)[];
  defaultCruiseAltitude?: number | string | null;
  serviceCeiling?: number | string | null;
  cruiseSpeed?: number | string | null;
  maxSpeed?: number | string | null;
  stallSpeed?: number | string | null;
  bestGlideSpeed?: number | string | null;
  bestGlideRatio?: number | string | null;
  emptyWeight?: number | string | null;
  maxTakeoffWeight?: number | string | null;
  maxLandingWeight?: number | string | null;
  fuelCapacityTotal?: number | string | null;
  fuelCapacityUsable?: number | string | null;
  startTaxiFuel?: number | string | null;
  fuelBurnPerHour?: number | string | null;
  operatingCostPerHour?: number | string | null;
  totalFlightHours?: number | string | null;
  notes?: string | null;
}
