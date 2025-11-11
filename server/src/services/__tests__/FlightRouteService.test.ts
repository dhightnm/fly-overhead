/* eslint-env jest */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
const aerodataboxMock = {
  getFlightByIcao24: jest.fn(),
};

const cacheRouteRepoMock = jest.fn();
const updateAircraftCallsignMock = jest.fn();
const storeRouteHistoryMock = jest.fn();
const dbOneOrNoneMock = jest.fn();
const getDbMock = jest.fn(() => ({ oneOrNone: dbOneOrNoneMock }));

jest.mock('../AerodataboxService', () => ({
  __esModule: true,
  default: aerodataboxMock,
}));

jest.mock('../../repositories/PostgresRepository', () => ({
  __esModule: true,
  default: {
    cacheRoute: cacheRouteRepoMock,
    updateAircraftCallsign: updateAircraftCallsignMock,
    storeRouteHistory: storeRouteHistoryMock,
    getDb: getDbMock,
  },
}));

jest.mock('../OpenSkyService', () => ({
  __esModule: true,
  default: {
    getStatesInBounds: jest.fn(),
    getAllStates: jest.fn(),
    getFlightsByAircraft: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { FlightRouteService, shouldFilterAsLanded } from '../FlightRouteService';

describe('FlightRouteService - Aerodatabox integration', () => {
  let flightRouteService: FlightRouteService;

  beforeEach(() => {
    aerodataboxMock.getFlightByIcao24.mockReset();
    cacheRouteRepoMock.mockReset();
    updateAircraftCallsignMock.mockReset();
    storeRouteHistoryMock.mockReset();
    dbOneOrNoneMock.mockReset().mockResolvedValue(null);
    getDbMock.mockReset().mockReturnValue({ oneOrNone: dbOneOrNoneMock });
    flightRouteService = new FlightRouteService({ flightAwareApiKey: null, flightAwareBaseUrl: null });
  });

  it('returns Aerodatabox route data when expensive API calls are allowed', async () => {
    const aerodataboxResult = {
      routeData: {
        callsign: 'AAL1958',
        icao24: 'a9034c',
        departureAirport: {
          icao: 'KCMH',
          iata: 'CMH',
          name: 'Columbus Port',
        },
        arrivalAirport: {
          icao: 'KPHX',
          iata: 'PHX',
          name: 'Phoenix Sky Harbor',
        },
        source: 'aerodatabox',
        flightStatus: 'Arrived',
        registration: 'N680AW',
        aircraft: {
          model: 'Airbus A320',
          type: 'Airbus A320',
        },
        flightData: {
          scheduledDeparture: 1731234600,
          scheduledArrival: null,
          actualDeparture: null,
          actualArrival: null,
        },
      },
      callsign: 'AAL1958',
    };

    aerodataboxMock.getFlightByIcao24.mockResolvedValue(aerodataboxResult);
    const inferSpy = jest
      .spyOn(flightRouteService as any, 'inferRouteFromPosition')
      .mockResolvedValue(null);

    const route = await flightRouteService.getFlightRoute('A9034C', null, true, true);

    expect(route).toMatchObject({
      source: 'aerodatabox',
      callsign: 'AAL1958',
      icao24: 'a9034c',
      departureAirport: {
        icao: 'KCMH',
        iata: 'CMH',
      },
      arrivalAirport: {
        icao: 'KPHX',
        iata: 'PHX',
      },
    });

    expect(aerodataboxMock.getFlightByIcao24).toHaveBeenCalledWith('a9034c');
    expect(updateAircraftCallsignMock).toHaveBeenCalledWith('A9034C', 'AAL1958');
    expect(cacheRouteRepoMock).toHaveBeenCalledTimes(1);
    expect(cacheRouteRepoMock).toHaveBeenCalledWith('A9034C', expect.objectContaining({
      source: 'aerodatabox',
      callsign: 'AAL1958',
    }));
    expect(storeRouteHistoryMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'aerodatabox',
      callsign: 'AAL1958',
    }));
    expect(inferSpy).toHaveBeenCalledWith('A9034C');

    inferSpy.mockRestore();
  });
});

describe('shouldFilterAsLanded', () => {
  const now = Date.now();
  const minute = 60 * 1000;

  it('filters flights that landed within buffer window', () => {
    expect(shouldFilterAsLanded(now, now - 5 * minute)).toBe(true);
  });

  it('does not filter when arrival timestamp is missing', () => {
    expect(shouldFilterAsLanded(now, null)).toBe(false);
  });

  it('does not filter flights with older arrivals beyond buffer', () => {
    expect(shouldFilterAsLanded(now, now - 24 * 60 * minute)).toBe(false);
  });
});

