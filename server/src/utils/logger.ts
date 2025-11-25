import winston from 'winston';
import fs from 'fs';

/**
 * Centralized logging with multiple transports
 */
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }),
];

// Opt-in file logging to avoid failures on read-only filesystems/containers
const LOG_TO_FILES = process.env.LOG_TO_FILES === 'true';
if (LOG_TO_FILES) {
  if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
  }
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'fly-overhead' },
  transports,
});

export default logger;
