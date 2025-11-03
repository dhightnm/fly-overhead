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
    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Check if origin is from an allowed IP address (for VPN access)
    if (config.cors.allowedIPs && config.cors.allowedIPs.length > 0) {
      try {
        const originUrl = new URL(origin);
        const originHostname = originUrl.hostname;
        
        // Check if origin hostname matches any allowed IP
        if (config.cors.allowedIPs.includes(originHostname)) {
          return callback(null, true);
        }
      } catch (err) {
        // Invalid URL format, continue with normal CORS check
      }
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

      // 2d) Initial backfills (run once on startup)
      backgroundRouteService.backfillFlightHistorySample();
      const todayStr = new Date().toISOString().split('T')[0];
      backgroundRouteService.backfillFlightsInRange('2025-10-27', todayStr, 50);
      backgroundRouteService.backfillFlightsMissingAll(50, 100);

      // 2e) Schedule periodic backfills (every 6 hours to gradually backfill missing data)
      // This ensures we continue filling in missing data over time
      const BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
      
      setInterval(() => {
        logger.info('Running scheduled periodic backfill');
        // Run smaller batches periodically to avoid hitting API limits
        backgroundRouteService.backfillFlightHistorySample().catch((err) => {
          logger.error('Error in scheduled backfill sample', { error: err.message });
        });
        
        // Backfill recent flights missing data (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
        backgroundRouteService.backfillFlightsInRange(startDateStr, todayStr, 25).catch((err) => {
          logger.error('Error in scheduled range backfill', { error: err.message });
        });
        
        // Backfill flights missing all fields (smaller batch for periodic)
        backgroundRouteService.backfillFlightsMissingAll(25, 50).catch((err) => {
          logger.error('Error in scheduled missing-all backfill', { error: err.message });
        });
      }, BACKFILL_INTERVAL_MS);
      
      logger.info('Scheduled periodic backfills', { intervalHours: BACKFILL_INTERVAL_MS / (60 * 60 * 1000) });
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

