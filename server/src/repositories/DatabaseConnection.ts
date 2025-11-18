import pgPromise from 'pg-promise';
import config from '../config';
import logger from '../utils/logger';
import PostGISService from '../services/PostGISService';

// Error throttling to prevent log flooding
const errorThrottle = {
  lastError: '',
  lastErrorTime: 0,
  errorCount: 0,
  throttleMs: 5000, // Only log same error once per 5 seconds
};

// Configure pg-promise with connection pool monitoring
const pgp = pgPromise({
  // Log connection pool events for debugging
  connect: (e: any) => {
    const { client } = e;
    logger.debug('New database connection established', {
      totalCount: client?.totalCount,
      idleCount: client?.idleCount,
      waitingCount: client?.waitingCount,
    });
  },
  disconnect: (e: any) => {
    const err = e.client?.error;
    if (err) {
      logger.warn('Database connection closed with error', { error: err.message || String(err) });
    } else {
      logger.debug('Database connection closed normally');
    }
  },
  query: (e: any) => {
    // Log slow queries (> 5 seconds)
    if (e.duration > 5000) {
      logger.warn('Slow database query detected', {
        duration: `${e.duration}ms`,
        query: e.query?.substring(0, 100),
      });
    }
  },
  error: (err: Error, e: any) => {
    const now = Date.now();
    const errorKey = `${err.message}:${e?.query?.substring(0, 50) || ''}`;
    
    // Throttle repeated errors to prevent log flooding
    if (errorKey === errorThrottle.lastError) {
      errorThrottle.errorCount++;
      
      // Only log every 5 seconds for repeated errors
      if (now - errorThrottle.lastErrorTime < errorThrottle.throttleMs) {
        return; // Skip logging
      }
      
      // Log summary of repeated errors
      logger.error('Database error (repeated x' + errorThrottle.errorCount + ')', {
        error: err.message,
        query: e?.query?.substring(0, 100),
      });
      
      // Reset error count after logging
      errorThrottle.errorCount = 0;
    } else {
      // New/different error - log immediately
      logger.error('Database query error', {
        error: err.message,
        query: e?.query?.substring(0, 100),
      });
      errorThrottle.errorCount = 1;
    }
    
    // Update throttle state
    errorThrottle.lastError = errorKey;
    errorThrottle.lastErrorTime = now;
  },
});

/**
 * Base database connection manager
 * Handles connection initialization and PostGIS setup
 */
class DatabaseConnection {
  private db: pgPromise.IDatabase<any>;

  private postgis: PostGISService;

  constructor() {
    const connectionString = config.database.postgres.url;

    // Parse connection string to detect AWS RDS/Lightsail endpoints
    const isAwsRds = DatabaseConnection.isAwsRdsEndpoint(connectionString);

    // Configure SSL for AWS RDS/Lightsail connections
    // Parse connection string and add SSL configuration
    if (isAwsRds) {
      try {
        // Parse the connection URL
        const url = new URL(connectionString);
        const connectionConfig: any = {
          host: url.hostname,
          port: parseInt(url.port || '5432', 10),
          database: url.pathname.replace(/^\//, ''), // Remove leading slash
          user: url.username,
          password: decodeURIComponent(url.password), // Decode password
          ssl: {
            // AWS RDS certificates are trusted, but Node.js needs this for self-signed certs
            rejectUnauthorized: false,
          },
          // Connection pool settings
          // Maximum number of clients in the pool (keep below database max_connections limit)
          max: config.database.postgres.pool.max || 10,
          min: config.database.postgres.pool.min || 2, // Minimum number of clients in the pool
          idleTimeoutMillis: 30000, // Close idle clients after 30 seconds (reduced to free up connections faster)
          connectionTimeoutMillis: 30000, // Return an error after 30 seconds if connection could not be established
          keepAlive: true, // Keep TCP connection alive
          keepAliveInitialDelayMillis: 10000, // Start keepalive after 10 seconds
        };

        this.db = pgp(connectionConfig);
      } catch (error) {
        // Fallback to connection string if parsing fails, but still add timeout settings
        logger.warn('Failed to parse connection string, using as-is with timeout settings', {
          error: (error as Error).message,
        });
        const fallbackConfig: any = {
          connectionString,
          max: config.database.postgres.pool.max || 10,
          min: config.database.postgres.pool.min || 2,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 30000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        };
        this.db = pgp(fallbackConfig);
      }
    } else {
      // For local/non-AWS connections, add timeout and pool settings
      const connectionConfig: any = {
        connectionString,
        // Connection pool settings
        max: config.database.postgres.pool.max || 10,
        min: config.database.postgres.pool.min || 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      };
      this.db = pgp(connectionConfig);
    }

    this.postgis = new PostGISService(this.db);
    this.initConnection();
  }

  /**
   * Check if connection string points to AWS RDS/Lightsail endpoint
   */
  static isAwsRdsEndpoint(connectionString: string): boolean {
    // AWS RDS/Lightsail endpoints typically contain:
    // - .rds.amazonaws.com
    // - .lightsail.aws
    // - ls- prefix (Lightsail)
    return (
      connectionString.includes('.rds.amazonaws.com')
      || connectionString.includes('.lightsail.aws')
      || connectionString.includes('ls-')
    );
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
