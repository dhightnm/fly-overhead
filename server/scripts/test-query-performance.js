#!/usr/bin/env node

/**
 * Quick Query Performance Test
 * Tests the findAircraftInBounds query with EXPLAIN ANALYZE
 */

require('dotenv').config();
const pgp = require('pg-promise')();
const config = require('../config');

// Override with local database if POSTGRES_URL not set or pointing to remote
const dbUrl = process.env.TEST_DB_URL || process.env.POSTGRES_URL;
const db = pgp(dbUrl);

async function testQuery() {
  console.log('\n🔍 Testing findAircraftInBounds Query Performance\n');
  console.log(`Database: ${dbUrl.replace(/:[^:@]*@/, ':****@')}\n`);

  // Sample bounds (Los Angeles area)
  const latmin = 33.7;
  const lonmin = -118.5;
  const latmax = 34.3;
  const lonmax = -117.9;
  const recentContactThreshold = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Last 24 hours

  const query = `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
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

    console.log('⏱️  Performance Results:');
    console.log(`   Planning Time:   ${planningTime.toFixed(2)}ms`);
    console.log(`   Execution Time:  ${executionTime.toFixed(2)}ms`);
    console.log(`   Total Time:      ${duration}ms\n`);

    if (executionTime > 1000) {
      console.log(`❌ Query is SLOW (${executionTime.toFixed(0)}ms) - needs optimization!`);
    } else if (executionTime > 100) {
      console.log(`⚠️  Query is acceptable but could be faster (${executionTime.toFixed(0)}ms)`);
    } else {
      console.log(`✅ Query is FAST (${executionTime.toFixed(0)}ms) - excellent performance!`);
    }

    // Check for index usage
    const planStr = JSON.stringify(plan);
    const hasIndexScan = planStr.includes('Index Scan') || planStr.includes('Index Only Scan');
    const hasSeqScan = planStr.includes('Seq Scan');

    console.log('\n📊 Query Plan Analysis:');
    if (hasIndexScan) {
      console.log('   ✅ Using index scans');
    }
    if (hasSeqScan) {
      console.log('   ⚠️  Contains sequential scans (may be okay for small tables)');
    }

    // Print simplified plan
    console.log('\n📝 Execution Plan Summary:');
    printPlanSummary(plan, 0);
  } catch (error) {
    console.error('❌ Query failed:', error.message);
  } finally {
    await db.$pool.end();
  }
}

function printPlanSummary(node, depth = 0) {
  const indent = `   ${'  '.repeat(depth)}`;
  const nodeType = node['Node Type'];
  const relation = node['Relation Name'];
  const indexName = node['Index Name'];
  const scanType = node['Scan Direction'];
  const actualTime = node['Actual Total Time'];
  const rows = node['Actual Rows'];

  let line = `${indent}→ ${nodeType}`;
  if (relation) line += ` on ${relation}`;
  if (indexName) line += ` using ${indexName}`;
  if (scanType) line += ` (${scanType})`;
  if (actualTime !== undefined) line += ` [${actualTime.toFixed(2)}ms, ${rows} rows]`;

  console.log(line);

  // Recursively print child plans
  if (node.Plans) {
    node.Plans.forEach((child) => printPlanSummary(child, depth + 1));
  }
}

testQuery().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
