import { STATE_INDEX, validateAircraftState, mapStateArrayToRecord } from '../aircraftState';

type InvalidState = Extract<ReturnType<typeof validateAircraftState>, { valid: false }>;

function buildState(overrides: Record<string, unknown> = {}) {
  const state: any[] = Array(23).fill(null);
  state[STATE_INDEX.ICAO24] = 'abc123';
  state[STATE_INDEX.CALLSIGN] = 'CALL123';
  state[STATE_INDEX.ORIGIN_COUNTRY] = 'United States';
  state[STATE_INDEX.TIME_POSITION] = 1000;
  state[STATE_INDEX.LAST_CONTACT] = 2000;
  state[STATE_INDEX.LONGITUDE] = 10;
  state[STATE_INDEX.LATITUDE] = 20;
  state[STATE_INDEX.BARO_ALTITUDE] = 1000;
  state[STATE_INDEX.VELOCITY] = 200;
  state[STATE_INDEX.TRUE_TRACK] = 90;
  state[STATE_INDEX.VERTICAL_RATE] = 5;
  state[STATE_INDEX.ON_GROUND] = false;
  state[STATE_INDEX.GEO_ALTITUDE] = 1100;
  state[STATE_INDEX.SQUAWK] = '1234';
  state[STATE_INDEX.POSITION_SOURCE] = 1;
  state[STATE_INDEX.CATEGORY] = 3;
  state[STATE_INDEX.AIRCRAFT_TYPE] = 'A320';
  state[STATE_INDEX.AIRCRAFT_DESCRIPTION] = 'Airbus A320';
  state[STATE_INDEX.REGISTRATION] = 'N12345';
  state[STATE_INDEX.EMERGENCY_STATUS] = 'none';
  return state.map((value, index) => (index in overrides ? overrides[index] : value));
}

describe('aircraftState helpers', () => {
  it('validates correct state arrays', () => {
    const state = buildState();
    const result = validateAircraftState(state);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.state[STATE_INDEX.ICAO24]).toBe('abc123');
    }
  });

  it('rejects invalid latitude', () => {
    const state = buildState({ [STATE_INDEX.LATITUDE]: 200 });
    const result = validateAircraftState(state);
    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error('State should have been invalid');
    }
    const { error } = result as InvalidState;
    expect(error).toMatch(/latitude/);
  });

  it('maps arrays to typed records', () => {
    const state = buildState();
    const record = mapStateArrayToRecord(state);
    expect(record.icao24).toBe('abc123');
    expect(record.callsign).toBe('CALL123');
    expect(record.latitude).toBe(20);
    expect(record.velocity).toBe(200);
  });
});
