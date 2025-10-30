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

// Error handling (must be last)
app.use(errorHandler);

/**
 * Initialize server
 */
async function startServer() {
  try {
    // 1) Initialize database tables
    await aircraftService.initializeDatabase();

    // 2) Initial data population
    aircraftService.fetchAndUpdateAllAircraft();
    aircraftService.populateInitialData();

    // 3) Schedule periodic updates
    setInterval(() => {
      aircraftService.fetchAndUpdateAllAircraft();
    }, config.aircraft.updateInterval);

    // 4) Start background route population service
    // Fetches routes slowly (5 flights every 5 min) to build database
    backgroundRouteService.start();

    // 4b) Kick a one-time backfill sample to enrich historical flights (times/type)
    backgroundRouteService.backfillFlightHistorySample();

    // 4c) One-time backfill for date range 2025-10-27 to today
    const todayStr = new Date().toISOString().split('T')[0];
    backgroundRouteService.backfillFlightsInRange('2025-10-27', todayStr, 50);

    // 4d) One-time subset backfill: 50 recent flights missing all fields, FA cap ~100
    backgroundRouteService.backfillFlightsMissingAll(50, 100);

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
