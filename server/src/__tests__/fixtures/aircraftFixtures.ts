import type { ApiKey, Feeder } from '../../types/database.types';
import type { AirplanesLiveAircraft } from '../../services/AirplanesLiveService';

export type OpenSkyState = (string | number | null | boolean | number[])[];

const unixNow = () => Math.floor(Date.now() / 1000);

export const OPEN_SKY_SAMPLE_STATES: OpenSkyState[] = [
  ['abc123', 'TEST01', null, null, unixNow()],
  ['def456', 'TEST02', null, null, unixNow()],
];

export const buildOpenSkyResponse = (
  states: OpenSkyState[] = OPEN_SKY_SAMPLE_STATES,
  timestamp: number = unixNow(),
) => ({
  time: timestamp,
  states,
});

export const createOpenSkyStates = (count: number): OpenSkyState[] =>
  Array.from({ length: count }, (_, index) => [
    `icao${index}`,
    `TEST${index}`,
    null,
    null,
    unixNow(),
  ]);

export const NORTHEAST_BOUNDING_BOX = {
  lamin: 39.0,
  lomin: -75.0,
  lamax: 41.0,
  lomax: -73.0,
};

export type AirplanesLiveAircraftFixture = AirplanesLiveAircraft;

export const BASE_AIRPLANES_LIVE_STATE: AirplanesLiveAircraftFixture = {
  hex: 'a1b2c3',
  flight: 'AAL123  ',
  lat: 40.7128,
  lon: -74.006,
  alt_baro: 35000,
  gs: 450,
  track: 180,
  baro_rate: 2000,
  alt_geom: 35100,
  squawk: '1200',
  category: 'A3',
  t: 'B738',
  desc: 'BOEING 737-800',
  r: 'N12345',
  emergency: 'none',
  nav_qnh: 1013.2,
  nav_altitude_mcp: 35000,
  nav_heading: 180,
  mlat: [],
  seen_pos: 1.5,
  seen: 1.0,
};

export const createAirplanesLiveState = (
  overrides: Partial<AirplanesLiveAircraftFixture> = {},
): AirplanesLiveAircraftFixture => ({
  ...BASE_AIRPLANES_LIVE_STATE,
  ...overrides,
});

const now = () => new Date();

export const FEEDER_TEST_DATA = {
  feederId: 'feeder_test_123',
  apiKey: `fd_${'a'.repeat(32)}`,
  name: 'Test Feeder',
  latitude: 40.7128,
  longitude: -74.006,
  metadata: { location: 'New York' } as Record<string, any>,
};

export const createMockApiKey = (overrides: Partial<ApiKey> = {}): ApiKey => ({
  id: 1,
  key_id: 'key_feeder_123',
  key_hash: 'hashed-api-key',
  key_prefix: 'fd_',
  name: `Feeder: ${FEEDER_TEST_DATA.name}`,
  description: `Auto-generated API key for feeder ${FEEDER_TEST_DATA.feederId}`,
  user_id: null,
  scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
  status: 'active',
  last_used_at: null,
  usage_count: 0,
  created_at: now(),
  updated_at: now(),
  expires_at: null,
  created_by: null,
  revoked_at: null,
  revoked_by: null,
  revoked_reason: null,
  ...overrides,
});

export const createMockFeeder = (overrides: Partial<Feeder> = {}): Feeder => ({
  id: 1,
  feeder_id: FEEDER_TEST_DATA.feederId,
  name: FEEDER_TEST_DATA.name,
  api_key_hash: 'hashed-api-key',
  location: null,
  metadata: { ...FEEDER_TEST_DATA.metadata, api_key_id: 'key_feeder_123' },
  created_at: now(),
  updated_at: now(),
  last_seen_at: null,
  is_active: true,
  latitude: FEEDER_TEST_DATA.latitude,
  longitude: FEEDER_TEST_DATA.longitude,
  ...overrides,
});
