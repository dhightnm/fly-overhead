import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import type { RouteData } from '../types/api.types';

interface AerodataboxFlightSegment {
  airport?: {
    icao?: string | null;
    iata?: string | null;
    name?: string | null;
    location?: {
      lat?: number | null;
      lon?: number | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null;
  } | null;
  scheduledTimeUtc?: string | null;
  actualTimeUtc?: string | null;
  scheduledTimeLocal?: string | null;
  actualTimeLocal?: string | null;
}

interface AerodataboxFlightRecord {
  number?: string | null;
  callsign?: string | null;
  status?: string | null;
  airline?: {
    name?: string | null;
    iata?: string | null;
    icao?: string | null;
  } | null;
  departure?: AerodataboxFlightSegment | null;
  arrival?: AerodataboxFlightSegment | null;
  movement?: {
    departure?: AerodataboxFlightSegment | null;
    arrival?: AerodataboxFlightSegment | null;
  } | null;
  aircraft?: {
    model?: string | null;
    modelCode?: string | null;
    reg?: string | null;
    registration?: string | null;
    icao24?: string | null;
    hex?: string | null;
    manufacturer?: string | null;
  } | null;
  [key: string]: any;
}

export interface AerodataboxResult {
  routeData: RouteData;
  callsign?: string | null;
  registration?: string | null;
  aircraftModel?: string | null;
  flightKey?: string | null;
}

type RouteAirport = NonNullable<RouteData['departureAirport']>;

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_DAILY_BUDGET = 600; // conservative default to stay under monthly quota
const DEFAULT_BASE_URL = 'https://prod.api.market/api/v1/aedbx/aerodatabox';

export interface AerodataboxServiceOptions {
  baseUrl?: string | null;
  apiKey?: string | null;
  dailyBudget?: number | null;
}

export class AerodataboxService {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly dailyBudget: number;
  private flightCache: Map<string, { expiresAt: number; result: AerodataboxResult }>;
  private failureCache: Map<string, number>;
  private usageCounter: { dateKey: string; count: number };
  private loggedMissingKey = false;

