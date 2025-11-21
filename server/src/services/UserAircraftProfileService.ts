import pgPromise from 'pg-promise';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import type { UserAircraftProfile } from '../types';

const AIRSPEED_UNITS = ['knots', 'mph'] as const;
const LENGTH_UNITS = ['feet', 'meters', 'inches', 'centimeters'] as const;
const WEIGHT_UNITS = ['pounds', 'kilograms'] as const;
const FUEL_UNITS = ['gallons', 'liters', 'pounds', 'kilograms'] as const;
const CATEGORY_VALUES = ['airplane', 'rotorcraft', 'glider', 'experimental', 'other'] as const;

type AirspeedUnit = typeof AIRSPEED_UNITS[number];
type LengthUnit = typeof LENGTH_UNITS[number];
type WeightUnit = typeof WEIGHT_UNITS[number];
type FuelUnit = typeof FUEL_UNITS[number];
type CategoryValue = typeof CATEGORY_VALUES[number];

export interface CreateUserAircraftProfileInput {
  tailNumber: string;
  displayName?: string | null;
  callsign?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  yearOfManufacture?: number | string | null;
  aircraftType?: string | null;
  category?: CategoryValue | string | null;
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
  avionics?: unknown;
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

interface NormalizedAircraftProfileData {
  tail_number: string;
  display_name: string | null;
  callsign: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  year_of_manufacture: number | null;
  aircraft_type: string | null;
  category: CategoryValue | null;
  primary_color: string | null;
  secondary_color: string | null;
  home_airport_code: string | null;
  airspeed_unit: AirspeedUnit;
  length_unit: LengthUnit;
  weight_unit: WeightUnit;
  fuel_unit: FuelUnit;
  fuel_type: string | null;
  engine_type: string | null;
  engine_count: number | null;
  prop_configuration: string | null;
  avionics: Array<{ manufacturer: string | null; model: string | null; name: string | null }>;
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
}

type NumericField =
  | 'default_cruise_altitude'
  | 'service_ceiling'
  | 'cruise_speed'
  | 'max_speed'
  | 'stall_speed'
  | 'best_glide_speed'
  | 'best_glide_ratio'
  | 'empty_weight'
  | 'max_takeoff_weight'
  | 'max_landing_weight'
  | 'fuel_capacity_total'
  | 'fuel_capacity_usable'
  | 'start_taxi_fuel'
  | 'fuel_burn_per_hour'
  | 'operating_cost_per_hour'
  | 'total_flight_hours';

export class PlaneProfileValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PlaneProfileValidationError';
    this.statusCode = statusCode;
  }
}

class UserAircraftProfileService {
  private db: pgPromise.IDatabase<any>;

  constructor(db?: pgPromise.IDatabase<any>) {
    this.db = db || postgresRepository.getDb();
  }

