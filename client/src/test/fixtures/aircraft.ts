import type { Aircraft } from '../../types';

export const FIXTURE_TIMESTAMP = 1_000_000;

export const createAircraft = (overrides: Partial<Aircraft> = {}): Aircraft => ({
  icao24: 'abc123',
  callsign: 'TEST123',
  latitude: 40.0,
  longitude: -100.0,
  baro_altitude: null,
  geo_altitude: null,
  velocity: 450,
  true_track: 180,
  vertical_rate: 0,
  squawk: '1200',
  on_ground: false,
  category: 1,
  last_contact: FIXTURE_TIMESTAMP,
  source: 'database',
  data_source: 'opensky',
  feeder_id: 'feeder_123',
  source_priority: 1,
  route: null,
  ...overrides,
});

export const createAircraftList = (
  count: number,
  factory?: (index: number) => Partial<Aircraft>,
): Aircraft[] => Array.from({ length: count }, (_, index) => createAircraft({
  icao24: `icao${index}`,
  callsign: `TEST${index}`,
  ...factory?.(index),
}));
