const postgresRepository = require('../repositories/PostgresRepository');
const flightRouteService = require('./FlightRouteService');
const logger = require('../utils/logger');

/**
 * Background service to periodically populate route database
 * Runs at a slow rate to avoid API rate limits and costs
 * Goal: Build up historical route data over time for inference
 */
class BackgroundRouteService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    // Process 5 flights every 5 minutes = 60 flights/hour = ~1440 flights/day
    this.BATCH_SIZE = 5;
    this.INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Start the background job
   */
  start() {
    if (this.isRunning) {
      logger.warn('Background route service is already running');
      return;
    }

    logger.info('Starting background route population service', {
      batchSize: this.BATCH_SIZE,
      intervalMinutes: this.INTERVAL_MS / (60 * 1000),
    });

    this.isRunning = true;

    // Run immediately on start
    this.processRoutes();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.processRoutes();
    }, this.INTERVAL_MS);
  }

  /**
   * Stop the background job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Background route population service stopped');
  }

  /**
   * Process a batch of aircraft routes
   */
  async processRoutes() {
    try {
      logger.info('Background route job starting', { batchSize: this.BATCH_SIZE });

      // Get recent aircraft that don't have route data cached
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
      const aircraft = await postgresRepository.findRecentAircraftWithoutRoutes(
        this.BATCH_SIZE,
        tenMinutesAgo
      );

      if (aircraft.length === 0) {
        logger.info('No aircraft need route data at this time');
        return;
      }

      logger.info(`Processing ${aircraft.length} aircraft for background route population`);

      // Process each aircraft sequentially with delay (rate limiting)
      for (let i = 0; i < aircraft.length; i++) {
        const plane = aircraft[i];
        
        try {
          // Skip if we just cached this recently (check DB)
          const cacheKey = plane.callsign || plane.icao24;
          const existingRoute = await postgresRepository.getCachedRoute(cacheKey);
          
          if (existingRoute) {
            logger.debug(`Skipping ${cacheKey} - already in cache`);
            continue;
          }

          logger.info(`Background fetch: ${cacheKey} (${i + 1}/${aircraft.length})`);

          // Fetch route (will use AviationStack + inference, FlightAware is disabled)
          await flightRouteService.getFlightRoute(
            plane.icao24,
            plane.callsign,
            true // isCurrentFlight
          );

          // Small delay between requests to be respectful to APIs
          if (i < aircraft.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
        } catch (error) {
          logger.error('Error processing aircraft in background job', {
            icao24: plane.icao24,
            callsign: plane.callsign,
            error: error.message,
          });
          // Continue with next aircraft even if one fails
        }
      }

      logger.info('Background route job completed', {
        processed: aircraft.length,
      });
    } catch (error) {
      logger.error('Error in background route processing', {
        error: error.message,
        stack: error.stack,
      });
    }
  }
}

// Create singleton instance
const backgroundRouteService = new BackgroundRouteService();

module.exports = backgroundRouteService;

