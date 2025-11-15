/* eslint-env jest */

import {
  beforeEach, describe, expect, it, jest,
} from '@jest/globals';

// Mock dependencies - define functions inside factory to avoid hoisting issues
jest.mock('../AerodataboxService', () => ({
  __esModule: true,
  default: {
    getFlightByIcao24: jest.fn(),
  },
}));

jest.mock('../../repositories/PostgresRepository', () => ({
  __esModule: true,
  default: {
    cacheRoute: jest.fn(),
    updateAircraftCallsign: jest.fn(),
    storeRouteHistory: jest.fn(),
    getDb: jest.fn(() => ({ oneOrNone: jest.fn() })),
  },
}));

// Import after mocks are set up
import { FlightRouteService, shouldFilterAsLanded } from '../FlightRouteService';
import aerodataboxService from '../AerodataboxService';
import postgresRepository from '../../repositories/PostgresRepository';

// Type-safe mock accessors
const aerodataboxMock = aerodataboxService as jest.Mocked<typeof aerodataboxService>;
const cacheRouteRepoMock = postgresRepository.cacheRoute as jest.MockedFunction<typeof postgresRepository.cacheRoute>;
const updateAircraftCallsignMock = postgresRepository.updateAircraftCallsign as jest.MockedFunction<typeof postgresRepository.updateAircraftCallsign>;
const storeRouteHistoryMock = postgresRepository.storeRouteHistory as jest.MockedFunction<typeof postgresRepository.storeRouteHistory>;
const getDbMock = postgresRepository.getDb as jest.MockedFunction<typeof postgresRepository.getDb>;
const dbOneOrNoneMock = jest.fn() as any;

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

describe('FlightRouteService - Aerodatabox integration', () => {
  let flightRouteService: FlightRouteService;

  beforeEach(() => {
    aerodataboxMock.getFlightByIcao24.mockReset();
    cacheRouteRepoMock.mockReset();
    updateAircraftCallsignMock.mockReset();
    storeRouteHistoryMock.mockReset();
    dbOneOrNoneMock.mockReset().mockResolvedValue(null);
    getDbMock.mockReset().mockReturnValue({ oneOrNone: dbOneOrNoneMock } as any);
    flightRouteService = new FlightRouteService({ flightAwareApiKey: undefined, flightAwareBaseUrl: undefined });
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
