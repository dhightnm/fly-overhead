/* eslint-env jest */

import {
  afterEach, describe, expect, it, jest,
} from '@jest/globals';
import type { Mocked } from 'jest-mock';
import axios from 'axios';
import { AerodataboxService } from '../AerodataboxService';

jest.mock('axios');

const mockedAxios = axios as Mocked<typeof axios>;

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const createService = (options: { apiKey?: string | null; dailyBudget?: number } = {}) => {
  const baseOptions: { baseUrl: string; apiKey: string | null; dailyBudget: number } = {
    baseUrl: 'https://test.aero',
    apiKey: 'test-key',
    dailyBudget: 600,
  };

  if (options.apiKey !== undefined) {
    baseOptions.apiKey = options.apiKey;
  }

  if (options.dailyBudget !== undefined) {
    baseOptions.dailyBudget = options.dailyBudget;
  }

  return new AerodataboxService(baseOptions);
};

describe('AerodataboxService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when API key is missing', async () => {
    const service = createService({ apiKey: null });
    const result = await service.getFlightByIcao24('a9034c');

    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('maps flight data and caches subsequent lookups', async () => {
    const service = createService({ apiKey: 'test-key' });
    const samplePayload = {
      flights: [
        {
          number: 'AA 1958',
          callsign: 'AAL1958',
          status: 'Arrived',
          departure: {
            airport: {
              icao: 'KCMH',
              iata: 'CMH',
              name: 'Columbus Port',
            },
            scheduledTimeUtc: '2025-11-10 12:30Z',
          },
          arrival: {
            airport: {
              icao: 'KPHX',
              iata: 'PHX',
              name: 'Phoenix Sky Harbor',
            },
          },
          aircraft: {
            reg: 'N680AW',
            model: 'Airbus A320',
          },
        },
      ],
    };

    mockedAxios.get.mockResolvedValue({ data: samplePayload });

    const first = await service.getFlightByIcao24('A9034C');
    expect(first).toBeTruthy();
    expect(first?.callsign).toBe('AAL1958');
    expect(first?.routeData).toMatchObject({
      departureAirport: {
        icao: 'KCMH',
        iata: 'CMH',
      },
      arrivalAirport: {
        icao: 'KPHX',
        iata: 'PHX',
      },
      registration: 'N680AW',
      aircraft: {
        model: 'Airbus A320',
      },
      source: 'aerodatabox',
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    const second = await service.getFlightByIcao24('a9034c');
    expect(second).toEqual(first);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('skips remote call while in failure cooldown', async () => {
    const service = createService({ apiKey: 'test-key' });
    mockedAxios.get.mockRejectedValueOnce(new Error('timeout'));

    const first = await service.getFlightByIcao24('a9034c');
    expect(first).toBeNull();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    mockedAxios.get.mockClear();
    const second = await service.getFlightByIcao24('a9034c');
    expect(second).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
