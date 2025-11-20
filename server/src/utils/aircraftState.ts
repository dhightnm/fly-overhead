import type { AircraftStateArray } from '../types/aircraftState.types';

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
  updated.data_source = updated.data_source || 'airplanes.live';
  updated.source_priority = updated.source_priority ?? 20;

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
