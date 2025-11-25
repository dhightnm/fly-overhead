import type { AircraftStateArray, AircraftStateRecord } from '../types/aircraftState.types';

export const STATE_INDEX = {
  ICAO24: 0,
  CALLSIGN: 1,
  ORIGIN_COUNTRY: 2,
  TIME_POSITION: 3,
  LAST_CONTACT: 4,
  LONGITUDE: 5,
  LATITUDE: 6,
  BARO_ALTITUDE: 7,
  ON_GROUND: 8,
  VELOCITY: 9,
  TRUE_TRACK: 10,
  VERTICAL_RATE: 11,
  SENSORS: 12,
  GEO_ALTITUDE: 13,
  SQUAWK: 14,
  SPI: 15,
  POSITION_SOURCE: 16,
  CATEGORY: 17,
  AIRCRAFT_TYPE: 19,
  AIRCRAFT_DESCRIPTION: 20,
  REGISTRATION: 21,
  EMERGENCY_STATUS: 22,
};

export type DbAircraftRow = Record<string, any>;

export function mapStateArrayToRecord(state: AircraftStateArray): AircraftStateRecord {
  const safeNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  const safeString = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const safeBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

  return {
    icao24: String(state[STATE_INDEX.ICAO24] || '').trim(),
    callsign: safeString(state[STATE_INDEX.CALLSIGN]),
    origin_country: safeString(state[STATE_INDEX.ORIGIN_COUNTRY]),
    time_position: safeNumber(state[STATE_INDEX.TIME_POSITION]),
    last_contact: safeNumber(state[STATE_INDEX.LAST_CONTACT]),
    longitude: safeNumber(state[STATE_INDEX.LONGITUDE]),
    latitude: safeNumber(state[STATE_INDEX.LATITUDE]),
    baro_altitude: safeNumber(state[STATE_INDEX.BARO_ALTITUDE]),
    on_ground: safeBoolean(state[STATE_INDEX.ON_GROUND]),
    velocity: safeNumber(state[STATE_INDEX.VELOCITY]),
    true_track: safeNumber(state[STATE_INDEX.TRUE_TRACK]),
    vertical_rate: safeNumber(state[STATE_INDEX.VERTICAL_RATE]),
    geo_altitude: safeNumber(state[STATE_INDEX.GEO_ALTITUDE]),
    squawk: safeString(state[STATE_INDEX.SQUAWK]),
    spi: safeBoolean(state[STATE_INDEX.SPI]),
    position_source: safeNumber(state[STATE_INDEX.POSITION_SOURCE]),
    category: safeNumber(state[STATE_INDEX.CATEGORY]),
    aircraft_type: safeString(state[STATE_INDEX.AIRCRAFT_TYPE]),
    aircraft_description: safeString(state[STATE_INDEX.AIRCRAFT_DESCRIPTION]),
    registration: safeString(state[STATE_INDEX.REGISTRATION]),
    emergency_status: safeString(state[STATE_INDEX.EMERGENCY_STATUS]),
  };
}

export function validateAircraftState(
  state: unknown,
): { valid: true; state: AircraftStateArray } | { valid: false; error: string } {
  if (!Array.isArray(state)) {
    return { valid: false, error: 'State must be an array' };
  }

  if (state.length < 18) {
    return { valid: false, error: 'State array is missing required fields' };
  }

  const icao24 = state[STATE_INDEX.ICAO24];
  if (typeof icao24 !== 'string' || icao24.length !== 6) {
    return { valid: false, error: 'Invalid icao24 (must be 6-character hex string)' };
  }

  const lastContact = state[STATE_INDEX.LAST_CONTACT];
  if (typeof lastContact !== 'number') {
    return { valid: false, error: 'Missing or invalid last_contact value' };
  }

  const latitude = state[STATE_INDEX.LATITUDE];
  if (typeof latitude === 'number' && (latitude < -90 || latitude > 90)) {
    return { valid: false, error: 'Invalid latitude (must be between -90 and 90)' };
  }

  const longitude = state[STATE_INDEX.LONGITUDE];
  if (typeof longitude === 'number' && (longitude < -180 || longitude > 180)) {
    return { valid: false, error: 'Invalid longitude (must be between -180 and 180)' };
  }

  const baroAltitude = state[STATE_INDEX.BARO_ALTITUDE];
  if (typeof baroAltitude === 'number' && (baroAltitude < -1500 || baroAltitude > 60000)) {
    return { valid: false, error: 'Invalid baro_altitude (must be between -1500 and 60000 meters)' };
  }

  const velocity = state[STATE_INDEX.VELOCITY];
  if (typeof velocity === 'number' && (velocity < 0 || velocity > 1500)) {
    return { valid: false, error: 'Invalid velocity (must be between 0 and 1500 m/s)' };
  }

  const category = state[STATE_INDEX.CATEGORY];
  if (typeof category === 'number' && (category < 0 || category > 19)) {
    return { valid: false, error: 'Invalid category (must be between 0 and 19)' };
  }

  return { valid: true, state };
}

