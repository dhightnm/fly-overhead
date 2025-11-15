/**
 * Service interface type definitions
 * These define the contracts that services must implement
 */

import type { AircraftState, FlightRouteHistory } from './database.types';
import type { RouteData } from './api.types';

export interface IAircraftService {
  fetchAndUpdateAllAircraft(): Promise<void>;
  getAircraftInBounds(
    latmin: number,
    lonmin: number,
    latmax: number,
    lonmax: number
  ): Promise<AircraftState[]>;
  initializeDatabase(): Promise<void>;
  populateInitialData(): Promise<void>;
}

export interface IRouteRepository {
  cacheRoute(cacheKey: string, routeData: RouteData): Promise<void>;
  getCachedRoute(cacheKey: string): Promise<RouteData | null>;
  findHistoricalRoute(callsign: string, departureIcao: string): Promise<any>;
  findHistoricalRouteByIcao24(icao24: string, departureIcao: string): Promise<any>;
  storeRouteHistory(routeData: RouteData): Promise<void>;
  findFlightsNeedingBackfill(limit?: number): Promise<FlightRouteHistory[]>;
  findFlightsNeedingBackfillInRange(
    startDate: string,
    endDate: string,
    limit?: number
  ): Promise<FlightRouteHistory[]>;
  findFlightsMissingAllRecent(limit?: number): Promise<FlightRouteHistory[]>;
  updateFlightHistoryById(id: number, fields: Partial<FlightRouteHistory>): Promise<void>;
  getHistoricalRoutes(
    icao24: string,
    startDate?: Date,
    endDate?: Date,
    limit?: number
  ): Promise<any[]>;
  getLatestRouteHistory(icao24: string, callsign?: string | null): Promise<any>;
  getRouteStats(): Promise<any>;
}

export interface IUserRepository {
  getUserByEmail(email: string): Promise<any>;
  getUserByGoogleId(googleId: string): Promise<any>;
  getUserById(id: number): Promise<any>;
  createUser(userData: any): Promise<any>;
  createOrUpdateGoogleUser(googleProfile: any): Promise<any>;
  updateUserPremiumStatus(
    userId: number,
    isPremium: boolean,
    expiresAt?: Date | null
  ): Promise<any>;
}

export interface IFeederRepository {
  getFeederById(feederId: string): Promise<any>;
  registerFeeder(feederData: any): Promise<any>;
  updateFeederLastSeen(feederId: string): Promise<void>;
  upsertFeederStats(
    feederId: string,
    messagesReceived: number,
    uniqueAircraft: number
  ): Promise<void>;
  getFeederByApiKey(apiKey: string): Promise<any>;
}

export interface IApiKeyRepository {
  createApiKey(data: any): Promise<any>;
  getApiKeyByHash(keyHash: string): Promise<any>;
  validateApiKey(plainKey: string): Promise<any>;
  getApiKeyById(keyId: string): Promise<any>;
  listApiKeys(filters?: any): Promise<any[]>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  revokeApiKey(keyId: string, revokedBy?: number | null, reason?: string | null): Promise<any>;
  updateApiKey(keyId: string, updates: any): Promise<any>;
}

export interface IPostGISService {
  initialize(): Promise<void>;
  createGeometryTriggers(): Promise<void>;
  findAircraftNearPoint(
    latitude: number,
    longitude: number,
    radiusMeters?: number
  ): Promise<any>;
  findAircraftInPolygon(polygonCoordinates: number[][]): Promise<any>;
  getFlightPathGeoJSON(
    icao24: string,
    startTime?: Date | null,
    endTime?: Date | null
  ): Promise<any>;
  getTrafficDensity(bounds: any, cellSizeDegrees?: number): Promise<any>;
  findSpottingLocations(
    airportLat: number,
    airportLon: number,
    radiusKm?: number
  ): Promise<any>;
}
