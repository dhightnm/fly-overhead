import pgPromise from 'pg-promise';
import config from '../config';
import logger from '../utils/logger';
import PostGISService from '../services/PostGISService';

const pgp = pgPromise();

/**
 * Base database connection manager
 * Handles connection initialization and PostGIS setup
 */
class DatabaseConnection {
  private db: pgPromise.IDatabase<any>;
  private postgis: PostGISService;

  constructor() {
    const connectionString = config.database.postgres.url;
    this.db = pgp(connectionString);
    this.postgis = new PostGISService(this.db);
    this.initConnection();
  }

  async initConnection(): Promise<void> {
    try {
      const obj = await this.db.connect();
      logger.info('Database connection established');
      obj.done();

      // Initialize PostGIS asynchronously (non-blocking) after connection is established
      // This allows the server to start quickly while PostGIS initializes in the background
      this.initializePostGIS().catch((error: Error) => {
        logger.warn('PostGIS initialization failed (running in background)', {
          error: error.message,
        });
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Database connection error', { error: err });
      process.exit(1);
    }
  }

  /**
   * Initialize PostGIS extension and spatial features
   */
  async initializePostGIS(): Promise<void> {
    try {
      await this.postgis.initialize();
      await this.postgis.createGeometryTriggers();
      logger.info('PostGIS initialized successfully');
    } catch (error) {
      const err = error as Error;
      logger.warn('PostGIS initialization failed (may already be initialized)', {
        error: err.message,
      });
    }
  }

  /**
   * Get database connection
   */
  getDb(): pgPromise.IDatabase<any> {
    return this.db;
  }

  /**
   * Get PostGIS service
   */
  getPostGIS(): PostGISService {
    return this.postgis;
  }
}

// Singleton instance
let connectionInstance: DatabaseConnection | null = null;

/**
 * Get or create database connection instance
 */
export function getConnection(): DatabaseConnection {
  if (!connectionInstance) {
    connectionInstance = new DatabaseConnection();
  }
  return connectionInstance;
}

export { DatabaseConnection };

