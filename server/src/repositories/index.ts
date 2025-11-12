import pgPromise from 'pg-promise';
import { getConnection } from './DatabaseConnection';
import SchemaRepository from './SchemaRepository';
import AircraftRepository from './AircraftRepository';
import RouteRepository from './RouteRepository';
import UserRepository from './UserRepository';
import FeederRepository from './FeederRepository';
import ApiKeyRepository from './ApiKeyRepository';
import AirportRepository from './AirportRepository';
import PostGISService from '../services/PostGISService';

/**
 * Main PostgresRepository facade
 * Maintains backward compatibility while delegating to specialized repositories
 */
class PostgresRepository {
  private connection: ReturnType<typeof getConnection>;
  private db: pgPromise.IDatabase<any>;
  private postgis: PostGISService;
  private schema: SchemaRepository;
  private _aircraft: AircraftRepository | null = null;
  private _route: RouteRepository | null = null;
  private _user: UserRepository | null = null;
  private _feeder: FeederRepository | null = null;
  private _apiKey: ApiKeyRepository | null = null;
  private _airport: AirportRepository | null = null;

  constructor() {
    this.connection = getConnection();
    this.db = this.connection.getDb();
    this.postgis = this.connection.getPostGIS();
    this.schema = new SchemaRepository();
  }

  // Schema methods
  async createMainTable(): Promise<void> { return this.schema.createMainTable(); }
  async createAircraftStatesIndexes(): Promise<void> { return this.schema.createAircraftStatesIndexes(); }
  async createHistoryTable(): Promise<void> { return this.schema.createHistoryTable(); }
  async createHistoryTableIndexes(): Promise<void> { return this.schema.createHistoryTableIndexes(); }
  async createFlightRoutesTable(): Promise<void> { return this.schema.createFlightRoutesTable(); }
  async createFeedersTable(): Promise<void> { return this.schema.createFeedersTable(); }
  async createFeederStatsTable(): Promise<void> { return this.schema.createFeederStatsTable(); }
  async addFeederColumnsToAircraftStates(): Promise<void> { return this.schema.addFeederColumnsToAircraftStates(); }
  async addFeederColumnsToAircraftStatesHistory(): Promise<void> { return this.schema.addFeederColumnsToAircraftStatesHistory(); }
  async createUsersTable(): Promise<void> { return this.schema.createUsersTable(); }
  async addFeederProviderColumnToUsers(): Promise<void> { return this.schema.addFeederProviderColumnToUsers(); }
  async initializeAll(): Promise<void> { return this.schema.initializeAll(); }
  async initializePostGIS(): Promise<void> { return this.connection.initializePostGIS(); }
  getDb() { return this.db; }

  // Lazy-load specialized repositories
  private get aircraft(): AircraftRepository {
    if (!this._aircraft) {
      this._aircraft = new AircraftRepository(this.db, this.postgis);
    }
    return this._aircraft;
  }

  private get route(): RouteRepository {
    if (!this._route) {
      this._route = new RouteRepository(this.db);
    }
    return this._route;
  }

  private get user(): UserRepository {
    if (!this._user) {
      this._user = new UserRepository(this.db);
    }
    return this._user;
  }

  private get feeder(): FeederRepository {
    if (!this._feeder) {
      this._feeder = new FeederRepository(this.db);
    }
    return this._feeder;
  }

  private get apiKey(): ApiKeyRepository {
    if (!this._apiKey) {
      this._apiKey = new ApiKeyRepository(this.db);
    }
    return this._apiKey;
  }

  private get airport(): AirportRepository {
    if (!this._airport) {
      this._airport = new AirportRepository(this.db, this.postgis);
    }
    return this._airport;
  }

  // Delegate aircraft methods
  async upsertAircraftState(state: any): Promise<void> { return this.aircraft.upsertAircraftState(state); }
  async findAircraftByIdentifier(identifier: string): Promise<any> { return this.aircraft.findAircraftByIdentifier(identifier); }
  async findAircraftInBounds(latmin: number, lonmin: number, latmax: number, lonmax: number, recentContactThreshold: number): Promise<any> { return this.aircraft.findAircraftInBounds(latmin, lonmin, latmax, lonmax, recentContactThreshold); }
  async updateAircraftCategory(icao24: string, category: number | null): Promise<void> { return this.aircraft.updateAircraftCategory(icao24, category); }
  async updateAircraftCallsign(icao24: string, callsign: string | null): Promise<void> { return this.aircraft.updateAircraftCallsign(icao24, callsign); }
  async findAircraftHistory(icao24: string, startTime?: Date | null, endTime?: Date | null): Promise<any> { return this.aircraft.findAircraftHistory(icao24, startTime, endTime); }
  async findMultipleAircraftHistory(icao24s: string[], startTime?: Date | null, endTime?: Date | null): Promise<any> { return this.aircraft.findMultipleAircraftHistory(icao24s, startTime, endTime); }
  async findRecentAircraftWithoutRoutes(minLastContact: number, limit?: number): Promise<any> { return this.aircraft.findRecentAircraftWithoutRoutes(minLastContact, limit); }
  async upsertAircraftStateWithPriority(state: any, feederId: string | null, ingestionTimestamp: Date | null, dataSource?: string, sourcePriority?: number): Promise<void> { return this.aircraft.upsertAircraftStateWithPriority(state, feederId, ingestionTimestamp, dataSource, sourcePriority); }

