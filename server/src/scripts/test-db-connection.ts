#!/usr/bin/env node
/**
 * Test database connection script
 * Verifies that the database connection is working correctly
 */

import dotenv from 'dotenv';
import pgPromise from 'pg-promise';

dotenv.config();

const { POSTGRES_URL } = process.env;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is not set');
  process.exit(1);
}

// Check if it's an AWS RDS/Lightsail endpoint
const isAwsRds = POSTGRES_URL.includes('.rds.amazonaws.com')
  || POSTGRES_URL.includes('.lightsail.aws')
  || POSTGRES_URL.includes('ls-');

async function testConnection(): Promise<void> {
  console.log('🔍 Testing database connection...');
  console.log(`📍 Endpoint: ${isAwsRds ? 'AWS RDS/Lightsail' : 'Local/Other'}`);
  console.log(`🔗 Connection string: ${POSTGRES_URL.replace(/:[^:@]+@/, ':****@')}`); // Mask password
  console.log('');

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
      console.log('✅ Connection config parsed for AWS RDS/Lightsail');
    } else {
      // Use connection string directly
      const connectionConfig: any = {
        connectionString: POSTGRES_URL,
        max: 5,
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      };
      db = pgPromise()(connectionConfig);
      console.log('✅ Connection config created for local/other database');
    }

    console.log('⏳ Attempting to connect...');
    const startTime = Date.now();

    // Test 1: Basic connection
    const client = await db.connect();
    const connectTime = Date.now() - startTime;
    console.log(`✅ Connection established in ${connectTime}ms`);
    client.done();

    // Test 2: Simple query
    console.log('⏳ Testing simple query...');
    const queryStart = Date.now();
    const result = await db.one('SELECT NOW() as current_time, version() as version');
    const queryTime = Date.now() - queryStart;
    console.log(`✅ Query executed in ${queryTime}ms`);
    console.log(`   Current time: ${result.current_time}`);
    console.log(`   PostgreSQL version: ${result.version.split(' ')[0]} ${result.version.split(' ')[1]}`);

    // Test 3: Check database name
    console.log('⏳ Checking database name...');
    const dbName = await db.one('SELECT current_database() as db_name');
    console.log(`✅ Connected to database: ${dbName.db_name}`);

    // Test 4: Check connection count
    console.log('⏳ Checking connection pool...');
    const poolStats = await db.one(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    console.log('✅ Connection pool stats:');
    console.log(`   Total connections: ${poolStats.total_connections}`);
    console.log(`   Active: ${poolStats.active_connections}`);
    console.log(`   Idle: ${poolStats.idle_connections}`);

    // Test 5: Test a more complex query (check if main table exists)
    console.log('⏳ Testing table access...');
    const tableCheck = await db.oneOrNone(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'aircraft_states'
      ) as table_exists
    `);
    if (tableCheck?.table_exists) {
      const rowCount = await db.one('SELECT COUNT(*) as count FROM aircraft_states LIMIT 1');
      console.log(`✅ Main table 'aircraft_states' exists with ${rowCount.count} rows`);
    } else {
      console.log('⚠️  Main table "aircraft_states" does not exist yet');
    }

    // Test 6: Test PostGIS extension
    console.log('⏳ Checking PostGIS extension...');
    const postgisCheck = await db.oneOrNone(`
      SELECT EXISTS (
        SELECT FROM pg_extension WHERE extname = 'postgis'
      ) as postgis_exists
    `);
    if (postgisCheck?.postgis_exists) {
      const postgisVersion = await db.one('SELECT PostGIS_version() as version');
      console.log(`✅ PostGIS extension enabled: ${postgisVersion.version}`);
    } else {
      console.log('⚠️  PostGIS extension not found');
    }

    await db.$pool.end();
    console.log('');
    console.log('✅ All database connection tests passed!');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error('');
    console.error('❌ Database connection test failed!');
    console.error(`Error: ${err.message}`);
    console.error(`Error name: ${err.name}`);
    if ((error as any).code) {
      console.error(`Error code: ${(error as any).code}`);
    }
    if ((error as any).address) {
      console.error(`Address: ${(error as any).address}:${(error as any).port}`);
    }
    if (err.stack) {
      console.error(`Stack: ${err.stack}`);
    }
    if ((error as any).errors) {
      console.error('Multiple errors:');
      (error as any).errors.forEach((e: Error, i: number) => {
        console.error(`  ${i + 1}. ${e.message}`);
      });
    }
    process.exit(1);
  }
}

testConnection().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
