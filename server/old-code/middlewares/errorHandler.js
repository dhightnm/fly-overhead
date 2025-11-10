const logger = require('../utils/logger');

/**
 * Centralized error handling middleware
 * Catches all errors and formats consistent responses
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  logger.error('Request error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.message,
    });
  }

  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database connection failed',
    });
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
