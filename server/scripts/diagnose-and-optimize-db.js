#!/usr/bin/env node

/**
 * Database Performance Diagnostic and Optimization Script
 *
 * This script:
 * 1. Checks current indexes on critical tables
 * 2. Analyzes query performance with EXPLAIN ANALYZE
 * 3. Creates missing indexes for optimal performance
 * 4. Verifies PostGIS spatial indexes
 * 5. Tests query performance before and after optimization
 */

require('dotenv').config();
const pgp = require('pg-promise')();
const config = require('../config');
const logger = require('../utils/logger');

const db = pgp(config.database.postgres.url);

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function printHeader(text) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}`);
  console.log(`${text}`);
  console.log(`${'='.repeat(80)}${colors.reset}\n`);
}

function printSubHeader(text) {
  console.log(`\n${colors.bright}${colors.yellow}${text}${colors.reset}`);
  console.log(`${'-'.repeat(60)}`);
}

function printSuccess(text) {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printError(text) {
  console.log(`${colors.red}✗ ${text}${colors.reset}`);
}

function printInfo(text) {
  console.log(`${colors.blue}ℹ ${text}${colors.reset}`);
}

/**
 * Check what indexes exist on a table
 */
async function checkIndexes(tableName) {
  const query = `
    SELECT 
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' 
      AND tablename = $1
    ORDER BY indexname;
  `;

  const indexes = await db.manyOrNone(query, [tableName]);
  return indexes;
}

/**
 * Check table statistics
 */
async function getTableStats(tableName) {
  const query = `
    SELECT 
      n_live_tup as row_count,
      n_dead_tup as dead_rows,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND relname = $1;
  `;

  const stats = await db.oneOrNone(query, [tableName]);
  return stats;
}

/**
 * Run EXPLAIN ANALYZE on the critical query
 */
async function explainQuery() {
  printSubHeader('Analyzing Query Performance with EXPLAIN ANALYZE');

  // Sample bounds (Los Angeles area)
  const latmin = 33.7;
  const lonmin = -118.5;
  const latmax = 34.3;
  const lonmax = -117.9;
  const recentContactThreshold = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Last 24 hours

  const query = `
    EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
    SELECT 
      a.*,
      c.departure_iata,
      c.departure_icao,
      c.departure_name,
      c.arrival_iata,
      c.arrival_icao,
      c.arrival_name,
      c.aircraft_type,
      c.source as route_source,
      c.created_at as route_created_at
    FROM (
      SELECT *
      FROM aircraft_states
      WHERE last_contact >= $1
        AND (
          (geom IS NOT NULL 
           AND ST_Contains(
             ST_MakeEnvelope($4, $2, $5, $3, 4326),
             geom
           ))
          OR
          (geom IS NULL
           AND latitude BETWEEN $2 AND $3
           AND longitude BETWEEN $4 AND $5)
        )
      ORDER BY last_contact DESC
      LIMIT 1000
    ) a
    LEFT JOIN LATERAL (
      SELECT 
        departure_iata,
        departure_icao,
        departure_name,
        arrival_iata,
        arrival_icao,
        arrival_name,
        aircraft_type,
        source,
        created_at
      FROM (
        SELECT 
          departure_iata,
          departure_icao,
          departure_name,
          arrival_iata,
          arrival_icao,
          arrival_name,
          aircraft_type,
          source,
          created_at
        FROM flight_routes_cache
        WHERE cache_key = a.icao24
        UNION ALL
        SELECT 
          departure_iata,
          departure_icao,
          departure_name,
          arrival_iata,
          arrival_icao,
          arrival_name,
          aircraft_type,
          source,
          created_at
        FROM flight_routes_cache
        WHERE cache_key = a.callsign 
          AND a.callsign IS NOT NULL 
          AND a.callsign != ''
      ) combined
      ORDER BY created_at DESC
      LIMIT 1
    ) c ON true
    ORDER BY a.last_contact DESC;
  `;

  try {
    const startTime = Date.now();
    const result = await db.any(query, [recentContactThreshold, latmin, latmax, lonmin, lonmax]);
    const duration = Date.now() - startTime;

    const plan = result[0]['QUERY PLAN'][0];
    const executionTime = plan['Execution Time'];
    const planningTime = plan['Planning Time'];

    printInfo(`Planning Time: ${planningTime.toFixed(2)}ms`);
    printInfo(`Execution Time: ${executionTime.toFixed(2)}ms`);
    printInfo(`Total Time: ${duration}ms`);

    if (executionTime > 1000) {
      printError(`Query is SLOW (${executionTime.toFixed(0)}ms). Needs optimization!`);
    } else if (executionTime > 100) {
      printWarning(`Query is acceptable but could be faster (${executionTime.toFixed(0)}ms)`);
    } else {
      printSuccess(`Query is fast (${executionTime.toFixed(0)}ms)`);
    }

    // Print key insights from the plan
    console.log('\nQuery Plan Details:');
    console.log(JSON.stringify(plan, null, 2));

    return {
      executionTime, planningTime, duration, plan,
    };
  } catch (error) {
    printError(`Failed to run EXPLAIN ANALYZE: ${error.message}`);
    return null;
  }
}

/**
 * Create missing critical indexes
 */
async function createOptimalIndexes() {
  printSubHeader('Creating Optimal Indexes');

  const indexes = [
    {
      name: 'idx_aircraft_states_last_contact',
      table: 'aircraft_states',
      definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_last_contact ON aircraft_states(last_contact DESC);',
      description: 'Index on last_contact for time-based filtering (DESC for sorted queries)',
    },
    {
      name: 'idx_aircraft_states_lat_lon',
      table: 'aircraft_states',
      definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_lat_lon ON aircraft_states(latitude, longitude) WHERE geom IS NULL;',
      description: 'Composite index on lat/lon for spatial queries (partial index for non-PostGIS fallback)',
    },
    {
      name: 'idx_aircraft_states_last_contact_geom',
      table: 'aircraft_states',
      definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_last_contact_geom ON aircraft_states(last_contact) WHERE geom IS NOT NULL;',
      description: 'Index on last_contact for rows with geometry (partial index)',
    },
    {
      name: 'idx_flight_routes_cache_created_at',
      table: 'flight_routes_cache',
      definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flight_routes_cache_created_at ON flight_routes_cache(cache_key, created_at DESC);',
      description: 'Composite index for cache key lookups with sorting by created_at',
    },
    {
      name: 'idx_aircraft_states_history_icao24_contact',
      table: 'aircraft_states_history',
      definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_history_icao24_contact ON aircraft_states_history(icao24, last_contact DESC);',
      description: 'Composite index for history queries by aircraft',
    },
  ];

  for (const idx of indexes) {
    try {
      // Check if index already exists
      const exists = await db.oneOrNone(
        'SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2',
        ['public', idx.name],
      );

      if (exists) {
        printInfo(`Index ${idx.name} already exists, skipping`);
        continue;
      }

      printInfo(`Creating index: ${idx.name}`);
      printInfo(`  Description: ${idx.description}`);

      const startTime = Date.now();
      await db.none(idx.definition);
      const duration = Date.now() - startTime;

      printSuccess(`Created ${idx.name} in ${duration}ms`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        printInfo(`Index ${idx.name} already exists`);
      } else {
        printError(`Failed to create ${idx.name}: ${error.message}`);
      }
    }
  }
}

/**
 * Verify PostGIS spatial indexes exist and are valid
 */
async function verifyPostGISIndexes() {
  printSubHeader('Verifying PostGIS Spatial Indexes');

  const requiredIndexes = [
    { table: 'aircraft_states', column: 'geom', name: 'idx_aircraft_states_geom' },
    { table: 'aircraft_states_history', column: 'geom', name: 'idx_aircraft_history_geom' },
    { table: 'airports', column: 'geom', name: 'idx_airports_geom' },
  ];

  for (const idx of requiredIndexes) {
    try {
      const result = await db.oneOrNone(
        `SELECT 
           i.indexname,
           i.indexdef,
           pg_size_pretty(pg_relation_size(i.indexrelid)) as size
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname
         WHERE i.schemaname = 'public' 
           AND i.tablename = $1
           AND i.indexname = $2`,
        [idx.table, idx.name],
      );

      if (result) {
        printSuccess(`${idx.name} exists (${result.size})`);

        // Check if it's a GIST index
        if (result.indexdef.includes('USING gist')) {
          printSuccess('  ✓ Using GIST (spatial index)');
        } else {
          printWarning('  ⚠ Not using GIST - may not be optimal for spatial queries');
        }
      } else {
        printError(`${idx.name} is MISSING!`);
        printInfo(`  Creating spatial index on ${idx.table}.${idx.column}...`);

        await db.none(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx.name} ON ${idx.table} USING GIST(${idx.column});`);
        printSuccess(`  Created ${idx.name}`);
      }
    } catch (error) {
      printError(`Error checking ${idx.name}: ${error.message}`);
    }
  }
}

