import type { AircraftStateArray } from '../../types/aircraftState.types';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const baseConfig = {
  enabled: true,
  ttlSeconds: 60,
  cleanupIntervalSeconds: 3600,
  maxEntries: 100,
  minResultsBeforeDbFallback: 5,
};

async function createStore(overrides = {}) {
  jest.resetModules();
  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      liveState: { ...baseConfig, ...overrides },
    },
  }));

  const storeModule = await import('../LiveStateStore');
  return storeModule.default;
}

function createState({
  icao24 = 'abc123',
  latitude = 40,
  longitude = -74,
  lastContact = Math.floor(Date.now() / 1000),
}: {
  icao24?: string;
  latitude?: number;
  longitude?: number;
  lastContact?: number;
}): AircraftStateArray {
  const state: AircraftStateArray = [];
  state[0] = icao24;
  state[1] = 'CALL123';
  state[3] = lastContact;
  state[4] = lastContact;
  state[5] = longitude;
  state[6] = latitude;
  state[8] = false;
  return state;
}

describe('LiveStateStore', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('stores and retrieves aircraft within bounds', async () => {
    const store = await createStore();
    const state = createState({ latitude: 40.7, longitude: -74.0 });
    store.upsertState(state);

    const results = store.getStatesInBounds(30, -90, 50, -60, 0);
    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('abc123');
  });

  it('filters out entries outside bounding box', async () => {
    const store = await createStore();
    store.upsertState(createState({ icao24: 'inside', latitude: 10, longitude: 10 }));
    store.upsertState(createState({ icao24: 'outside', latitude: 60, longitude: 60 }));

    const results = store.getStatesInBounds(0, 0, 20, 20, 0);
    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('inside');
  });

  it('prunes entries older than TTL', async () => {
    const store = await createStore({ ttlSeconds: 1 });
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    store.upsertState(createState({ icao24: 'stale' }));

    nowSpy.mockReturnValue(3_000); // > ttlSeconds later
    const results = store.getStatesInBounds(-90, -180, 90, 180, 0);
    expect(results).toHaveLength(0);
    nowSpy.mockRestore();
  });

  it('evicts oldest entry when capacity exceeded', async () => {
    const store = await createStore({ maxEntries: 2 });
    store.upsertState(createState({ icao24: 'first' }));
    store.upsertState(createState({ icao24: 'second' }));
    store.upsertState(createState({ icao24: 'third' }));

    const results = store.getStatesInBounds(-90, -180, 90, 180, 0);
    const ids = results.map((state) => state[0]);
    expect(ids).not.toContain('first');
    expect(ids).toEqual(expect.arrayContaining(['second', 'third']));
  });
});