export function applyStateToRecord(record: DbAircraftRow | undefined, state: AircraftStateArray): DbAircraftRow {
  const updated: DbAircraftRow = { ...(record || {}) };

  updated.icao24 = state[STATE_INDEX.ICAO24];
  updated.callsign = state[STATE_INDEX.CALLSIGN] || updated.callsign || null;
  updated.time_position = state[STATE_INDEX.TIME_POSITION] ?? updated.time_position ?? null;
  updated.last_contact = state[STATE_INDEX.LAST_CONTACT] ?? updated.last_contact ?? null;
  updated.longitude = state[STATE_INDEX.LONGITUDE] ?? updated.longitude ?? null;
  updated.latitude = state[STATE_INDEX.LATITUDE] ?? updated.latitude ?? null;
  updated.baro_altitude = state[STATE_INDEX.BARO_ALTITUDE] ?? updated.baro_altitude ?? null;
  updated.on_ground = state[STATE_INDEX.ON_GROUND] ?? updated.on_ground ?? false;
  updated.velocity = state[STATE_INDEX.VELOCITY] ?? updated.velocity ?? null;
  updated.true_track = state[STATE_INDEX.TRUE_TRACK] ?? updated.true_track ?? null;
  updated.vertical_rate = state[STATE_INDEX.VERTICAL_RATE] ?? updated.vertical_rate ?? null;
  updated.geo_altitude = state[STATE_INDEX.GEO_ALTITUDE] ?? updated.geo_altitude ?? null;
  updated.squawk = state[STATE_INDEX.SQUAWK] ?? updated.squawk ?? null;
  updated.spi = state[STATE_INDEX.SPI] ?? updated.spi ?? false;
  updated.position_source = state[STATE_INDEX.POSITION_SOURCE] ?? updated.position_source ?? null;
  updated.category = state[STATE_INDEX.CATEGORY] ?? updated.category ?? null;
  // Preserve existing data_source if it exists (e.g., 'feeder'), otherwise default to 'airplanes.live'
  if (!updated.data_source) {
    updated.data_source = 'airplanes.live';
  }
  // Preserve existing source_priority if it exists (e.g., feeder priority 10), otherwise default to 20
  if (updated.source_priority === undefined || updated.source_priority === null) {
    updated.source_priority = 20;
  }

  // Enriched fields (optional from airplanes.live)
  updated.aircraft_type = state[STATE_INDEX.AIRCRAFT_TYPE] ?? updated.aircraft_type ?? null;
  updated.aircraft_description = state[STATE_INDEX.AIRCRAFT_DESCRIPTION] ?? updated.aircraft_description ?? null;
  updated.registration = state[STATE_INDEX.REGISTRATION] ?? updated.registration ?? null;
  updated.emergency_status = state[STATE_INDEX.EMERGENCY_STATUS] ?? updated.emergency_status ?? null;

  return updated;
}

export function getLatitude(state: AircraftStateArray): number | null {
  const value = state[STATE_INDEX.LATITUDE];
  return typeof value === 'number' ? value : null;
}

export function getLongitude(state: AircraftStateArray): number | null {
  const value = state[STATE_INDEX.LONGITUDE];
  return typeof value === 'number' ? value : null;
}

export function getLastContact(state: AircraftStateArray): number | null {
  const value = state[STATE_INDEX.LAST_CONTACT];
  return typeof value === 'number' ? value : null;
}
