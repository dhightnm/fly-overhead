import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5433/fly_overhead';

async function ensureExtensions(client: Client): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb;');
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
}

async function isHypertable(client: Client, table: string): Promise<boolean> {
  const result = await client.query(
    `
      SELECT 1
      FROM timescaledb_information.hypertables
      WHERE hypertable_name = $1
      LIMIT 1;
    `,
    [table],
  );
  return Boolean(result.rowCount);
}

async function ensureCompressionConfig(
  client: Client,
  table: string,
  orderBy: string,
  segmentBy: string,
): Promise<void> {
  const result = await client.query(
    `
      SELECT compression_enabled
      FROM timescaledb_information.hypertables
      WHERE hypertable_name = $1
      LIMIT 1;
    `,
    [table],
  );

  const compressionEnabled = Boolean(result.rows?.[0]?.compression_enabled);
  if (compressionEnabled) {
    return;
  }

  await client.query(`
    ALTER TABLE ${table} SET (
      timescaledb.compress = true,
      timescaledb.compress_orderby = '${orderBy}',
      timescaledb.compress_segmentby = '${segmentBy}'
    );
  `);
}

async function ensureCompressionPolicy(
  client: Client,
  hypertable: string,
  interval: string,
  fallbackChunks: number,
): Promise<void> {
  const existing = await client.query(
    `
      SELECT 1
      FROM timescaledb_information.jobs
      WHERE hypertable_name = $1
        AND proc_name = 'policy_compression'
      LIMIT 1;
    `,
    [hypertable],
  );

  if (existing.rowCount) {
    return;
  }

  try {
    await client.query('SELECT add_compression_policy($1::regclass, $2::interval);', [
      `public.${hypertable}`,
      interval,
    ]);
    return;
  } catch (error: any) {
    const needsFallback = error?.code === '0A000'
      && typeof error?.message === 'string'
      && error.message.includes('compress_after argument type');

    if (!needsFallback) {
      throw error;
    }
  }

  if (!fallbackChunks || fallbackChunks < 1) {
    throw new Error(`Compression fallback chunk count missing for ${hypertable}`);
  }

  await client.query('SELECT add_compression_policy($1::regclass, $2::integer);', [
    `public.${hypertable}`,
    fallbackChunks,
  ]);
}

async function convertAircraftStatesHistory(client: Client): Promise<void> {
  console.log('Converting aircraft_states_history hypertable...');

  const tableName = 'aircraft_states_history';
  const alreadyHypertable = await isHypertable(client, tableName);

  if (alreadyHypertable) {
    console.log('aircraft_states_history already a hypertable, skipping conversion.');
    await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'icao24');
    await ensureCompressionPolicy(client, 'aircraft_states_history', '30 days', 5);
    return;
  }

  await client.query('ALTER TABLE aircraft_states_history ALTER COLUMN created_at SET NOT NULL;');
  await client.query('ALTER TABLE aircraft_states_history DROP CONSTRAINT IF EXISTS aircraft_states_history_pkey;');
  await client.query('ALTER TABLE aircraft_states_history ADD CONSTRAINT aircraft_states_history_pkey PRIMARY KEY (id, created_at);');
  await client.query('DROP INDEX IF EXISTS idx_aircraft_history_geom_time;');
  await client.query(`
    SELECT create_hypertable(
      'aircraft_states_history',
      'created_at',
      chunk_time_interval => INTERVAL '7 days',
      migrate_data => true,
      if_not_exists => true,
      create_default_indexes => false
    );
  `);
  await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'icao24');
  await ensureCompressionPolicy(client, 'aircraft_states_history', '30 days', 5);
}

async function convertFlightRoutesCache(client: Client): Promise<void> {
  console.log('Converting flight_routes_cache hypertable...');

  const tableName = 'flight_routes_cache';
  const alreadyHypertable = await isHypertable(client, tableName);

  if (alreadyHypertable) {
    console.log('flight_routes_cache already a hypertable, skipping conversion.');
    await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'cache_key');
    await ensureCompressionPolicy(client, 'flight_routes_cache', '30 days', 30);
    return;
  }

  await client.query('ALTER TABLE flight_routes_cache ALTER COLUMN created_at SET NOT NULL;');
  await client.query('ALTER TABLE flight_routes_cache DROP CONSTRAINT IF EXISTS flight_routes_cache_pkey;');
  await client.query('ALTER TABLE flight_routes_cache ADD CONSTRAINT flight_routes_cache_pkey PRIMARY KEY (id, created_at);');
  await client.query('ALTER TABLE flight_routes_cache DROP CONSTRAINT IF EXISTS flight_routes_cache_cache_key_key;');
  await client.query('DROP INDEX IF EXISTS flight_routes_cache_cache_key_created_at_key;');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS flight_routes_cache_cache_key_created_at_key ON flight_routes_cache (cache_key, created_at);');
  await client.query(`
    SELECT create_hypertable(
      'flight_routes_cache',
      'created_at',
      chunk_time_interval => INTERVAL '1 day',
      migrate_data => true,
      if_not_exists => true,
      create_default_indexes => false
    );
  `);
  await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'cache_key');
  await ensureCompressionPolicy(client, 'flight_routes_cache', '30 days', 30);
}

async function convertFlightRoutesHistory(client: Client): Promise<void> {
  console.log('Converting flight_routes_history hypertable...');

  const tableName = 'flight_routes_history';
  const alreadyHypertable = await isHypertable(client, tableName);

  if (alreadyHypertable) {
    console.log('flight_routes_history already a hypertable, skipping conversion.');
    await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'flight_key');
    await ensureCompressionPolicy(client, 'flight_routes_history', '60 days', 9);
    return;
  }

  await client.query('ALTER TABLE flight_routes_history ALTER COLUMN created_at SET NOT NULL;');
  await client.query('ALTER TABLE flight_routes_history DROP CONSTRAINT IF EXISTS flight_routes_history_pkey;');
  await client.query('ALTER TABLE flight_routes_history ADD CONSTRAINT flight_routes_history_pkey PRIMARY KEY (id, created_at);');
  await client.query('ALTER TABLE flight_routes_history DROP CONSTRAINT IF EXISTS flight_routes_history_icao24_callsign_first_seen_last_seen_key;');
  await client.query('ALTER TABLE flight_routes_history DROP CONSTRAINT IF EXISTS uniq_flight_routes_history_flight_key;');
  await client.query('DROP INDEX IF EXISTS uniq_flight_routes_history_flight_key;');
  await client.query('DROP INDEX IF EXISTS flight_routes_history_flight_key_created_at_key;');
  await client.query('DROP INDEX IF EXISTS flight_routes_history_composite_key;');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS flight_routes_history_flight_key_created_at_key ON flight_routes_history (flight_key, created_at);');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS flight_routes_history_composite_key ON flight_routes_history (icao24, callsign, first_seen, last_seen, created_at);');
  await client.query(`
    SELECT create_hypertable(
      'flight_routes_history',
      'created_at',
      chunk_time_interval => INTERVAL '7 days',
      migrate_data => true,
      if_not_exists => true,
      create_default_indexes => false
    );
  `);
  await ensureCompressionConfig(client, tableName, 'created_at DESC, id', 'flight_key');
  await ensureCompressionPolicy(client, 'flight_routes_history', '60 days', 9);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await ensureExtensions(client);
    await convertAircraftStatesHistory(client);
    await convertFlightRoutesCache(client);
    await convertFlightRoutesHistory(client);
    console.log('TimescaleDB setup complete.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed to configure TimescaleDB:', error);
  process.exitCode = 1;
});
