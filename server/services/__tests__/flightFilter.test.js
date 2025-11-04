const { shouldFilterAsLanded } = require('../FlightRouteService');

describe('shouldFilterAsLanded', () => {
  const now = Date.now();
  // Helper: to ms
  const min = 60 * 1000;

  it('filters if lastContact before actualArrival', () => {
    expect(shouldFilterAsLanded(now, now + min)).toBe(true);
  });

  it('filters if lastContact < arrival+9min', () => {
    expect(shouldFilterAsLanded(now, now - 9 * min)).toBe(true);
  });

  it('filters if lastContact == arrival+10min', () => {
    expect(shouldFilterAsLanded(now, now - 10 * min)).toBe(true); // at cutoff
  });

  it('does NOT filter if lastContact > arrival+10min', () => {
    expect(shouldFilterAsLanded(now, now - 11 * min)).toBe(false);
  });

  it('does NOT filter if lastArrival is null', () => {
    expect(shouldFilterAsLanded(now, null)).toBe(false);
  });

  it('does NOT filter if lastContact is much after lastArrival', () => {
    expect(shouldFilterAsLanded(now, now - 24 * 60 * 60 * 1000)).toBe(false); // 24h diff
  });
});

// ---- Additional Realism: Conversation-Based Test Data ----
describe('shouldFilterAsLanded — realistic filtering of aircraft array', () => {
  const now = Date.now();
  const min = 60 * 1000;
  const hr = 60 * min;

  // Simulate "mock Joined-API" data based on conversation/testing
  const aircraftCases = [
    {
      name: 'ITY350 (landed 2hr ago, OpenSky stale)', // Should be filtered
      lastContact: now - (2 * hr),
      lastArrival: now - (2 * hr),
      expected: true,
    },
    {
      name: 'AAL1148 (landed, lastContact 3min ago, landed 8min ago)', // inside 10min window
      lastContact: now - (3 * min),
      lastArrival: now - (8 * min),
      expected: true,
    },
    {
      name: 'New leg, callsign reused, actually in flight', // Should NOT be filtered
      lastContact: now,
      lastArrival: now - (15 * min),
      expected: false,
    },
    {
      name: 'Still airborne (no arrival known)', // Should NOT be filtered
      lastContact: now,
      lastArrival: null,
      expected: false,
    },
    {
      name: 'Very old OpenSky data, lastContact way after landing (>1 day)', // Should NOT filter, as OpenSky is clearly reporting new data
      lastContact: now,
      lastArrival: now - (26 * hr),
      expected: false,
    },
  ];

  aircraftCases.forEach(({ name, lastContact, lastArrival, expected }) => {
    it(`${name} — should${expected ? '' : ' NOT'} be filtered as landed`, () => {
      expect(shouldFilterAsLanded(lastContact, lastArrival)).toBe(expected);
    });
  });
});
