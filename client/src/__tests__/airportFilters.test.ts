import {
  DEFAULT_AIRPORT_VISIBILITY,
  isAirportVisible,
  type AirportVisibilityMap,
} from '../utils/airportFilters';

describe('airport visibility filters', () => {
  it('shows only large airports by default', () => {
    expect(
      isAirportVisible({ type: 'large_airport' }, DEFAULT_AIRPORT_VISIBILITY),
    ).toBe(true);
    expect(
      isAirportVisible({ type: 'medium_airport' }, DEFAULT_AIRPORT_VISIBILITY),
    ).toBe(false);
    expect(
      isAirportVisible({ type: 'closed' }, DEFAULT_AIRPORT_VISIBILITY),
    ).toBe(false);
  });

  it('allows enabling specific airport types', () => {
    const filters: AirportVisibilityMap = {
      ...DEFAULT_AIRPORT_VISIBILITY,
      small_airport: true,
      heliport: true,
    };

    expect(isAirportVisible({ type: 'small_airport' }, filters)).toBe(true);
    expect(isAirportVisible({ type: 'heliport' }, filters)).toBe(true);
  });

  it('treats unknown types like large airports', () => {
    expect(
      isAirportVisible({ type: 'unknown_type' }, DEFAULT_AIRPORT_VISIBILITY),
    ).toBe(true);
  });
});
