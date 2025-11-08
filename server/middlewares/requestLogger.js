const logger = require('../utils/logger');

/**
 * Request logging middleware
 * Logs all incoming requests with relevant metadata
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Use debug level for frequent/noisy endpoints (but NOT feeder endpoints - we want to see those)
    const isAreaEndpoint = req.path.startsWith('/area/') || req.path.startsWith('/airports/bounds/');
    const isStarlinkEndpoint = req.path.startsWith('/starlink/');
    const logLevel = (isAreaEndpoint || isStarlinkEndpoint) ? 'debug' : 'info';
    
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

module.exports = requestLogger;
