/**
 * Repository module exports
 * Provides a unified interface to all data repositories
 */

const { getConnection } = require('./DatabaseConnection');
const SchemaRepository = require('./SchemaRepository');

// Lazy-load repositories to avoid circular dependencies
let aircraftRepository = null;
let routeRepository = null;
let userRepository = null;
let feederRepository = null;
let apiKeyRepository = null;
let airportRepository = null;

/**
 * Main PostgresRepository facade
 * Maintains backward compatibility while delegating to specialized repositories
 */
class PostgresRepository {
  constructor() {
    this.connection = getConnection();
    this.db = this.connection.getDb();
    this.postgis = this.connection.getPostGIS();
    this.schema = new SchemaRepository();
  }

  // Delegate schema methods
  async createMainTable() { return this.schema.createMainTable(); }
  async createAircraftStatesIndexes() { return this.schema.createAircraftStatesIndexes(); }
  async createHistoryTable() { return this.schema.createHistoryTable(); }
  async createHistoryTableIndexes() { return this.schema.createHistoryTableIndexes(); }
  async createFlightRoutesTable() { return this.schema.createFlightRoutesTable(); }
  async createUsersTable() { return this.schema.createUsersTable(); }
  async createFeedersTable() { return this.schema.createFeedersTable(); }
  async createFeederStatsTable() { return this.schema.createFeederStatsTable(); }
  async addFeederColumnsToAircraftStates() { return this.schema.addFeederColumnsToAircraftStates(); }
  async addFeederColumnsToAircraftStatesHistory() { return this.schema.addFeederColumnsToAircraftStatesHistory(); }
  async initializePostGIS() { return this.connection.initializePostGIS(); }
  getDb() { return this.db; }

  // Lazy-load specialized repositories
  get _aircraft() {
    if (!aircraftRepository) {
      aircraftRepository = require('./AircraftRepository');
    }
    return new aircraftRepository(this.db, this.postgis);
  }

  get _route() {
    if (!routeRepository) {
      routeRepository = require('./RouteRepository');
    }
    return new routeRepository(this.db);
  }

  get _user() {
    if (!userRepository) {
      userRepository = require('./UserRepository');
    }
    return new userRepository(this.db);
  }

  get _feeder() {
    if (!feederRepository) {
      feederRepository = require('./FeederRepository');
    }
    return new feederRepository(this.db);
  }

  get _apiKey() {
    if (!apiKeyRepository) {
      apiKeyRepository = require('./ApiKeyRepository');
    }
    return new apiKeyRepository(this.db);
  }

  get _airport() {
    if (!airportRepository) {
      airportRepository = require('./AirportRepository');
    }
    return new airportRepository(this.db, this.postgis);
  }

  // Delegate aircraft methods
  async upsertAircraftState(state) { return this._aircraft.upsertAircraftState(state); }
  async findAircraftByIdentifier(identifier) { return this._aircraft.findAircraftByIdentifier(identifier); }
  async findAircraftInBounds(...args) { return this._aircraft.findAircraftInBounds(...args); }
  async updateAircraftCategory(...args) { return this._aircraft.updateAircraftCategory(...args); }
  async findAircraftHistory(...args) { return this._aircraft.findAircraftHistory(...args); }
  async findMultipleAircraftHistory(...args) { return this._aircraft.findMultipleAircraftHistory(...args); }
  async findRecentAircraftWithoutRoutes(...args) { return this._aircraft.findRecentAircraftWithoutRoutes(...args); }
  async upsertAircraftStateWithPriority(...args) { return this._aircraft.upsertAircraftStateWithPriority(...args); }

  // Delegate route methods
  async cacheRoute(...args) { return this._route.cacheRoute(...args); }
  async getCachedRoute(...args) { return this._route.getCachedRoute(...args); }
  async findHistoricalRoute(...args) { return this._route.findHistoricalRoute(...args); }
  async findHistoricalRouteByIcao24(...args) { return this._route.findHistoricalRouteByIcao24(...args); }
  async storeRouteHistory(...args) { return this._route.storeRouteHistory(...args); }
  async findFlightsNeedingBackfill(...args) { return this._route.findFlightsNeedingBackfill(...args); }
  async findFlightsNeedingBackfillInRange(...args) { return this._route.findFlightsNeedingBackfillInRange(...args); }
  async findFlightsMissingAllRecent(...args) { return this._route.findFlightsMissingAllRecent(...args); }
  async updateFlightHistoryById(...args) { return this._route.updateFlightHistoryById(...args); }
  async getHistoricalRoutes(...args) { return this._route.getHistoricalRoutes(...args); }
  async getLatestRouteHistory(...args) { return this._route.getLatestRouteHistory(...args); }
  async getRouteStats() { return this._route.getRouteStats(); }

  // Delegate user methods
  async getUserByEmail(...args) { return this._user.getUserByEmail(...args); }
  async getUserByGoogleId(...args) { return this._user.getUserByGoogleId(...args); }
  async getUserById(...args) { return this._user.getUserById(...args); }
  async createUser(...args) { return this._user.createUser(...args); }
  async createOrUpdateGoogleUser(...args) { return this._user.createOrUpdateGoogleUser(...args); }
  async updateUserPremiumStatus(...args) { return this._user.updateUserPremiumStatus(...args); }

  // Delegate feeder methods
  async getFeederById(...args) { return this._feeder.getFeederById(...args); }
  async registerFeeder(...args) { return this._feeder.registerFeeder(...args); }
  async updateFeederLastSeen(...args) { return this._feeder.updateFeederLastSeen(...args); }
  async upsertFeederStats(...args) { return this._feeder.upsertFeederStats(...args); }
  async getFeederByApiKey(...args) { return this._feeder.getFeederByApiKey(...args); }

  // Delegate API key methods
  async createApiKey(...args) { return this._apiKey.createApiKey(...args); }
  async getApiKeyByHash(...args) { return this._apiKey.getApiKeyByHash(...args); }
  async validateApiKey(...args) { return this._apiKey.validateApiKey(...args); }
  async getApiKeyById(...args) { return this._apiKey.getApiKeyById(...args); }
  async listApiKeys(...args) { return this._apiKey.listApiKeys(...args); }
  async updateApiKeyLastUsed(...args) { return this._apiKey.updateApiKeyLastUsed(...args); }
  async revokeApiKey(...args) { return this._apiKey.revokeApiKey(...args); }
  async updateApiKey(...args) { return this._apiKey.updateApiKey(...args); }

  // Delegate airport methods
  async findAirportsNearPoint(...args) { return this._airport.findAirportsNearPoint(...args); }
  async findAirportByCode(...args) { return this._airport.findAirportByCode(...args); }
  async findAirportsInBounds(...args) { return this._airport.findAirportsInBounds(...args); }
  async findNavaidsNearPoint(...args) { return this._airport.findNavaidsNearPoint(...args); }
  async searchAirports(...args) { return this._airport.searchAirports(...args); }

  // Delegate PostGIS methods
  async findAircraftNearPoint(...args) { return this.postgis.findAircraftNearPoint(...args); }
  async findAircraftInPolygon(...args) { return this.postgis.findAircraftInPolygon(...args); }
  async getFlightPathGeoJSON(...args) { return this.postgis.getFlightPathGeoJSON(...args); }
  async getTrafficDensity(...args) { return this.postgis.getTrafficDensity(...args); }
  async findSpottingLocations(...args) { return this.postgis.findSpottingLocations(...args); }
}

// Export singleton instance for backward compatibility
const repository = new PostgresRepository();

// Also export the class for advanced usage
module.exports = repository;
module.exports.PostgresRepository = PostgresRepository;

