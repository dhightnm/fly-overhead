const postgresRepository = require('../repositories/PostgresRepository');
const openSkyService = require('./OpenSkyService');
const flightRouteService = require('./FlightRouteService');
const trajectoryPredictionService = require('./TrajectoryPredictionService');
const config = require('../config');
const logger = require('../utils/logger');

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

      // Process in batches to prevent event loop blocking and EC2 lockups
      // Large Promise.all() can overwhelm the system with thousands of aircraft
      const BATCH_SIZE = 50; // Process 50 at a time
      let processed = 0;

      for (let i = 0; i < data.states.length; i += BATCH_SIZE) {
        const batch = data.states.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((state) => {
          const preparedState = openSkyService.prepareStateForDatabase(state);
          return postgresRepository.upsertAircraftState(preparedState);
        });

        await Promise.all(batchPromises);
        processed += batch.length;

        // Log progress every 5 batches
        if ((i / BATCH_SIZE) % 5 === 0) {
          logger.debug(`Processed ${processed}/${data.states.length} aircraft`);
        }

        // Yield to event loop between batches to prevent blocking
        // This prevents EC2 from locking up during large data pulls
        if (i + BATCH_SIZE < data.states.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      logger.info(`Database updated successfully with all ${processed} aircraft`);

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
      const results = await postgresRepository.findAircraftByIdentifier(identifier);

      if (results.length === 0) {
        logger.info(`No aircraft found for identifier: ${identifier}`);
        return null;
      }

      const aircraft = results[0];

      // DISABLED: FlightAware landed flight checks (too expensive - $13/night!)
      // Rely on OpenSky's on_ground flag and last_contact for filtering instead

      logger.info(`Found aircraft for identifier: ${identifier}`);
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
   * Get aircraft within geographical bounds (with trajectory prediction)
   * Uses route data to extrapolate positions between real API updates
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

      // DISABLED: FlightAware landed flight checks (too expensive - $13/night!)
      // For now, rely on OpenSky's on_ground flag and last_contact timestamp
      // to filter out stale data instead of making expensive API calls
      const filteredResults = results;

      const filteredCount = results.length - filteredResults.length;
      if (filteredCount > 0) {
        logger.info(`Filtered out ${filteredCount} landed flights (OpenSky data quality issue)`);
      }

      // Enhance with trajectory predictions (extrapolates positions between real updates)
      // This allows smooth updates every 15 seconds instead of every 2 minutes
      const enhanced = await trajectoryPredictionService.enhanceAircraftWithPredictions(filteredResults);

      const predictedCount = enhanced.filter(a => a.predicted).length;
      if (predictedCount > 0) {
        logger.debug(`Applied trajectory predictions to ${predictedCount}/${enhanced.length} aircraft`);
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
