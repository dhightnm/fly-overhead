const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const aircraftService = require('./services/AircraftService');
const backgroundRouteService = require('./services/BackgroundRouteService');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');
const logger = require('./utils/logger');

const app = express();

// Configure CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy violation'), false);
  },
}));

// Middleware
app.use(express.json());
app.use(requestLogger);

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'client/build')));

// API Routes
app.use('/api', require('./routes/aircraft.routes'));
app.use('/api', require('./routes/health.routes'));

// Catch-all handler: send back React's index.html for client-side routing
// This must be AFTER API routes and BEFORE error handler
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build/index.html'));
});

// Error handling (must be last)
app.use(errorHandler);

/**
 * Initialize server
 * 
 * NOTE: In production (AWS), aircraft fetching and background jobs
 * should run in a separate worker process (see server/worker.js)
 * to prevent EC2 lockups. Set ENABLE_WORKER=false to disable.
 */
async function startServer() {
  try {
    // 1) Initialize database tables
    await aircraftService.initializeDatabase();

    // 2) Check if worker should run in this process
    // In production, worker should be separate (PM2 or ECS task)
    const enableWorker = process.env.ENABLE_WORKER !== 'false';

    if (enableWorker) {
      logger.info('Running in combined mode (web + worker)');
      
      // 2a) Initial data population
      aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
        logger.error('Error in initial aircraft fetch', { error: err.message });
      });
      aircraftService.populateInitialData();

      // 2b) Schedule periodic updates
      setInterval(() => {
        aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
          logger.error('Error in periodic aircraft fetch', { error: err.message });
        });
      }, config.aircraft.updateInterval);

      // 2c) Start background route population service
      backgroundRouteService.start();

      // 2d) One-time backfills (only in combined mode - in production worker handles these)
      backgroundRouteService.backfillFlightHistorySample();
      const todayStr = new Date().toISOString().split('T')[0];
      backgroundRouteService.backfillFlightsInRange('2025-10-27', todayStr, 50);
      backgroundRouteService.backfillFlightsMissingAll(50, 100);
    } else {
      logger.info('Running in web-only mode (worker should be separate process)');
    }

    // 5) Start the server
    const { port, host } = config.server;
    app.listen(port, host, () => {
      logger.info(`Server listening on ${host}:${port}`);
    });
  } catch (err) {
    logger.error('Error starting server', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  backgroundRouteService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  backgroundRouteService.stop();
  process.exit(0);
});

// Start the server
startServer();
