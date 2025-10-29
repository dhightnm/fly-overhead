const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const aircraftService = require('./services/AircraftService');
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

    // 4) Start the server
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
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();
