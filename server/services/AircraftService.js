const postgresRepository = require('../repositories/PostgresRepository');
const openSkyService = require('./OpenSkyService');
const flightRouteService = require('./FlightRouteService');
const trajectoryPredictionService = require('./TrajectoryPredictionService');
const webSocketService = require('./WebSocketService');
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
          return postgresRepository.upsertAircraftState(preparedState);
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

      webSocketService.getIO()?.emit('aircraft:global_update', {
        timestamp: new Date().toISOString(),
        message: 'Aircraft data updated',
      });

      return data.states;
    } catch (error) {
      logger.error('Error in fetchAndUpdateAllAircraft', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch and update aircraft for specific bounding box
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

      logger.info(`Processing ${data.states.length} aircraft in bounds`);

      const statePromises = data.states.map((state) => {
        const preparedState = openSkyService.prepareStateForDatabase(state);
        return postgresRepository.upsertAircraftState(preparedState);
      });

      await Promise.all(statePromises);
      logger.info('Database updated with bounded aircraft');

      return data.states;
    } catch (error) {
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
      // First, try to get live data from OpenSky for this specific aircraft
      logger.info(`Searching for aircraft: ${identifier} (checking live OpenSky first)`);
      
      try {
        const liveStates = await openSkyService.getAllStates();
        
        if (liveStates && liveStates.states) {
          // Search for the aircraft by ICAO24 or callsign in live data
          const normalizedIdentifier = identifier.trim().toUpperCase();
          const matchingState = liveStates.states.find(state => {
            const icao24 = state[0] ? state[0].trim().toLowerCase() : '';
            const callsign = state[1] ? state[1].trim().toUpperCase() : '';
            
            return icao24 === identifier.toLowerCase() || callsign === normalizedIdentifier;
          });
          
          if (matchingState) {
            // Found live data - use it!
            const liveAircraft = {
              icao24: matchingState[0] ? matchingState[0].trim() : null,
              callsign: matchingState[1] ? matchingState[1].trim() : null,
              origin_country: matchingState[2],
              time_position: matchingState[3],
              last_contact: matchingState[4],
              longitude: matchingState[5],
              latitude: matchingState[6],
              baro_altitude: matchingState[7],
              on_ground: matchingState[8],
              velocity: matchingState[9],
              true_track: matchingState[10],
              vertical_rate: matchingState[11],
              sensors: matchingState[12],
              geo_altitude: matchingState[13],
              squawk: matchingState[14],
              spi: matchingState[15],
              position_source: matchingState[16],
              category: matchingState[17] || null,
            };
            
            logger.info(`Found LIVE aircraft data for ${identifier} from OpenSky`, {
              icao24: liveAircraft.icao24,
              callsign: liveAircraft.callsign,
              position: [liveAircraft.latitude, liveAircraft.longitude],
              category: liveAircraft.category,
            });
            
            return liveAircraft;
          }
        }
      } catch (openSkyError) {
        logger.warn(`OpenSky live search failed for ${identifier}, falling back to database`, {
          error: openSkyError.message,
        });
      }
      
      // Fall back to database (old data)
      const results = await postgresRepository.findAircraftByIdentifier(identifier);

      if (results.length === 0) {
        logger.info(`No aircraft found for identifier: ${identifier}`);
        return null;
      }

      const aircraft = results[0];

      logger.info(`Found aircraft in DATABASE for identifier: ${identifier} (may be stale)`);
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
   */
  // eslint-disable-next-line class-methods-use-this
  async getAircraftInBounds(latmin, lonmin, latmax, lonmax) {
    try {
      const tenMinutesAgo = Math.floor(Date.now() / 1000)
        - config.aircraft.recentContactThreshold;

      const results = await postgresRepository.findAircraftInBounds(
        latmin,
        lonmin,
        latmax,
        lonmax,
        tenMinutesAgo,
      );

      // Enrich with route data and model/type
      const enrichedWithRoutes = results.map((aircraft) => 
        this._enrichAircraftWithRoute(aircraft)
      );

      const enhanced = await trajectoryPredictionService.enhanceAircraftWithPredictions(
        enrichedWithRoutes
      );

      const predictedCount = enhanced.filter(a => a.predicted).length;
      const routesCount = enhanced.filter(a => a.route).length;
      
      if (predictedCount > 0) {
        logger.debug(`Applied trajectory predictions to ${predictedCount}/${enhanced.length} aircraft`);
      }
      
      if (routesCount > 0) {
        logger.info(`Included route data for ${routesCount}/${enhanced.length} aircraft (from cache)`);
      }

      logger.info(`Returning ${enhanced.length} aircraft still flying`);
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
