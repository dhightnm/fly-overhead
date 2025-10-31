const aircraftService = require('./services/AircraftService');
const backgroundRouteService = require('./services/BackgroundRouteService');
const config = require('./config');
const logger = require('./utils/logger');

/**
 * Worker process for data fetching and background tasks
 * Separated from main server to prevent EC2 lockups
 * 
 * This worker runs independently and handles:
 * - Aircraft data fetching from OpenSky
 * - Route backfilling
 * - Database updates
 * 
 * Run with: node server/worker.js
 * Or with PM2: pm2 start server/worker.js --name fly-overhead-worker
 */
async function startWorker() {
  try {
    logger.info('Starting Fly Overhead Worker Process');

    // Initialize database connection (will be shared with main process if on same instance)
    await aircraftService.initializeDatabase();

    // Start periodic aircraft updates (every 2 minutes)
    logger.info('Starting periodic aircraft updates', {
      interval: config.aircraft.updateInterval / 1000,
      intervalUnit: 'seconds',
    });

    // Run immediately
    aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
      logger.error('Error in initial aircraft fetch', { error: err.message });
    });

    // Then schedule periodic updates
    setInterval(() => {
      aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
        logger.error('Error in periodic aircraft fetch', { error: err.message });
      });
    }, config.aircraft.updateInterval);

    // Start background route population service
    backgroundRouteService.start();

    // One-time backfills (run once on worker start)
    // These will be called once, worker will handle periodic updates
    setTimeout(() => {
      backgroundRouteService.backfillFlightHistorySample().catch((err) => {
        logger.error('Error in backfill sample', { error: err.message });
      });
    }, 30000); // Wait 30 seconds after start

    logger.info('Worker process started successfully', {
      updateInterval: `${config.aircraft.updateInterval / 1000}s`,
    });

    // Keep process alive
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down worker gracefully');
      backgroundRouteService.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down worker gracefully');
      backgroundRouteService.stop();
      process.exit(0);
    });
  } catch (err) {
    logger.error('Error starting worker process', { error: err.message });
    process.exit(1);
  }
}

// Only start if run directly (not when required as module)
if (require.main === module) {
  startWorker();
}

module.exports = { startWorker };

