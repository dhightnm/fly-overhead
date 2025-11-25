import { feederRegisterSchema, feederAircraftBatchSchema } from '../../schemas/feeder.schemas';
import { validateAircraftState, STATE_INDEX } from '../../utils/aircraftState';

type InvalidState = Extract<ReturnType<typeof validateAircraftState>, { valid: false }>;

describe('Feeder schema validation', () => {
  it('accepts a valid registration payload', () => {
    const result = feederRegisterSchema.parse({
      feeder_id: 'feeder_123',
      api_key_hash: 'hashvalue1234567890',
      key_prefix: 'fd_',
      name: 'Test Feeder',
      latitude: 35.0,
      longitude: -120.0,
      metadata: { region: 'west' },
    });
    expect(result.name).toBe('Test Feeder');
  });

  it('rejects registration payload missing required fields', () => {
    expect(() => feederRegisterSchema.parse({ feeder_id: 'abc' })).toThrow();
  });

  it('requires feeder_id and states in aircraft batch payload', () => {
    expect(() => feederAircraftBatchSchema.parse({})).toThrow();
    const parsed = feederAircraftBatchSchema.parse({
      feeder_id: 'feeder_123',
      states: [{ state: [], feeder_id: 'child' }],
    });
    expect(parsed.feeder_id).toBe('feeder_123');
  });
});

describe('validateAircraftState', () => {
  const baseState = () => {
    const state: any[] = Array(23).fill(null);
    state[STATE_INDEX.ICAO24] = 'abc123';
    state[STATE_INDEX.LAST_CONTACT] = 1000;
    state[STATE_INDEX.LATITUDE] = 10;
    state[STATE_INDEX.LONGITUDE] = 20;
    state[STATE_INDEX.BARO_ALTITUDE] = 1000;
    state[STATE_INDEX.VELOCITY] = 100;
    state[STATE_INDEX.CATEGORY] = 3;
    return state;
  };

  it('returns success for valid state arrays', () => {
    const result = validateAircraftState(baseState());
    expect(result.valid).toBe(true);
  });

  it('returns error for invalid latitude', () => {
    const invalid = baseState();
    invalid[STATE_INDEX.LATITUDE] = 200;
    const result = validateAircraftState(invalid);
    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error('State should have been invalid');
    }
    const { error } = result as InvalidState;
    expect(error).toMatch(/latitude/);
  });
});
