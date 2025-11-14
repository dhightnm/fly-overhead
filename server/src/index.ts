import express, { Request, Response } from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import config from './config';
import aircraftService from './services/AircraftService';
import backgroundRouteService from './services/BackgroundRouteService';
import conusPollingService from './services/ConusPollingService';
import webSocketService from './services/WebSocketService';
import errorHandler from './middlewares/errorHandler';
import requestLogger from './middlewares/requestLogger';
import logger from './utils/logger';

const app = express();
const server = createServer(app);

// Configure CORS
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin is in allowed list
      if (config.cors.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Check if origin is from an allowed IP address (for VPN access)
      if (config.cors.allowedIPs && config.cors.allowedIPs.length > 0) {
        try {
          const originUrl = new URL(origin);
          const originHostname = originUrl.hostname;

          // Check if origin hostname matches any allowed IP
          if (config.cors.allowedIPs.includes(originHostname)) {
            callback(null, true);
            return;
          }
        } catch (err) {
          // Invalid URL format, continue with normal CORS check
        }
      }

      callback(new Error('CORS policy violation'), false);
    },
  }),
);

// Middleware
app.use(express.json());
app.use(requestLogger);

// Serve static files from React build (if build directory exists)
// After compilation, __dirname will be dist/, so we need to go up one level
const buildPath = path.join(__dirname, '../client/build');

const buildExists = fs.existsSync(buildPath);

if (buildExists) {
  app.use(express.static(buildPath));
  logger.info('Serving static files from React build');
} else {
  logger.warn('React build directory not found. Static file serving disabled.');
  logger.warn('Run "npm run build" in the client directory to create the build.');
}

// API Routes - All migrated to TypeScript
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import aircraftRoutes from './routes/aircraft.routes';
import healthRoutes from './routes/health.routes';
import feederRoutes from './routes/feeder.routes';

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', aircraftRoutes);
app.use('/api', healthRoutes);
app.use('/api', feederRoutes);

// Catch-all handler: send back React's index.html for client-side routing
// This must be AFTER API routes and BEFORE error handler
app.get('*', (_req: Request, res: Response) => {
  // Only serve index.html if build exists, otherwise return 404
  if (buildExists) {
    res.sendFile(path.join(buildPath, 'index.html'));
  } else {
    res.status(404).json({
      error: 'Frontend build not found. Please build the client application.',
      message: 'Run "npm run build" in the client directory.',
    });
  }
});

// Error handling (must be last)
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    await aircraftService.initializeDatabase();

    logger.info('Starting server with integrated background jobs');

    // Initialize WebSocket service before starting server
    webSocketService.initialize(server);

    // Start the server FIRST so it can accept connections immediately
    const { port, host } = config.server;
    server.listen(port, host, () => {
      logger.info(`Server listening on ${host}:${port}`);
      logger.info('WebSocket server ready for real-time updates');
    });

    // Start background services AFTER server is listening (non-blocking)
    // OpenSky DISABLED - doesn't work from AWS (IP blocked)
    // Using airplanes.live via CONUS polling instead
    logger.info('OpenSky integration DISABLED (AWS IP blocking) - using airplanes.live');

    // aircraftService.fetchAndUpdateAllAircraft().catch((err: Error) => {
    //   logger.error('Error in initial aircraft fetch', { error: err.message });
    // });

    // Disabled: populateInitialData() causes excessive OpenSky API calls on startup
    // and often fails due to rate limiting. Aircraft data is populated by
    // airplanes.live CONUS polling instead.
    // aircraftService.populateInitialData();

    // Periodic OpenSky fetch DISABLED - doesn't work from AWS
    // CONUS polling via airplanes.live provides continuous coverage instead
    // setInterval(() => {
    //   const io = webSocketService.getIO();
    //   const hasClients = io && io.sockets.sockets.size > 0;
    //
    //   logger.info('Starting periodic OpenSky fetch', {
    //     hasClients,
    //     clientCount: hasClients ? io.sockets.sockets.size : 0,
    //     intervalMinutes: config.aircraft.updateInterval / 60000,
    //   });
    //
    //   aircraftService.fetchAndUpdateAllAircraft().catch((err: Error & { rateLimited?: boolean }) => {
    //     if (!err.rateLimited) {
    //       logger.error('Error in periodic aircraft fetch', { error: err.message, stack: err.stack });
    //     } else {
    //       logger.warn('Periodic OpenSky fetch skipped due to rate limiting', {
    //         retryAfter: (err as any).retryAfter,
    //       });
    //     }
    //   });
    // }, config.aircraft.updateInterval);

    backgroundRouteService.start();

    // Start CONUS polling service for continuous aircraft data updates
    // This polls airplanes.live at 1 req/sec across CONUS
    conusPollingService.start();
    logger.info('CONUS polling service started for continuous aircraft updates');

    // Background backfill jobs use FlightAware (not OpenSky)
    // to preserve OpenSky quota for real-time aircraft tracking
    // Run these asynchronously AFTER server is listening to avoid blocking startup
    setImmediate(() => {
      backgroundRouteService.backfillFlightHistorySample().catch((err: Error) => {
        logger.error('Error in initial backfill sample', { error: err.message });
      });

      const todayStr = new Date().toISOString().split('T')[0];
      backgroundRouteService.backfillFlightsInRange('2025-10-27', todayStr, 50).catch((err: Error) => {
        logger.error('Error in initial range backfill', { error: err.message });
      });

      backgroundRouteService.backfillFlightsMissingAll(50, 100).catch((err: Error) => {
        logger.error('Error in initial missing-all backfill', { error: err.message });
      });
    });

    const BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

    setInterval(() => {
      logger.info('Running scheduled periodic backfill');
      backgroundRouteService.backfillFlightHistorySample().catch((err: Error) => {
        logger.error('Error in scheduled backfill sample', { error: err.message });
      });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      backgroundRouteService.backfillFlightsInRange(startDateStr, todayStr, 25).catch((err: Error) => {
        logger.error('Error in scheduled range backfill', { error: err.message });
      });

      backgroundRouteService.backfillFlightsMissingAll(25, 50).catch((err: Error) => {
        logger.error('Error in scheduled missing-all backfill', { error: err.message });
      });
    }, BACKFILL_INTERVAL_MS);

    logger.info('Scheduled periodic backfills', { intervalHours: BACKFILL_INTERVAL_MS / (60 * 60 * 1000) });
  } catch (err) {
    const error = err as Error;
    logger.error('Error starting server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  backgroundRouteService.stop();
  conusPollingService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  backgroundRouteService.stop();
  conusPollingService.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  // Don't exit immediately, let the server try to recover
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
  logger.error('Unhandled Rejection', { reason, promise });
  // Don't exit immediately, let the server try to recover
});

// Start the server
startServer();