  private sanitizeString(value: unknown, { uppercase = false }: { uppercase?: boolean } = {}): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return uppercase ? trimmed.toUpperCase() : trimmed;
  }

  private sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase() as T;
      if ((allowed as readonly string[]).includes(normalized)) {
        return normalized as T;
      }
    }
    return fallback;
  }

  private sanitizeNullableEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.toLowerCase() as T;
    return (allowed as readonly string[]).includes(normalized) ? normalized : null;
  }

  private parseNullableNumber(value: unknown, { allowNegative = false }: { allowNegative?: boolean } = {}): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const num = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : null;

    if (num === null || Number.isNaN(num) || !Number.isFinite(num)) {
      return null;
    }

    if (!allowNegative && num < 0) {
      throw new PlaneProfileValidationError('Numeric values must be zero or positive');
    }

    return num;
  }

  private parseNullableInteger(value: unknown, options?: { allowNegative?: boolean }): number | null {
    const num = this.parseNullableNumber(value, options);
    if (num === null) {
      return null;
    }
    return Math.trunc(num);
  }

  private sanitizeAvionics(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (entry === null || entry === undefined) {
          return null;
        }
        if (typeof entry === 'string') {
          const name = this.sanitizeString(entry);
          if (!name) {
            return null;
          }
          return { manufacturer: null, model: null, name };
        }
        if (typeof entry === 'object') {
          const manufacturer = this.sanitizeString((entry as any).manufacturer || (entry as any).make);
          const model = this.sanitizeString((entry as any).model);
          const name = this.sanitizeString((entry as any).name);
          if (!manufacturer && !model && !name) {
            return null;
          }
          return { manufacturer, model, name };
        }
        return null;
      })
      .filter((entry): entry is { manufacturer: string | null; model: string | null; name: string | null } => Boolean(entry));
  }

  private normalizeInput(input: CreateUserAircraftProfileInput): NormalizedAircraftProfileData {
    const tailNumber = this.sanitizeString(input.tailNumber, { uppercase: true });
    if (!tailNumber) {
      throw new PlaneProfileValidationError('Tail number is required');
    }

    const displayName = this.sanitizeString(input.displayName || input.model || input.manufacturer);
    const callsign = this.sanitizeString(input.callsign, { uppercase: true });
    const serialNumber = this.sanitizeString(input.serialNumber, { uppercase: true });
    const manufacturer = this.sanitizeString(input.manufacturer);
    const model = this.sanitizeString(input.model);
    const aircraftType = this.sanitizeString(input.aircraftType, { uppercase: true });

    const category = this.sanitizeNullableEnum(input.category, CATEGORY_VALUES);
    const primaryColor = this.sanitizeString(input.primaryColor);
    const secondaryColor = this.sanitizeString(input.secondaryColor);
    const homeAirportCode = this.sanitizeString(input.homeAirportCode, { uppercase: true });

    const airspeedUnit = this.sanitizeEnum(input.airspeedUnit, AIRSPEED_UNITS, 'knots');
    const lengthUnit = this.sanitizeEnum(input.lengthUnit, LENGTH_UNITS, 'feet');
    const weightUnit = this.sanitizeEnum(input.weightUnit, WEIGHT_UNITS, 'pounds');
    const fuelUnit = this.sanitizeEnum(input.fuelUnit, FUEL_UNITS, 'gallons');

    const fuelType = this.sanitizeString(input.fuelType);
    const engineType = this.sanitizeString(input.engineType);
    const propConfiguration = this.sanitizeString(input.propConfiguration);

    const yearOfManufacture = this.parseNullableInteger(input.yearOfManufacture);
    if (yearOfManufacture !== null && (yearOfManufacture < 1903 || yearOfManufacture > 2100)) {
      throw new PlaneProfileValidationError('Year of manufacture must be between 1903 and 2100');
    }

    const engineCount = this.parseNullableInteger(input.engineCount);
    if (engineCount !== null && engineCount < 0) {
      throw new PlaneProfileValidationError('Engine count must be zero or positive');
    }

    const numericFields: Array<[NumericField, number | null]> = [
      ['default_cruise_altitude', this.parseNullableInteger(input.defaultCruiseAltitude)],
      ['service_ceiling', this.parseNullableInteger(input.serviceCeiling)],
      ['cruise_speed', this.parseNullableInteger(input.cruiseSpeed)],
      ['max_speed', this.parseNullableInteger(input.maxSpeed)],
      ['stall_speed', this.parseNullableInteger(input.stallSpeed)],
      ['best_glide_speed', this.parseNullableInteger(input.bestGlideSpeed)],
      ['best_glide_ratio', this.parseNullableNumber(input.bestGlideRatio)],
      ['empty_weight', this.parseNullableInteger(input.emptyWeight)],
      ['max_takeoff_weight', this.parseNullableInteger(input.maxTakeoffWeight)],
      ['max_landing_weight', this.parseNullableInteger(input.maxLandingWeight)],
      ['fuel_capacity_total', this.parseNullableNumber(input.fuelCapacityTotal)],
      ['fuel_capacity_usable', this.parseNullableNumber(input.fuelCapacityUsable)],
      ['start_taxi_fuel', this.parseNullableNumber(input.startTaxiFuel)],
      ['fuel_burn_per_hour', this.parseNullableNumber(input.fuelBurnPerHour)],
      ['operating_cost_per_hour', this.parseNullableNumber(input.operatingCostPerHour)],
      ['total_flight_hours', this.parseNullableNumber(input.totalFlightHours)],
    ];

    const normalized: NormalizedAircraftProfileData = {
      tail_number: tailNumber,
      display_name: displayName,
      callsign,
      serial_number: serialNumber,
      manufacturer,
      model,
      year_of_manufacture: yearOfManufacture,
      aircraft_type: aircraftType,
      category,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      home_airport_code: homeAirportCode,
      airspeed_unit: airspeedUnit,
      length_unit: lengthUnit,
      weight_unit: weightUnit,
      fuel_unit: fuelUnit,
      fuel_type: fuelType,
      engine_type: engineType,
      engine_count: engineCount,
      prop_configuration: propConfiguration,
      avionics: this.sanitizeAvionics(input.avionics),
      default_cruise_altitude: null,
      service_ceiling: null,
      cruise_speed: null,
      max_speed: null,
      stall_speed: null,
      best_glide_speed: null,
      best_glide_ratio: null,
      empty_weight: null,
      max_takeoff_weight: null,
      max_landing_weight: null,
      fuel_capacity_total: null,
      fuel_capacity_usable: null,
      start_taxi_fuel: null,
      fuel_burn_per_hour: null,
      operating_cost_per_hour: null,
      total_flight_hours: null,
      notes: this.sanitizeString(input.notes),
    };

    numericFields.forEach(([key, value]) => {
      normalized[key] = value;
    });

    return normalized;
  }

  private buildColumnValues(normalized: NormalizedAircraftProfileData) {
    return [
      normalized.tail_number,
      normalized.display_name,
      normalized.callsign,
      normalized.serial_number,
      normalized.manufacturer,
      normalized.model,
      normalized.year_of_manufacture,
      normalized.aircraft_type,
      normalized.category,
      normalized.primary_color,
      normalized.secondary_color,
      normalized.home_airport_code,
      normalized.airspeed_unit,
      normalized.length_unit,
      normalized.weight_unit,
      normalized.fuel_unit,
      normalized.fuel_type,
      normalized.engine_type,
      normalized.engine_count,
      normalized.prop_configuration,
      JSON.stringify(normalized.avionics),
      normalized.default_cruise_altitude,
      normalized.service_ceiling,
      normalized.cruise_speed,
      normalized.max_speed,
      normalized.stall_speed,
      normalized.best_glide_speed,
      normalized.best_glide_ratio,
      normalized.empty_weight,
      normalized.max_takeoff_weight,
      normalized.max_landing_weight,
      normalized.fuel_capacity_total,
      normalized.fuel_capacity_usable,
      normalized.start_taxi_fuel,
      normalized.fuel_burn_per_hour,
      normalized.operating_cost_per_hour,
      normalized.total_flight_hours,
      normalized.notes,
    ];
  }

  async listProfilesForUser(userId: number): Promise<UserAircraftProfile[]> {
    if (!userId || userId <= 0) {
      throw new PlaneProfileValidationError('User ID is required', 400);
    }

    const query = `
      SELECT *
      FROM user_aircraft_profiles
      WHERE user_id = $1
      ORDER BY COALESCE(display_name, tail_number) ASC
    `;
    return this.db.any<UserAircraftProfile>(query, [userId]);
  }

  async findProfileByTail(userId: number, tailNumber: string): Promise<UserAircraftProfile | null> {
    if (!userId || userId <= 0) {
      throw new PlaneProfileValidationError('User ID is required', 400);
    }
    if (!tailNumber) {
      return null;
    }

    const normalized = tailNumber.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    const query = `
      SELECT *
      FROM user_aircraft_profiles
      WHERE user_id = $1 AND tail_number = $2
      LIMIT 1
    `;
    return this.db.oneOrNone<UserAircraftProfile>(query, [userId, normalized]);
  }

  async createProfile(userId: number, input: CreateUserAircraftProfileInput): Promise<UserAircraftProfile> {
    if (!userId || userId <= 0) {
      throw new PlaneProfileValidationError('User ID is required', 400);
    }

    const normalized = this.normalizeInput(input);
    const columnValues = this.buildColumnValues(normalized);

    const query = `
      INSERT INTO user_aircraft_profiles (
        user_id,
        tail_number,
        display_name,
        callsign,
        serial_number,
        manufacturer,
        model,
        year_of_manufacture,
        aircraft_type,
        category,
        primary_color,
        secondary_color,
        home_airport_code,
        airspeed_unit,
        length_unit,
        weight_unit,
        fuel_unit,
        fuel_type,
        engine_type,
        engine_count,
        prop_configuration,
        avionics,
        default_cruise_altitude,
        service_ceiling,
        cruise_speed,
        max_speed,
        stall_speed,
        best_glide_speed,
        best_glide_ratio,
        empty_weight,
        max_takeoff_weight,
        max_landing_weight,
        fuel_capacity_total,
        fuel_capacity_usable,
        start_taxi_fuel,
        fuel_burn_per_hour,
        operating_cost_per_hour,
        total_flight_hours,
        notes
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35,
        $36, $37, $38, $39
      )
      RETURNING *
    `;

    const profile = await this.db.one<UserAircraftProfile>(query, [userId, ...columnValues]);
    logger.info('Created new user aircraft profile', { userId, tailNumber: normalized.tail_number, profileId: profile.id });
    return profile;
  }

  async updateProfile(
    userId: number,
    planeId: number,
    input: CreateUserAircraftProfileInput,
  ): Promise<UserAircraftProfile> {
    if (!userId || userId <= 0) {
      throw new PlaneProfileValidationError('User ID is required', 400);
    }
    if (!planeId || planeId <= 0) {
      throw new PlaneProfileValidationError('Plane ID is required', 400);
    }

    const normalized = this.normalizeInput(input);
    const columnValues = this.buildColumnValues(normalized);

    const query = `
      UPDATE user_aircraft_profiles
      SET
        tail_number = $1,
        display_name = $2,
        callsign = $3,
        serial_number = $4,
        manufacturer = $5,
        model = $6,
        year_of_manufacture = $7,
        aircraft_type = $8,
        category = $9,
        primary_color = $10,
        secondary_color = $11,
        home_airport_code = $12,
        airspeed_unit = $13,
        length_unit = $14,
        weight_unit = $15,
        fuel_unit = $16,
        fuel_type = $17,
        engine_type = $18,
        engine_count = $19,
        prop_configuration = $20,
        avionics = $21::jsonb,
        default_cruise_altitude = $22,
        service_ceiling = $23,
        cruise_speed = $24,
        max_speed = $25,
        stall_speed = $26,
        best_glide_speed = $27,
        best_glide_ratio = $28,
        empty_weight = $29,
        max_takeoff_weight = $30,
        max_landing_weight = $31,
        fuel_capacity_total = $32,
        fuel_capacity_usable = $33,
        start_taxi_fuel = $34,
        fuel_burn_per_hour = $35,
        operating_cost_per_hour = $36,
        total_flight_hours = $37,
        notes = $38,
        updated_at = NOW()
      WHERE id = $39 AND user_id = $40
      RETURNING *
    `;

    const updated = await this.db.oneOrNone<UserAircraftProfile>(query, [...columnValues, planeId, userId]);

    if (!updated) {
      throw new PlaneProfileValidationError('Plane not found', 404);
    }

    logger.info('Updated user aircraft profile', { userId, planeId, tailNumber: normalized.tail_number });
    return updated;
  }
}

export default new UserAircraftProfileService();
export { UserAircraftProfileService };
