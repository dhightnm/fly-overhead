import postgresRepository from '../repositories/PostgresRepository';
import openSkyService from './OpenSkyService';
import trajectoryPredictionService from './TrajectoryPredictionService';
import webSocketService from './WebSocketService';
import rateLimitManager from './RateLimitManager';
import config from '../config';
import logger from '../utils/logger';
import { mapAircraftType } from '../utils/aircraftCategoryMapper';
import { initializeAirportSchema } from '../database/airportSchema';

interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

interface RateLimitError extends Error {
  rateLimited?: boolean;
  retryAfter?: number | null;
}

/**
 * Business logic layer for aircraft operations
 * Orchestrates repository and external service calls
 */
class AircraftService {
  /**
   * Fetch all aircraft and update database
   */
  async fetchAndUpdateAllAircraft(): Promise<any[]> {
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
        const batchPromises = batch.map((state: any[]) => {
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

      // Clear bounds cache so fresh data is returned on next request
      // Use dynamic import to avoid circular dependency
      try {
        const aircraftRoutes = await import('../routes/aircraft.routes');
        if (aircraftRoutes && aircraftRoutes.boundsCache) {
          aircraftRoutes.boundsCache.flushAll();
          logger.info('Cleared bounds cache after OpenSky update');
        } else {
          logger.warn('boundsCache not found in aircraft.routes module');
        }
      } catch (err) {
        const error = err as Error;
        logger.error('Failed to clear bounds cache', { error: error.message, stack: error.stack });
      }

      webSocketService.getIO()?.emit('aircraft:global_update', {
        timestamp: new Date().toISOString(),
        message: 'Aircraft data updated',
      });

      return data.states;
    } catch (error) {
      const err = error as RateLimitError;
      // Check if it's a rate limit error
      if (err.rateLimited) {
        logger.warn('OpenSky fetch skipped due to rate limiting', {
          retryAfter: err.retryAfter,
          retryAt: err.retryAfter ? new Date(Date.now() + err.retryAfter * 1000).toISOString() : null,
        });
        // Don't throw - just skip this fetch cycle
        return [];
      }
      
      logger.error('Error in fetchAndUpdateAllAircraft', { error: err.message });
      throw error;
    }
  }

  /**
   * Fetch and update aircraft for specific bounding box
   * Uses OpenSky API for geographic bounds queries
   */
  async fetchAndUpdateAircraftInBounds(boundingBox: BoundingBox): Promise<any[]> {
    try {
      logger.info('Fetching aircraft in bounding box', { boundingBox });

      const data = await openSkyService.getStatesInBounds(boundingBox);

      if (!data.states || data.states.length === 0) {
        logger.info('No aircraft in specified bounds');
        return [];
      }

      logger.info(`Processing ${data.states.length} aircraft in bounds from OpenSky`);
      
      // Debug: Log a sample aircraft to verify data
      if (data.states.length > 0) {
        const sampleState = data.states[0];
        logger.debug('Sample bounded aircraft from OpenSky', {
          icao24: sampleState[0],
          callsign: sampleState[1],
          last_contact: sampleState[4],
          last_contact_age_seconds: Math.floor(Date.now() / 1000) - sampleState[4],
        });
      }

      const statePromises = data.states.map((state: any[]) => {
        const preparedState = openSkyService.prepareStateForDatabase(state);
        // Use priority system: OpenSky has priority 30 (lower = higher priority)
        // Feeder has priority 10 (high priority), so feeder data is preferred
        return postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);
      });

      await Promise.all(statePromises);
      logger.info('Database updated with bounded aircraft from OpenSky');

      // Clear bounds cache so fresh data is returned on next request
      // Use dynamic import to avoid circular dependency
      try {
        const aircraftRoutes = await import('../routes/aircraft.routes');
        if (aircraftRoutes && aircraftRoutes.boundsCache) {
          aircraftRoutes.boundsCache.flushAll();
          logger.info('Cleared bounds cache after bounded OpenSky update');
        } else {
          logger.warn('boundsCache not found in aircraft.routes module');
        }
      } catch (err) {
        const error = err as Error;
        logger.error('Failed to clear bounds cache', { error: error.message, stack: error.stack });
      }

      return data.states;
    } catch (error) {
      const err = error as RateLimitError;
      // Check if it's a rate limit error
      if (err.rateLimited) {
        logger.warn('OpenSky bounded fetch skipped due to rate limiting', {
          boundingBox,
          retryAfter: err.retryAfter,
        });
        // Don't throw - just return empty array to allow app to continue
        return [];
      }
      
      logger.error('Error in fetchAndUpdateAircraftInBounds', {
        boundingBox,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get aircraft by identifier (icao24 or callsign)
   */
  async getAircraftByIdentifier(identifier: string): Promise<any | null> {
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
      const err = error as Error;
      logger.error('Error in getAircraftByIdentifier', {
        identifier,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Enrich aircraft data with route information and model/type
   * Takes raw database result (with JOINed route data) and formats it for frontend
   */
  private _enrichAircraftWithRoute(aircraft: any): any {
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
        const aircraftInfo = mapAircraftType(aircraft.aircraft_type, aircraft.aircraft_model || null);
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
            .catch((err: Error) => {
              logger.debug('Failed to update aircraft category', {
                icao24: enriched.icao24,
                error: err.message,
              });
            });
        }
      }
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
  async getAircraftInBounds(latmin: number, lonmin: number, latmax: number, lonmax: number): Promise<any[]> {
    try {
      const isDevelopment = config.server.env === 'development';
      const isRateLimited = rateLimitManager.isRateLimited();
      
      // In development, use extended threshold to show stale data
      // This helps when data is old (from backups) or APIs are unavailable
      let contactThreshold = config.aircraft.recentContactThreshold;
      if (isDevelopment) {
        // In development, always use extended threshold to show more data
        // This is especially useful when testing with restored backups
        contactThreshold = config.aircraft.devModeStaleThreshold;
        logger.debug('Using extended threshold for development', {
          normalThreshold: config.aircraft.recentContactThreshold,
          devThreshold: contactThreshold,
          isRateLimited,
        });
      } else if (isRateLimited) {
        // In production, only use extended threshold when actually rate limited
        contactThreshold = config.aircraft.devModeStaleThreshold;
        logger.debug('Using extended threshold (rate limited)', {
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
      const enrichedWithRoutes = results.map((aircraft: any) => 
        this._enrichAircraftWithRoute(aircraft)
      );

      // Mark stale aircraft in development mode when rate limited BEFORE trajectory prediction
      // This ensures the isStale flag is preserved when the prediction service creates new objects
      // Mark stale aircraft from BOTH feeder and OpenSky sources
      const now = Math.floor(Date.now() / 1000);
      const normalThreshold = now - config.aircraft.recentContactThreshold;
      
      if (isDevelopment && isRateLimited) {
        enrichedWithRoutes.forEach((aircraft: any) => {
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
        enrichedWithRoutes
      );

      const predictedCount = enhanced.filter((a: any) => a.predicted).length;
      const routesCount = enhanced.filter((a: any) => a.route).length;
      const staleCount = enhanced.filter((a: any) => a.isStale).length;
      
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
      const err = error as Error;
      logger.error('Error in getAircraftInBounds', {
        bounds: {
          latmin, lonmin, latmax, lonmax,
        },
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeDatabase(): Promise<void> {
    try {
      await postgresRepository.createMainTable();
      await postgresRepository.createAircraftStatesIndexes(); // Performance indexes
      await postgresRepository.createHistoryTable();
      await postgresRepository.createHistoryTableIndexes(); // Performance indexes
      await postgresRepository.createFlightRoutesTable();
      await postgresRepository.createUsersTable();
      // Feeder service tables
      await postgresRepository.createFeedersTable();
      await postgresRepository.createFeederStatsTable();
      await postgresRepository.addFeederColumnsToAircraftStates();
      await postgresRepository.addFeederColumnsToAircraftStatesHistory();
      // Airport schema tables (airports, runways, frequencies, navaids)
      // Wrap in try-catch to allow server to start even if airport init fails
      try {
        await initializeAirportSchema(postgresRepository.getDb());
        logger.info('Airport schema initialized successfully');
      } catch (error) {
        const err = error as Error;
        logger.warn('Airport schema initialization failed (tables may already exist)', {
          error: err.message,
        });
        // Don't throw - allow server to continue
      }
      logger.info('Database initialized successfully with performance indexes');
    } catch (error) {
      const err = error as Error;
      logger.error('Error initializing database', { error: err.message });
      throw error;
    }
  }

  /**
   * Populate database with initial data
   */
  async populateInitialData(): Promise<void> {
    try {
      const boundingBoxes: BoundingBox[] = [
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
      const err = error as Error;
      logger.error('Error populating initial data', { error: err.message });
      throw error;
    }
  }
}

// Export singleton instance
const aircraftService = new AircraftService();
export default aircraftService;

