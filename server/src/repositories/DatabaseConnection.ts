import fs from 'fs';
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
  // Log connection pool events for debugging and set query timeouts
  connect: async (e: any) => {
    const { client } = e;
    logger.debug('New database connection established', {
      totalCount: client?.totalCount,
      idleCount: client?.idleCount,
      waitingCount: client?.waitingCount,
    });

    // Set query timeouts on each new connection to prevent queries from hanging
    // This applies to all queries on this connection
    try {
      await client.query('SET statement_timeout = 10000'); // 10 seconds
      await client.query('SET lock_timeout = 5000'); // 5 seconds for lock waits
    } catch (timeoutError) {
      logger.warn('Failed to set query timeouts on new connection', {
        error: (timeoutError as Error).message,
      });
    }
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
        // Skip logging but don't return - let pg-promise handle the error normally
        return;
      }

      // Log summary of repeated errors
      logger.error(`Database error (repeated x${errorThrottle.errorCount})`, {
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

    // Don't return early - let pg-promise handle the error normally
    // The error handler is just for logging, not for controlling behavior
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

    const connectionConfig: any = {
      connectionString,
      max: config.database.postgres.pool.max || 10,
      min: config.database.postgres.pool.min || 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      query_timeout: 10000,
    };

    if (isAwsRds) {
      const sslConfig = DatabaseConnection.buildSslConfig(connectionString);
      if (sslConfig) {
        connectionConfig.ssl = sslConfig;
      }
    }

    this.db = pgp(connectionConfig);

    this.postgis = new PostGISService(this.db);
    // Initialize connection asynchronously - don't block constructor
    // This allows the server to start even if DB is temporarily unavailable
    this.initConnection().catch((error: Error) => {
      logger.warn('Database connection initialization failed (non-blocking)', {
        error: error.message,
      });
    });
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

  private static buildSslConfig(connectionString: string): false | Record<string, any> {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    const sslDisabled = sslMode === 'disable' || process.env.POSTGRES_SSL === 'disable';
    if (sslDisabled) {
      return false;
    }

    const explicitRejectUnauthorized = process.env.POSTGRES_REJECT_UNAUTHORIZED;
    let rejectUnauthorized = true;
    if (explicitRejectUnauthorized !== undefined) {
      rejectUnauthorized = explicitRejectUnauthorized === 'true';
    } else if (sslMode && ['require', 'prefer', 'allow'].includes(sslMode)) {
      rejectUnauthorized = false;
    }

    const sslConfig: Record<string, any> = {
      rejectUnauthorized,
    };

    const readFile = (filePath?: string): string | undefined => {
      if (!filePath) {
        return undefined;
      }
      if (!fs.existsSync(filePath)) {
        logger.warn('Configured SSL file not found', { filePath });
        return undefined;
      }
      return fs.readFileSync(filePath, 'utf8');
    };

    const ca = process.env.POSTGRES_SSL_CA
      || readFile(process.env.POSTGRES_SSL_CA_PATH)
      || readFile(process.env.POSTGRES_CA_CERT_PATH);
    if (ca) {
      sslConfig.ca = ca;
    }

    const key = process.env.POSTGRES_SSL_KEY
      || readFile(process.env.POSTGRES_SSL_KEY_PATH);
    if (key) {
      sslConfig.key = key;
    }

    const cert = process.env.POSTGRES_SSL_CERT
      || readFile(process.env.POSTGRES_SSL_CERT_PATH);
    if (cert) {
      sslConfig.cert = cert;
    }

    return sslConfig;
  }

  async initConnection(): Promise<void> {
    try {
      const obj = await this.db.connect();
      logger.info('Database connection established');
      // Note: Query timeouts are now set in the connect event handler above
      // so they apply to all connections in the pool automatically
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
      logger.error('Database connection error during initialization', { error: err.message });
      // Don't exit - allow server to start and retry connection in background
      // The connection pool will retry automatically on first query
      logger.warn('Server will start without initial DB connection - will retry on first query');
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

  /**
   * Close database connections and pool
   */
  async close(): Promise<void> {
    try {
      await this.db.$pool.end();
    } finally {
      pgp.end();
    }
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
