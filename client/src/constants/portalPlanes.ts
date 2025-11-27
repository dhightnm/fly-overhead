import type {
  PlaneCategory,
  AirspeedUnit,
  LengthUnit,
  WeightUnit,
  FuelUnit,
} from '../types';

export type PlaneFormState = {
  tailNumber: string;
  displayName: string;
  callsign: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  yearOfManufacture: string;
  aircraftType: string;
  category: PlaneCategory;
  homeAirportCode: string;
  primaryColor: string;
  secondaryColor: string;
  airspeedUnit: AirspeedUnit;
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
  fuelUnit: FuelUnit;
  fuelType: string;
  engineType: string;
  engineCount: string;
  propConfiguration: string;
  avionicsText: string;
  defaultCruiseAltitude: string;
  serviceCeiling: string;
  cruiseSpeed: string;
  maxSpeed: string;
  stallSpeed: string;
  bestGlideSpeed: string;
  bestGlideRatio: string;
  emptyWeight: string;
  maxTakeoffWeight: string;
  maxLandingWeight: string;
  fuelCapacityTotal: string;
  fuelCapacityUsable: string;
  startTaxiFuel: string;
  fuelBurnPerHour: string;
  operatingCostPerHour: string;
  totalFlightHours: string;
  notes: string;
};

export const categoryOptions: { label: string; value: PlaneCategory }[] = [
  { label: 'Airplane', value: 'airplane' },
  { label: 'Rotorcraft', value: 'rotorcraft' },
  { label: 'Glider', value: 'glider' },
  { label: 'Experimental', value: 'experimental' },
  { label: 'Other', value: 'other' },
];

export const airspeedOptions: AirspeedUnit[] = ['knots', 'mph'];
export const lengthOptions: LengthUnit[] = ['feet', 'meters', 'inches', 'centimeters'];
export const weightOptions: WeightUnit[] = ['pounds', 'kilograms'];
export const fuelOptions: FuelUnit[] = ['gallons', 'liters', 'pounds', 'kilograms'];

export const getDefaultPlaneFormState = (): PlaneFormState => ({
  tailNumber: '',
  displayName: '',
  callsign: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  yearOfManufacture: '',
  aircraftType: '',
  category: 'airplane',
  homeAirportCode: '',
  primaryColor: '',
  secondaryColor: '',
  airspeedUnit: 'knots',
  lengthUnit: 'feet',
  weightUnit: 'pounds',
  fuelUnit: 'gallons',
  fuelType: '',
  engineType: '',
  engineCount: '',
  propConfiguration: '',
  avionicsText: '',
  defaultCruiseAltitude: '',
  serviceCeiling: '',
  cruiseSpeed: '',
  maxSpeed: '',
  stallSpeed: '',
  bestGlideSpeed: '',
  bestGlideRatio: '',
  emptyWeight: '',
  maxTakeoffWeight: '',
  maxLandingWeight: '',
  fuelCapacityTotal: '',
  fuelCapacityUsable: '',
  startTaxiFuel: '',
  fuelBurnPerHour: '',
  operatingCostPerHour: '',
  totalFlightHours: '',
  notes: '',
});
