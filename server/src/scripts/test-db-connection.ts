#!/usr/bin/env node
/**
 * Test database connection script
 * Verifies that the database connection is working correctly
 */

import dotenv from 'dotenv';
import pgPromise from 'pg-promise';
import logger from '../utils/logger';

dotenv.config();

const { POSTGRES_URL } = process.env;

if (!POSTGRES_URL) {
  logger.error('❌ POSTGRES_URL environment variable is not set');
  process.exit(1);
}

// Check if it's an AWS RDS/Lightsail endpoint
const isAwsRds = POSTGRES_URL.includes('.rds.amazonaws.com')
  || POSTGRES_URL.includes('.lightsail.aws')
  || POSTGRES_URL.includes('ls-');

async function testConnection(): Promise<void> {
  logger.info('🔍 Testing database connection...');
  logger.info(`📍 Endpoint: ${isAwsRds ? 'AWS RDS/Lightsail' : 'Local/Other'}`);
  logger.info(`🔗 Connection string: ${POSTGRES_URL.replace(/:[^:@]+@/, ':****@')}`); // Mask password
  logger.info('');

  let db: pgPromise.IDatabase<any>;

  try {
    if (isAwsRds) {
      // Parse connection string for AWS
      const url = new URL(POSTGRES_URL);
      const connectionConfig: any = {
        host: url.hostname,
        port: parseInt(url.port || '5432', 10),
        database: url.pathname.replace(/^\//, ''),
        user: url.username,
        password: decodeURIComponent(url.password),
        ssl: {
          rejectUnauthorized: false,
        },
        max: 5, // Smaller pool for testing
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      };

      db = pgPromise()(connectionConfig);
      logger.info('✅ Connection config parsed for AWS RDS/Lightsail');
    } else {
      // Use connection string directly
      const connectionConfig: any = {
        connectionString: POSTGRES_URL,
        max: 5,
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      };
      db = pgPromise()(connectionConfig);
      logger.info('✅ Connection config created for local/other database');
    }

    logger.info('⏳ Attempting to connect...');
    const startTime = Date.now();

    // Test 1: Basic connection
    const client = await db.connect();
    const connectTime = Date.now() - startTime;
    logger.info(`✅ Connection established in ${connectTime}ms`);
    client.done();

    // Test 2: Simple query
    logger.info('⏳ Testing simple query...');
    const queryStart = Date.now();
    const result = await db.one('SELECT NOW() as current_time, version() as version');
    const queryTime = Date.now() - queryStart;
    logger.info(`✅ Query executed in ${queryTime}ms`);
    logger.info(`   Current time: ${result.current_time}`);
    logger.info(`   PostgreSQL version: ${result.version.split(' ')[0]} ${result.version.split(' ')[1]}`);

    // Test 3: Check database name
    logger.info('⏳ Checking database name...');
    const dbName = await db.one('SELECT current_database() as db_name');
    logger.info(`✅ Connected to database: ${dbName.db_name}`);

    // Test 4: Check connection count
    logger.info('⏳ Checking connection pool...');
    const poolStats = await db.one(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    logger.info('✅ Connection pool stats:', {
      total_connections: poolStats.total_connections,
      active_connections: poolStats.active_connections,
      idle_connections: poolStats.idle_connections,
    });

    // Test 5: Test a more complex query (check if main table exists)
    logger.info('⏳ Testing table access...');
    const tableCheck = await db.oneOrNone(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'aircraft_states'
      ) as table_exists
    `);
    if (tableCheck?.table_exists) {
      const rowCount = await db.one('SELECT COUNT(*) as count FROM aircraft_states LIMIT 1');
      logger.info(`✅ Main table 'aircraft_states' exists with ${rowCount.count} rows`);
    } else {
      logger.warn('⚠️  Main table "aircraft_states" does not exist yet');
    }

    // Test 6: Test PostGIS extension
    logger.info('⏳ Checking PostGIS extension...');
    const postgisCheck = await db.oneOrNone(`
      SELECT EXISTS (
        SELECT FROM pg_extension WHERE extname = 'postgis'
      ) as postgis_exists
    `);
    if (postgisCheck?.postgis_exists) {
      const postgisVersion = await db.one('SELECT PostGIS_version() as version');
      logger.info(`✅ PostGIS extension enabled: ${postgisVersion.version}`);
    } else {
      logger.warn('⚠️  PostGIS extension not found');
    }

    await db.$pool.end();
    logger.info('');
    logger.info('✅ All database connection tests passed!');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Database connection test failed!', {
      message: err.message,
      name: err.name,
      code: (error as any).code,
      address: (error as any).address,
      port: (error as any).port,
      stack: err.stack,
    });
    if ((error as any).code) {
      logger.error(`Error code: ${(error as any).code}`);
    }
    if ((error as any).address) {
      logger.error(`Address: ${(error as any).address}:${(error as any).port}`);
    }
    if ((error as any).errors) {
      logger.error('Multiple errors:');
      (error as any).errors.forEach((e: Error, i: number) => {
        logger.error(`  ${i + 1}. ${e.message}`);
      });
    }
    process.exit(1);
  }
}

testConnection().catch((error) => {
  logger.error('Fatal error', { error: (error as Error).message });
  process.exit(1);
});
