const postgresRepository = require('../repositories/PostgresRepository');
const openSkyService = require('./OpenSkyService');
const flightRouteService = require('./FlightRouteService');
const trajectoryPredictionService = require('./TrajectoryPredictionService');
const webSocketService = require('./WebSocketService');
const rateLimitManager = require('./RateLimitManager');
const config = require('../config');
const logger = require('../utils/logger');
const { mapAircraftType } = require('../utils/aircraftCategoryMapper');

/**
 * Business logic layer for aircraft operations
 * Orchestrates repository and external service calls
 */
class AircraftService {
  /**
   * Fetch all aircraft and update database
   */
  // eslint-disable-next-line class-methods-use-this
  async fetchAndUpdateAllAircraft() {
    try {
      logger.info('Fetching all aircraft from OpenSky');
      const data = await openSkyService.getAllStates();

      if (!data.states || data.states.length === 0) {
        logger.warn('No aircraft states returned from OpenSky');
        return [];
      }

      logger.info(`Processing ${data.states.length} aircraft states`);

      const BATCH_SIZE = 50;
      let processed = 0;

      for (let i = 0; i < data.states.length; i += BATCH_SIZE) {
        const batch = data.states.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((state) => {
          const preparedState = openSkyService.prepareStateForDatabase(state);
          // Use priority system: OpenSky has priority 30 (lower = higher priority)
          // Feeder has priority 10 (high priority), so feeder data is preferred
          return postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);
        });

        await Promise.all(batchPromises);
        processed += batch.length;

        if ((i / BATCH_SIZE) % 5 === 0) {
          logger.debug(`Processed ${processed}/${data.states.length} aircraft`);
        }

        if (i + BATCH_SIZE < data.states.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      logger.info(`Database updated successfully with all ${processed} aircraft`);

      // Broadcast update signal to all connected clients
      // Frontend will refresh their bounds query to get updated positions
      const io = webSocketService.getIO();
      if (io && io.sockets.sockets.size > 0) {
        logger.info(`Broadcasting global refresh signal to ${io.sockets.sockets.size} WebSocket clients`);
        io.emit('aircraft:update', {
          type: 'refresh_required',
          timestamp: new Date().toISOString(),
          message: 'Aircraft positions updated - refresh your view',
          count: processed,
        });
      }

      return data.states;
    } catch (error) {
      // Check if it's a rate limit error
      if (error.rateLimited) {
        logger.warn('OpenSky fetch skipped due to rate limiting', {
          retryAfter: error.retryAfter,
          retryAt: new Date(Date.now() + error.retryAfter * 1000).toISOString(),
        });
        // Don't throw - just skip this fetch cycle
        return [];
      }

      logger.error('Error in fetchAndUpdateAllAircraft', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch and update aircraft for specific bounding box
   * Uses OpenSky API for geographic bounds queries
   */
  // eslint-disable-next-line class-methods-use-this
  async fetchAndUpdateAircraftInBounds(boundingBox) {
    try {
      logger.info('Fetching aircraft in bounding box', { boundingBox });

      const data = await openSkyService.getStatesInBounds(boundingBox);

      if (!data.states || data.states.length === 0) {
        logger.info('No aircraft in specified bounds');
        return [];
      }

      logger.info(`Processing ${data.states.length} aircraft in bounds from OpenSky`);

      const statePromises = data.states.map((state) => {
        const preparedState = openSkyService.prepareStateForDatabase(state);
        // Use priority system: OpenSky has priority 30 (lower = higher priority)
        // Feeder has priority 10 (high priority), so feeder data is preferred
        return postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);
      });

      await Promise.all(statePromises);
      logger.info('Database updated with bounded aircraft from OpenSky');

      return data.states;
    } catch (error) {
      // Check if it's a rate limit error
      if (error.rateLimited) {
        logger.warn('OpenSky bounded fetch skipped due to rate limiting', {
          boundingBox,
          retryAfter: error.retryAfter,
        });
        // Don't throw - just return empty array to allow app to continue
        return [];
      }

      logger.error('Error in fetchAndUpdateAircraftInBounds', {
        boundingBox,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get aircraft by identifier (icao24 or callsign)
   */
  // eslint-disable-next-line class-methods-use-this
  async getAircraftByIdentifier(identifier) {
    try {
      logger.info(`Searching for aircraft: ${identifier} (checking database)`);

      // Query database directly instead of calling OpenSky getAllStates()
      // This avoids fetching 6000+ aircraft just to find one
      const results = await postgresRepository.findAircraftByIdentifier(identifier);

      if (results.length === 0) {
        logger.info(`No aircraft found for identifier: ${identifier}`);
        return null;
      }

      const aircraft = results[0];
      logger.info(`Found aircraft in database for identifier: ${identifier}`, {
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
        last_contact: aircraft.last_contact,
      });

      return aircraft;
    } catch (error) {
      logger.error('Error in getAircraftByIdentifier', {
        identifier,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Enrich aircraft data with route information and model/type
   * Takes raw database result (with JOINed route data) and formats it for frontend
   */
  // eslint-disable-next-line class-methods-use-this
  _enrichAircraftWithRoute(aircraft) {
    const enriched = { ...aircraft };

    // Extract route data if available
    const hasRouteData = aircraft.departure_icao || aircraft.departure_iata
      || aircraft.arrival_icao || aircraft.arrival_iata
      || aircraft.aircraft_type;

    if (hasRouteData) {
      // Build route object
      enriched.route = {
        departureAirport: (aircraft.departure_icao || aircraft.departure_iata) ? {
          icao: aircraft.departure_icao || null,
          iata: aircraft.departure_iata || null,
          name: aircraft.departure_name || null,
        } : null,
        arrivalAirport: (aircraft.arrival_icao || aircraft.arrival_iata) ? {
          icao: aircraft.arrival_icao || null,
          iata: aircraft.arrival_iata || null,
          name: aircraft.arrival_name || null,
        } : null,
        source: aircraft.route_source || null,
      };

      // Enrich with aircraft model/type if aircraft_type is available
      if (aircraft.aircraft_type) {
        const aircraftInfo = mapAircraftType(aircraft.aircraft_type);
        enriched.route.aircraft = {
          type: aircraftInfo.type, // Display type (e.g., "Heavy", "Plane") - matches frontend expectation
          model: aircraftInfo.model, // Human-readable model (e.g., "737-800")
          category: aircraftInfo.category, // Category code for icon selection
        };

        // Update category in aircraft if not set or unreliable (0)
        // This ensures icons are correct on load
        if (aircraftInfo.category !== null
          && (enriched.category === null || enriched.category === 0)) {
          enriched.category = aircraftInfo.category;

          // Update category in database asynchronously (don't block response)
          postgresRepository.updateAircraftCategory(enriched.icao24, aircraftInfo.category)
            .catch((err) => {
              logger.debug('Failed to update aircraft category', {
                icao24: enriched.icao24,
                error: err.message,
              });
            });
        }
      }
    }

    // Also check flight_routes_cache for callsign if aircraft doesn't have one
    // This uses the route data that was fetched when user clicked on the plane
    if (!enriched.callsign && enriched.icao24) {
      // The route data is already JOINed in the query, but we need to check if there's a cached route
      // with a callsign. This will be handled by the frontend route fetching, but we can also
      // enrich here if the route cache has callsign data
      // Note: The route cache JOIN already provides this, but we need to check the cache table
      // For now, the frontend will fetch route on click which will populate callsign
    }

    // Clean up route-specific fields from main aircraft object
    delete enriched.departure_iata;
    delete enriched.departure_icao;
    delete enriched.departure_name;
    delete enriched.arrival_iata;
    delete enriched.arrival_icao;
    delete enriched.arrival_name;
    delete enriched.aircraft_type;
    delete enriched.route_source;
    delete enriched.route_created_at;

    return enriched;
  }

  /**
   * Get aircraft within geographical bounds (with trajectory prediction)
   * Uses route data to extrapolate positions between real API updates
   * Now includes route data from cache (no API call needed if cached)
   * In development mode when rate limited, shows stale aircraft with a flag
   */
  // eslint-disable-next-line class-methods-use-this
  async getAircraftInBounds(latmin, lonmin, latmax, lonmax) {
    try {
      const isDevelopment = config.server.env === 'development';
      const isRateLimited = rateLimitManager.isRateLimited();

      // In development, when rate limited, use extended threshold to show stale data
      let contactThreshold = config.aircraft.recentContactThreshold;
      if (isDevelopment && isRateLimited) {
        contactThreshold = config.aircraft.devModeStaleThreshold;
        logger.debug('Using extended threshold for development (rate limited)', {
          normalThreshold: config.aircraft.recentContactThreshold,
          devThreshold: contactThreshold,
        });
      }

      const thresholdTimestamp = Math.floor(Date.now() / 1000) - contactThreshold;

      const results = await postgresRepository.findAircraftInBounds(
        latmin,
        lonmin,
        latmax,
        lonmax,
        thresholdTimestamp,
      );

      // Enrich with route data and model/type
      const enrichedWithRoutes = results.map((aircraft) => this._enrichAircraftWithRoute(aircraft));

      // Mark stale aircraft in development mode when rate limited BEFORE trajectory prediction
      // This ensures the isStale flag is preserved when the prediction service creates new objects
      // Mark stale aircraft from BOTH feeder and OpenSky sources
      const now = Math.floor(Date.now() / 1000);
      const normalThreshold = now - config.aircraft.recentContactThreshold;

      if (isDevelopment && isRateLimited) {
        enrichedWithRoutes.forEach((aircraft) => {
          // Mark as stale if older than normal threshold but within dev threshold
          // Works for both feeder and OpenSky data sources
          if (aircraft.last_contact && aircraft.last_contact < normalThreshold) {
            aircraft.isStale = true;
            aircraft.staleReason = 'rate_limited';
            aircraft.ageMinutes = Math.floor((now - aircraft.last_contact) / 60);
            // Log which data source is stale for debugging
            logger.debug('Marking aircraft as stale', {
              icao24: aircraft.icao24,
              data_source: aircraft.data_source,
              ageMinutes: aircraft.ageMinutes,
            });
          }
        });
      }

      const enhanced = await trajectoryPredictionService.enhanceAircraftWithPredictions(
        enrichedWithRoutes,
      );

      const predictedCount = enhanced.filter((a) => a.predicted).length;
      const routesCount = enhanced.filter((a) => a.route).length;
      const staleCount = enhanced.filter((a) => a.isStale).length;

      if (predictedCount > 0) {
        logger.debug(`Applied trajectory predictions to ${predictedCount}/${enhanced.length} aircraft`);
      }

      if (routesCount > 0) {
        logger.info(`Included route data for ${routesCount}/${enhanced.length} aircraft (from cache)`);
      }

      if (staleCount > 0) {
        logger.info(`Returning ${staleCount} stale aircraft (dev mode, rate limited)`);
      }

      logger.info(`Returning ${enhanced.length} aircraft (${enhanced.length - staleCount} fresh, ${staleCount} stale)`);
      return enhanced;
    } catch (error) {
      logger.error('Error in getAircraftInBounds', {
        bounds: {
          latmin, lonmin, latmax, lonmax,
        },
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  // eslint-disable-next-line class-methods-use-this
  async initializeDatabase() {
    try {
      await postgresRepository.createMainTable();
      await postgresRepository.createHistoryTable();
      await postgresRepository.createFlightRoutesTable();
      await postgresRepository.createUsersTable();
      // Feeder service tables
      await postgresRepository.createFeedersTable();
      await postgresRepository.createFeederStatsTable();
      await postgresRepository.addFeederColumnsToAircraftStates();
      await postgresRepository.addFeederColumnsToAircraftStatesHistory();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Error initializing database', { error: error.message });
      throw error;
    }
  }

  /**
   * Populate database with initial data
   */
  async populateInitialData() {
    try {
      const boundingBoxes = [
        {
          lamin: -90, lomin: -180, lamax: 0, lomax: 0,
        },
        {
          lamin: 0, lomin: -180, lamax: 90, lomax: 0,
        },
        {
          lamin: -90, lomin: 0, lamax: 0, lomax: 180,
        },
        {
          lamin: 0, lomin: 0, lamax: 90, lomax: 180,
        },
      ];

      const promises = boundingBoxes.map((box) => this.fetchAndUpdateAircraftInBounds(box));

      await Promise.all(promises);
      logger.info('Initial data population complete');
    } catch (error) {
      logger.error('Error populating initial data', { error: error.message });
      throw error;
    }
  }
}

module.exports = new AircraftService();