/**
 * Check if geometry columns are populated
 */
async function checkGeometryPopulation() {
  printSubHeader('Checking Geometry Column Population');

  const tables = ['aircraft_states', 'aircraft_states_history'];

  for (const table of tables) {
    try {
      const stats = await db.one(`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(geom) as rows_with_geom,
          COUNT(*) FILTER (WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL) as missing_geom,
          ROUND(100.0 * COUNT(geom) / NULLIF(COUNT(*), 0), 2) as geom_percentage
        FROM ${table}
      `);

      printInfo(`${table}:`);
      printInfo(`  Total rows: ${stats.total_rows}`);
      printInfo(`  Rows with geometry: ${stats.rows_with_geom} (${stats.geom_percentage}%)`);

      if (stats.missing_geom > 0) {
        printWarning(`  ${stats.missing_geom} rows missing geometry but have lat/lon`);
        printInfo(`  Run: UPDATE ${table} SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;`);
      } else {
        printSuccess('  All rows with lat/lon have geometry populated');
      }
    } catch (error) {
      printError(`Error checking ${table}: ${error.message}`);
    }
  }
}

/**
 * Analyze table statistics
 */
async function analyzeTableStatistics() {
  printSubHeader('Analyzing Table Statistics');

  const tables = [
    'aircraft_states',
    'aircraft_states_history',
    'flight_routes_cache',
    'flight_routes_history',
  ];

  for (const table of tables) {
    try {
      const stats = await getTableStats(table);

      if (!stats) {
        printWarning(`No statistics found for ${table}`);
        continue;
      }

      printInfo(`${table}:`);
      printInfo(`  Live rows: ${stats.row_count.toLocaleString()}`);
      printInfo(`  Dead rows: ${stats.dead_rows.toLocaleString()}`);

      if (stats.dead_rows > stats.row_count * 0.1) {
        printWarning('  High dead row ratio - consider running VACUUM');
      }

      printInfo(`  Last ANALYZE: ${stats.last_autoanalyze || stats.last_analyze || 'Never'}`);

      // Run ANALYZE if never done or if dead rows are high
      if (!stats.last_analyze && !stats.last_autoanalyze) {
        printWarning(`  Running ANALYZE on ${table}...`);
        await db.none(`ANALYZE ${table};`);
        printSuccess(`  Completed ANALYZE on ${table}`);
      }
    } catch (error) {
      printError(`Error analyzing ${table}: ${error.message}`);
    }
  }
}