  constructor(options?: AerodataboxServiceOptions) {
    const configSource = (config?.external?.aerodatabox ?? {}) as {
      baseUrl?: string;
      apiKey?: string;
      dailyBudget?: number;
    };
    const resolvedBaseUrl =
      options && Object.prototype.hasOwnProperty.call(options, 'baseUrl') ? options.baseUrl : configSource.baseUrl;
    const resolvedApiKey =
      options && Object.prototype.hasOwnProperty.call(options, 'apiKey') ? options.apiKey : configSource.apiKey;
    const resolvedDailyBudget =
      options && Object.prototype.hasOwnProperty.call(options, 'dailyBudget')
        ? options.dailyBudget
        : configSource.dailyBudget;

    this.baseUrl = String(resolvedBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey =
      typeof resolvedApiKey === 'string' && resolvedApiKey.trim() !== '' ? resolvedApiKey.trim() : undefined;
    this.dailyBudget =
      typeof resolvedDailyBudget === 'number' && Number.isFinite(resolvedDailyBudget) && resolvedDailyBudget > 0
        ? resolvedDailyBudget
        : DEFAULT_DAILY_BUDGET;
    this.flightCache = new Map();
    this.failureCache = new Map();
    this.usageCounter = { dateKey: this.getTodayKey(), count: 0 };
  }

  private getTodayKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}-${now
      .getUTCDate()
      .toString()
      .padStart(2, '0')}`;
  }

  private resetCounterIfNeeded(): void {
    const today = this.getTodayKey();
    if (this.usageCounter.dateKey !== today) {
      this.usageCounter = { dateKey: today, count: 0 };
    }
  }

  private canMakeRequest(): boolean {
    if (!this.apiKey) {
      if (!this.loggedMissingKey) {
        logger.warn('Aerodatabox API key not configured. Skipping enrichment requests.');
        this.loggedMissingKey = true;
      }
      return false;
    }
    this.resetCounterIfNeeded();
    if (this.usageCounter.count >= this.dailyBudget) {
      logger.debug('Aerodatabox daily budget reached, skipping request', { dailyBudget: this.dailyBudget });
      return false;
    }
    return true;
  }

  private recordUsage(): void {
    this.resetCounterIfNeeded();
    this.usageCounter.count += 1;
  }

  private getFailureCooldownKey(icao24: string): string {
    return icao24.trim().toLowerCase();
  }

  private isInFailureCooldown(icao24: string): boolean {
    const key = this.getFailureCooldownKey(icao24);
    const until = this.failureCache.get(key);
    if (!until) return false;
    if (Date.now() < until) {
      logger.debug('Skipping Aerodatabox lookup due to recent failure', { icao24 });
      return true;
    }
    this.failureCache.delete(key);
    return false;
  }

  private markFailure(icao24: string): void {
    const key = this.getFailureCooldownKey(icao24);
    this.failureCache.set(key, Date.now() + FAILURE_COOLDOWN_MS);
  }

  private getCacheKey(icao24: string, flightKey?: string | null): string {
    const base = icao24.trim().toLowerCase();
    return flightKey ? `${base}::${flightKey}` : base;
  }

  private getFromCache(icao24: string, flightKey?: string | null): AerodataboxResult | null {
    const key = this.getCacheKey(icao24, flightKey);
    const cached = this.flightCache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.flightCache.delete(key);
      return null;
    }
    return cached.result;
  }

  private storeInCache(icao24: string, result: AerodataboxResult, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
    const expiresAt = Date.now() + ttlMs;
    const keyWithFlight = this.getCacheKey(icao24, result.flightKey);
    this.flightCache.set(keyWithFlight, { expiresAt, result });

    if (result.flightKey) {
      const baseKey = this.getCacheKey(icao24);
      this.flightCache.set(baseKey, { expiresAt, result });
    }
  }

  private toEpochSeconds(timestamp?: string | null): number | null {
    if (!timestamp) return null;
    const time = Date.parse(timestamp);
    if (Number.isNaN(time)) return null;
    return Math.floor(time / 1000);
  }

  private mapAirport(segment?: AerodataboxFlightSegment | null): RouteAirport | undefined {
    if (!segment) return undefined;
    const airport = segment.airport || null;
    if (!airport) return undefined;

    return {
      iata: airport.iata || null,
      icao: airport.icao || null,
      name: airport.name || null,
    };
  }

  private deriveFlightKey(flight: AerodataboxFlightRecord): string | null {
    const departureTime =
      flight.departure?.actualTimeUtc ||
      flight.departure?.scheduledTimeUtc ||
      flight.movement?.departure?.actualTimeUtc ||
      flight.movement?.departure?.scheduledTimeUtc ||
      null;
    const arrivalTime =
      flight.arrival?.actualTimeUtc ||
      flight.arrival?.scheduledTimeUtc ||
      flight.movement?.arrival?.actualTimeUtc ||
      flight.movement?.arrival?.scheduledTimeUtc ||
      null;
    const callsign = flight.callsign || flight.number || null;

    if (!departureTime && !callsign) {
      return null;
    }

    return `${callsign || ''}|${departureTime || ''}|${arrivalTime || ''}`;
  }

  private mapFlightToRouteData(flight: AerodataboxFlightRecord, icao24: string): AerodataboxResult | null {
    if (!flight) return null;

    const departure = this.mapAirport(flight.departure || flight.movement?.departure || null);
    const arrival = this.mapAirport(flight.arrival || flight.movement?.arrival || null);

    const normalizedCallsign = flight.callsign?.trim() || flight.number?.trim() || null;
    if (!departure && !arrival && !normalizedCallsign) {
      return null;
    }

    const scheduledDeparture = this.toEpochSeconds(
      flight.departure?.scheduledTimeUtc || flight.movement?.departure?.scheduledTimeUtc,
    );
    const scheduledArrival = this.toEpochSeconds(
      flight.arrival?.scheduledTimeUtc || flight.movement?.arrival?.scheduledTimeUtc,
    );
    const actualDeparture = this.toEpochSeconds(
      flight.departure?.actualTimeUtc || flight.movement?.departure?.actualTimeUtc,
    );
    const actualArrival = this.toEpochSeconds(flight.arrival?.actualTimeUtc || flight.movement?.arrival?.actualTimeUtc);

    const routeData: RouteData = {
      callsign: normalizedCallsign,
      icao24: icao24.trim().toLowerCase(),
      departureAirport: departure,
      arrivalAirport: arrival,
      source: 'aerodatabox',
      aircraft:
        flight.aircraft?.model || flight.aircraft?.modelCode
          ? {
              model: flight.aircraft?.model || flight.aircraft?.modelCode || undefined,
              type: flight.aircraft?.modelCode || flight.aircraft?.model || undefined,
            }
          : undefined,
      flightStatus: flight.status || null,
      registration: flight.aircraft?.reg || flight.aircraft?.registration || null,
      flightData: {
        scheduledDeparture,
        scheduledArrival,
        actualDeparture,
        actualArrival,
      },
    };

    return {
      routeData,
      callsign: routeData.callsign,
      registration: routeData.registration || null,
      aircraftModel: routeData.aircraft?.model || null,
      flightKey: this.deriveFlightKey(flight),
    };
  }

  private extractFlights(payload: any): AerodataboxFlightRecord[] {
    if (!payload) {
      return [];
    }

    const results: AerodataboxFlightRecord[] = [];
    const pushRecord = (value: any) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === 'object') {
            results.push(item as AerodataboxFlightRecord);
          }
        });
      } else if (typeof value === 'object') {
        if (Array.isArray((value as any).data)) {
          pushRecord((value as any).data);
        } else if (Array.isArray((value as any).flights)) {
          pushRecord((value as any).flights);
        }
      }
    };

    pushRecord(payload.flights);
    pushRecord(payload.arrivals);
    pushRecord(payload.departures);
    pushRecord(payload.data);
    pushRecord(payload.results);
    pushRecord(payload.items);

    if (results.length === 0 && Array.isArray(payload)) {
      pushRecord(payload);
    }

    return results;
  }

  private pickBestFlight(records: AerodataboxFlightRecord[]): AerodataboxFlightRecord | null {
    if (!records || records.length === 0) {
      return null;
    }

    const normalizeStatus = (status?: string | null) => (status ? status.trim().toLowerCase() : '');
    const activeStatuses = new Set(['en route', 'in flight', 'departed', 'scheduled', 'boarding']);
    const inactiveStatuses = new Set(['landed', 'arrived', 'cancelled', 'diverted']);

    const active = records.filter((flight) => activeStatuses.has(normalizeStatus(flight.status)));
    if (active.length > 0) {
      return active[0];
    }

    const notCancelled = records.filter((flight) => !inactiveStatuses.has(normalizeStatus(flight.status)));
    if (notCancelled.length > 0) {
      return notCancelled[0];
    }

    return records[0];
  }

  async getFlightByIcao24(icao24: string): Promise<AerodataboxResult | null> {
    if (!icao24) {
      return null;
    }

    if (!this.canMakeRequest()) {
      return null;
    }

    if (this.isInFailureCooldown(icao24)) {
      return null;
    }

    const cached = this.getFromCache(icao24);
    if (cached) {
      logger.debug('Aerodatabox cache hit', { icao24 });
      return cached;
    }

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/flights/Icao24/${icao24.trim().toLowerCase()}`;
      logger.info('Querying Aerodatabox for flight data', { icao24, url });
      this.recordUsage();

      const response = await axios.get(url, {
        params: {
          dateLocalRole: 'Both',
          withAircraftImage: false,
          withLocation: true,
        },
        headers: {
          accept: 'application/json',
          'x-api-market-key': this.apiKey,
        },
        timeout: 8000,
      });

      const flights = this.extractFlights(response.data);
      if (!flights || flights.length === 0) {
        logger.debug('Aerodatabox returned no flights', { icao24 });
        this.markFailure(icao24);
        return null;
      }

      const bestFlight = this.pickBestFlight(flights);
      const mapped = this.mapFlightToRouteData(bestFlight, icao24);
      if (!mapped) {
        logger.debug('Aerodatabox flight could not be mapped', { icao24 });
        this.markFailure(icao24);
        return null;
      }

      this.storeInCache(icao24, mapped);
      return mapped;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 429) {
        logger.warn('Aerodatabox rate limit hit', { icao24 });
      } else {
        logger.warn('Aerodatabox request failed', {
          icao24,
          status,
          message: error?.message,
        });
      }
      this.markFailure(icao24);
      return null;
    }
  }
}

const aerodataboxService = new AerodataboxService();
export default aerodataboxService;
