#!/usr/bin/env node

/**
 * Quick Index Check Script
 * Verifies that all critical performance indexes exist
 */

require('dotenv').config();
const pgp = require('pg-promise')();
const config = require('../config');

const db = pgp(config.database.postgres.url);

const CRITICAL_INDEXES = {
  aircraft_states: [
    'idx_aircraft_states_last_contact',
    'idx_aircraft_states_geom',
    'idx_aircraft_states_lat_lon',
  ],
  flight_routes_cache: [
    'idx_routes_cache_key',
    'idx_flight_routes_cache_created_at',
  ],
  aircraft_states_history: [
    'idx_aircraft_states_history_icao24_contact',
    'idx_aircraft_history_geom',
  ],
};

async function checkIndexes() {
  console.log('\n🔍 Checking Critical Performance Indexes...\n');

  let allPresent = true;

  for (const [table, indexes] of Object.entries(CRITICAL_INDEXES)) {
    console.log(`\n📊 Table: ${table}`);

    for (const indexName of indexes) {
      const result = await db.oneOrNone(
        `SELECT 
           i.indexname,
           pg_size_pretty(pg_relation_size(c.oid)) as size
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname
         WHERE i.schemaname = 'public' 
           AND i.tablename = $1
           AND i.indexname = $2`,
        [table, indexName],
      );

      if (result) {
        console.log(`  ✅ ${indexName} (${result.size})`);
      } else {
        console.log(`  ❌ ${indexName} - MISSING!`);
        allPresent = false;
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (allPresent) {
    console.log('✅ All critical indexes are present');
  } else {
    console.log('❌ Some critical indexes are missing!');
    console.log('\nTo fix, run:');
    console.log('  node server/scripts/diagnose-and-optimize-db.js');
    console.log('  OR');
    console.log('  psql $POSTGRES_URL -f server/migrations/002_performance_optimization.sql');
  }
  console.log(`${'='.repeat(60)}\n`);

  await db.$pool.end();
  return allPresent;
}

checkIndexes()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