  // Delegate route methods
  async cacheRoute(cacheKey: string, routeData: any): Promise<void> { return this.route.cacheRoute(cacheKey, routeData); }
  async getCachedRoute(cacheKey: string): Promise<any> { return this.route.getCachedRoute(cacheKey); }
  async findHistoricalRoute(callsign: string, departureIcao: string): Promise<any> { return this.route.findHistoricalRoute(callsign, departureIcao); }
  async findHistoricalRouteByIcao24(icao24: string, departureIcao: string): Promise<any> { return this.route.findHistoricalRouteByIcao24(icao24, departureIcao); }
  async storeRouteHistory(routeData: any): Promise<void> { return this.route.storeRouteHistory(routeData); }
  async findFlightsNeedingBackfill(limit?: number): Promise<any> { return this.route.findFlightsNeedingBackfill(limit); }
  async findFlightsNeedingBackfillInRange(startDate: string, endDate: string, limit?: number): Promise<any> { return this.route.findFlightsNeedingBackfillInRange(startDate, endDate, limit); }
  async findFlightsMissingAllRecent(limit?: number): Promise<any> { return this.route.findFlightsMissingAllRecent(limit); }
  async updateFlightHistoryById(id: number, fields: any): Promise<void> { return this.route.updateFlightHistoryById(id, fields); }
  async getHistoricalRoutes(icao24: string, startDate?: Date | null, endDate?: Date | null, limit?: number): Promise<any> { return this.route.getHistoricalRoutes(icao24, startDate, endDate, limit); }
  async getLatestRouteHistory(icao24: string, callsign?: string | null): Promise<any> { return this.route.getLatestRouteHistory(icao24, callsign); }
  async getRouteStats(): Promise<any> { return this.route.getRouteStats(); }

  // Delegate user methods
  async getUserByEmail(email: string): Promise<any> { return this.user.getUserByEmail(email); }
  async getUserByGoogleId(googleId: string): Promise<any> { return this.user.getUserByGoogleId(googleId); }
  async getUserById(id: number): Promise<any> { return this.user.getUserById(id); }
  async createUser(userData: any): Promise<any> { return this.user.createUser(userData); }
  async createOrUpdateGoogleUser(googleProfile: any): Promise<any> { return this.user.createOrUpdateGoogleUser(googleProfile); }
  async updateUserPremiumStatus(userId: number, isPremium: boolean, expiresAt?: Date | null): Promise<any> { return this.user.updateUserPremiumStatus(userId, isPremium, expiresAt); }
  async updateUserFeederProviderStatus(userId: number, isFeederProvider: boolean): Promise<any> { return this.user.updateUserFeederProviderStatus(userId, isFeederProvider); }

  // Delegate feeder methods
  async getFeederById(feederId: string): Promise<any> { return this.feeder.getFeederById(feederId); }
  async registerFeeder(feederData: any): Promise<any> { return this.feeder.registerFeeder(feederData); }
  async updateFeederLastSeen(feederId: string): Promise<void> { return this.feeder.updateFeederLastSeen(feederId); }
  async upsertFeederStats(feederId: string, messagesReceived: number, uniqueAircraft: number): Promise<void> { return this.feeder.upsertFeederStats(feederId, messagesReceived, uniqueAircraft); }
  async getFeederByApiKey(apiKey: string): Promise<any> { return this.feeder.getFeederByApiKey(apiKey); }

  // Delegate API key methods
  async createApiKey(data: any): Promise<any> { return this.apiKey.createApiKey(data); }
  async getApiKeyByHash(keyHash: string): Promise<any> { return this.apiKey.getApiKeyByHash(keyHash); }
  async validateApiKey(plainKey: string): Promise<any> { return this.apiKey.validateApiKey(plainKey); }
  async getApiKeyById(keyId: string): Promise<any> { return this.apiKey.getApiKeyById(keyId); }
  async listApiKeys(filters?: any): Promise<any> { return this.apiKey.listApiKeys(filters); }
  async updateApiKeyLastUsed(id: number): Promise<void> { return this.apiKey.updateApiKeyLastUsed(id); }
  async revokeApiKey(keyId: string, revokedBy?: number | null, reason?: string | null): Promise<any> { return this.apiKey.revokeApiKey(keyId, revokedBy, reason); }
  async updateApiKey(keyId: string, updates: any): Promise<any> { return this.apiKey.updateApiKey(keyId, updates); }

  // Delegate airport methods
  async findAirportsNearPoint(latitude: number, longitude: number, radiusKm?: number, airportType?: string | null): Promise<any> { return this.airport.findAirportsNearPoint(latitude, longitude, radiusKm, airportType); }
  async findAirportByCode(code: string): Promise<any> { return this.airport.findAirportByCode(code); }
  async findAirportsInBounds(latmin: number, lonmin: number, latmax: number, lonmax: number, airportType?: string | null, limit?: number): Promise<any> { return this.airport.findAirportsInBounds(latmin, lonmin, latmax, lonmax, airportType, limit); }
  async findNavaidsNearPoint(latitude: number, longitude: number, radiusKm?: number, navaidType?: string | null): Promise<any> { return this.airport.findNavaidsNearPoint(latitude, longitude, radiusKm, navaidType); }
  async searchAirports(searchTerm: string, limit?: number): Promise<any> { return this.airport.searchAirports(searchTerm, limit); }
}

// Export singleton instance for backward compatibility
const repository = new PostgresRepository();

export default repository;
export { PostgresRepository };

