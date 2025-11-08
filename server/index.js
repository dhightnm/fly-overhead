const express = require('express');
const { createServer } = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const aircraftService = require('./services/AircraftService');
const backgroundRouteService = require('./services/BackgroundRouteService');
const webSocketService = require('./services/WebSocketService');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');
const logger = require('./utils/logger');

const app = express();
const server = createServer(app);

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

// Serve static files from React build (if build directory exists)
const buildPath = path.join(__dirname, 'client/build');
const fs = require('fs');
const buildExists = fs.existsSync(buildPath);

if (buildExists) {
  app.use(express.static(buildPath));
  logger.info('Serving static files from React build');
} else {
  logger.warn('React build directory not found. Static file serving disabled.');
  logger.warn('Run "npm run build" in the client directory to create the build.');
}

// API Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api', require('./routes/aircraft.routes'));
app.use('/api', require('./routes/health.routes'));
app.use('/api', require('./routes/feeder.routes'));

// Catch-all handler: send back React's index.html for client-side routing
// This must be AFTER API routes and BEFORE error handler
app.get('*', (req, res) => {
  // Only serve index.html if build exists, otherwise return 404
  if (buildExists) {
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
  } else {
    res.status(404).json({ 
      error: 'Frontend build not found. Please build the client application.',
      message: 'Run "npm run build" in the client directory.'
    });
  }
});

// Error handling (must be last)
app.use(errorHandler);

async function startServer() {
  try {
    await aircraftService.initializeDatabase();

    logger.info('Starting server with integrated background jobs');
    
    // Initial fetch from OpenSky (skip if already rate limited)
    aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
      logger.error('Error in initial aircraft fetch', { error: err.message });
    });
    
    // Disabled: populateInitialData() causes excessive OpenSky API calls on startup
    // and often fails due to rate limiting. Aircraft data is populated by the
    // periodic fetch (every 10 minutes) and user-initiated bounded queries instead.
    // aircraftService.populateInitialData();

    // Periodic OpenSky fetch - with optimization to skip when no clients connected
    setInterval(() => {
      // Check if any WebSocket clients are connected
      const io = webSocketService.getIO();
      const hasClients = io && io.sockets.sockets.size > 0;
      
      if (!hasClients) {
        logger.debug('Skipping OpenSky fetch - no clients connected');
        return;
      }
      
      logger.debug(`Running periodic OpenSky fetch (${io.sockets.sockets.size} clients connected)`);
      aircraftService.fetchAndUpdateAllAircraft().catch((err) => {
        // Error already logged in fetchAndUpdateAllAircraft
        // Rate limit errors are handled gracefully (no throw)
        if (!err.rateLimited) {
          logger.error('Error in periodic aircraft fetch', { error: err.message });
        }
      });
    }, config.aircraft.updateInterval);

    backgroundRouteService.start();

    // Background backfill jobs use FlightAware (not OpenSky)
    // to preserve OpenSky quota for real-time aircraft tracking
    backgroundRouteService.backfillFlightHistorySample();
    const todayStr = new Date().toISOString().split('T')[0];
    backgroundRouteService.backfillFlightsInRange('2025-10-27', todayStr, 50);
    backgroundRouteService.backfillFlightsMissingAll(50, 100);

    const BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
    
    setInterval(() => {
      logger.info('Running scheduled periodic backfill');
      backgroundRouteService.backfillFlightHistorySample().catch((err) => {
        logger.error('Error in scheduled backfill sample', { error: err.message });
      });
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
      backgroundRouteService.backfillFlightsInRange(startDateStr, todayStr, 25).catch((err) => {
        logger.error('Error in scheduled range backfill', { error: err.message });
      });
      
      backgroundRouteService.backfillFlightsMissingAll(25, 50).catch((err) => {
        logger.error('Error in scheduled missing-all backfill', { error: err.message });
      });
    }, BACKFILL_INTERVAL_MS);
    
    logger.info('Scheduled periodic backfills', { intervalHours: BACKFILL_INTERVAL_MS / (60 * 60 * 1000) });

    webSocketService.initialize(server);

    const { port, host } = config.server;
    server.listen(port, host, () => {
      logger.info(`Server listening on ${host}:${port}`);
      logger.info('WebSocket server ready for real-time updates');
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  // Don't exit immediately, let the server try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  // Don't exit immediately, let the server try to recover
});

// Start the server
startServer();

