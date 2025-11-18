import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Request logging middleware
 * Logs all incoming requests with relevant metadata
 */
const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    // Use debug level for frequent/noisy endpoints (health checks, area, airports, starlink)
    // Keep info level for important endpoints (feeder, auth, admin)
    const isHealthCheck = req.path === '/health';
    const isAreaEndpoint = req.path.startsWith('/area/') || req.path.startsWith('/airports/bounds/');
    const isStarlinkEndpoint = req.path.startsWith('/starlink/');
    const isNoisy = isHealthCheck || isAreaEndpoint || isStarlinkEndpoint;
    const logLevel = isNoisy ? 'debug' : 'info';

    logger[logLevel]('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });

  next();
};

export default requestLogger;