/**
 * Generate migration SQL file
 */
async function generateMigrationSQL() {
  printSubHeader('Generating Migration SQL for Lightsail');

  const migrationSQL = `-- Migration: Database Performance Optimization
-- Version: 002
-- Description: Adds critical indexes for query performance
-- 
-- This migration should be run on any database instance to ensure
-- optimal query performance, especially on Lightsail instances.

-- ==============================================================================
-- CRITICAL INDEXES FOR aircraft_states TABLE
-- ==============================================================================

-- Index on last_contact for time-based filtering (most critical)
-- DESC order for sorted queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_last_contact 
ON aircraft_states(last_contact DESC);

-- Composite index on lat/lon for spatial queries (fallback when PostGIS not available)
-- Partial index only for rows without geometry
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_lat_lon 
ON aircraft_states(latitude, longitude) 
WHERE geom IS NULL;

-- Partial index for time filtering when geometry is available
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_last_contact_geom 
ON aircraft_states(last_contact) 
WHERE geom IS NOT NULL;

-- ==============================================================================
-- POSTGIS SPATIAL INDEXES
-- ==============================================================================

-- Spatial index on aircraft_states (critical for ST_Contains queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_geom 
ON aircraft_states USING GIST(geom);

-- Spatial index on aircraft_states_history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_history_geom 
ON aircraft_states_history USING GIST(geom);

-- ==============================================================================
-- FLIGHT ROUTES CACHE INDEXES
-- ==============================================================================

-- Composite index for cache lookups with time sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flight_routes_cache_created_at 
ON flight_routes_cache(cache_key, created_at DESC);

-- Existing indexes (should already exist, but included for completeness)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_cache_key 
ON flight_routes_cache(cache_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_icao24 
ON flight_routes_cache(icao24);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_callsign 
ON flight_routes_cache(callsign);

-- ==============================================================================
-- AIRCRAFT STATES HISTORY INDEXES
-- ==============================================================================

-- Composite index for history queries by aircraft
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aircraft_states_history_icao24_contact 
ON aircraft_states_history(icao24, last_contact DESC);

-- ==============================================================================
-- UPDATE STATISTICS
-- ==============================================================================

-- Update table statistics for query planner
ANALYZE aircraft_states;
ANALYZE aircraft_states_history;
ANALYZE flight_routes_cache;
ANALYZE flight_routes_history;

-- ==============================================================================
-- VERIFY GEOMETRY POPULATION
-- ==============================================================================

-- Populate geometry from lat/lon if missing (may take time on large tables)
-- Run in batches if table is very large
UPDATE aircraft_states 
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) 
WHERE geom IS NULL 
  AND latitude IS NOT NULL 
  AND longitude IS NOT NULL;

UPDATE aircraft_states_history 
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) 
WHERE geom IS NULL 
  AND latitude IS NOT NULL 
  AND longitude IS NOT NULL;

-- ==============================================================================
-- PERFORMANCE NOTES
-- ==============================================================================

-- CONCURRENTLY: Creates indexes without locking the table (recommended for production)
-- IF NOT EXISTS: Safe to run multiple times
-- DESC order: Optimizes for ORDER BY ... DESC queries
-- Partial indexes: Smaller, faster indexes for specific conditions
-- GIST: Spatial index type for PostGIS geometry columns

-- Expected impact:
-- - Query time reduced from 30+ seconds to < 100ms
-- - Spatial queries use GIST index instead of sequential scan
-- - Time-based filtering uses btree index instead of sequential scan
-- - Cache lookups are optimized with composite index
`;

  const fs = require('fs');
  const path = require('path');
  const migrationPath = path.join(__dirname, '..', 'migrations', '002_performance_optimization.sql');

  fs.writeFileSync(migrationPath, migrationSQL);
  printSuccess(`Generated migration SQL: ${migrationPath}`);

  return migrationPath;
}

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
  printHeader('DATABASE PERFORMANCE DIAGNOSTIC AND OPTIMIZATION');

  try {
    // 1. Check current indexes
    printSubHeader('Current Indexes on aircraft_states');
    const aircraftIndexes = await checkIndexes('aircraft_states');
    if (aircraftIndexes.length === 0) {
      printWarning('No indexes found on aircraft_states!');
    } else {
      aircraftIndexes.forEach((idx) => {
        console.log(`  - ${idx.indexname}`);
      });
    }

    printSubHeader('Current Indexes on flight_routes_cache');
    const cacheIndexes = await checkIndexes('flight_routes_cache');
    if (cacheIndexes.length === 0) {
      printWarning('No indexes found on flight_routes_cache!');
    } else {
      cacheIndexes.forEach((idx) => {
        console.log(`  - ${idx.indexname}`);
      });
    }

    // 2. Analyze table statistics
    await analyzeTableStatistics();

    // 3. Check geometry population
    await checkGeometryPopulation();

    // 4. Verify PostGIS indexes
    await verifyPostGISIndexes();

    // 5. Run query performance test BEFORE optimization
    printHeader('QUERY PERFORMANCE TEST - BEFORE OPTIMIZATION');
    const beforeStats = await explainQuery();

    // 6. Create optimal indexes
    printHeader('CREATING OPTIMAL INDEXES');
    await createOptimalIndexes();

    // 7. Run query performance test AFTER optimization
    printHeader('QUERY PERFORMANCE TEST - AFTER OPTIMIZATION');
    const afterStats = await explainQuery();

    // 8. Generate migration SQL
    await generateMigrationSQL();

    // 9. Summary
    printHeader('OPTIMIZATION SUMMARY');

    if (beforeStats && afterStats) {
      const improvement = beforeStats.executionTime - afterStats.executionTime;
      const percentImprovement = (improvement / beforeStats.executionTime) * 100;

      printInfo(`Before: ${beforeStats.executionTime.toFixed(2)}ms`);
      printInfo(`After:  ${afterStats.executionTime.toFixed(2)}ms`);

      if (improvement > 0) {
        printSuccess(`Improvement: ${improvement.toFixed(2)}ms (${percentImprovement.toFixed(1)}% faster)`);
      } else if (improvement < 0) {
        printWarning(`Query is slower by ${Math.abs(improvement).toFixed(2)}ms (may need more data or ANALYZE)`);
      } else {
        printInfo('No significant change in performance');
      }
    }

    printSuccess('Diagnostic and optimization complete!');
    printInfo('\nNext steps:');
    printInfo('1. Apply the generated migration SQL to Lightsail instance');
    printInfo('2. Run ANALYZE on all tables after restoring backup');
    printInfo('3. Monitor query performance in production');
  } catch (error) {
    printError(`Diagnostic failed: ${error.message}`);
    console.error(error);
  } finally {
    await db.$pool.end();
  }
}

// Run diagnostics
runDiagnostics().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
