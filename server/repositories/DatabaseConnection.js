const pgp = require('pg-promise')();
const config = require('../config');
const logger = require('../utils/logger');
const PostGISService = require('../services/PostGISService');

/**
 * Base database connection manager
 * Handles connection initialization and PostGIS setup
 */
class DatabaseConnection {
  constructor() {
    const connectionString = config.database.postgres.url;
    this.db = pgp(connectionString);
    this.postgis = new PostGISService(this.db);
    this.initConnection();
  }

  async initConnection() {
    try {
      const obj = await this.db.connect();
      logger.info('Database connection established');
      obj.done();

      // Initialize PostGIS asynchronously (non-blocking) after connection is established
      // This allows the server to start quickly while PostGIS initializes in the background
      this.initializePostGIS().catch((error) => {
        logger.warn('PostGIS initialization failed (running in background)', {
          error: error.message,
        });
      });
    } catch (error) {
      logger.error('Database connection error', { error });
      process.exit(1);
    }
  }

  /**
   * Initialize PostGIS extension and spatial features
   */
  async initializePostGIS() {
    try {
      await this.postgis.initialize();
      await this.postgis.createGeometryTriggers();
      logger.info('PostGIS initialized successfully');
    } catch (error) {
      logger.warn('PostGIS initialization failed (may already be initialized)', {
        error: error.message,
      });
    }
  }

  /**
   * Get database connection
   */
  getDb() {
    return this.db;
  }

  /**
   * Get PostGIS service
   */
  getPostGIS() {
    return this.postgis;
  }
}

// Singleton instance
let connectionInstance = null;

/**
 * Get or create database connection instance
 */
function getConnection() {
  if (!connectionInstance) {
    connectionInstance = new DatabaseConnection();
  }
  return connectionInstance;
}

module.exports = { DatabaseConnection, getConnection };

