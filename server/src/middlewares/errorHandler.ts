import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Centralized error handling middleware
 * Catches all errors and formats consistent responses
 */
const errorHandler = (
  err: Error & { statusCode?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Request error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation Error',
      details: err.message,
    });
    return;
  }

  if (err.code === 'ECONNREFUSED') {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database connection failed',
    });
    return;
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;

