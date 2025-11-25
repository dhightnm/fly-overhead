# Phase 3.1 – TimescaleDB Enablement (Staging → Production)

This document captures the first sub-phase of the Phase 3 migration: enabling TimescaleDB inside the existing Postgres deployment (Lightsail + staging) without disturbing current data.

## Local development bootstrap

1. Update Docker compose to use TimescaleDB (done in repo: `timescale/timescaledb-ha:pg15-latest`).
2. Place init SQL in `server/database/initdb/01-enable-timescale.sql` to auto-run `CREATE EXTENSION timescaledb;` and `postgis`.
3. Recreate the dev database:
   ```bash
   docker compose -f docker-compose.dev.yml down -v db-data
   docker compose -f docker-compose.dev.yml up -d db
   ```
4. Connect and verify:
   ```bash
   docker compose -f docker-compose.dev.yml exec db psql -U postgres -d fly_overhead -c \"\\dx\"
   ```
   You should see both `timescaledb` and `postgis` extensions installed.

## 0. Pre-flight

1. **Snapshot the VM/volume** (Lightsail snapshot or block-level backup).
2. **Logical backup (optional but recommended)**:
   ```bash
   pg_dump --format=custom --file=flyoverhead-$(date +%F).dump "$POSTGRES_URL"
   ```
3. **Verify disk headroom**: Timescale rewrite requires temporary space proportional to the largest table (typically 10–15%). Clear vacuumed bloat before the maintenance window.

## 1. Install TimescaleDB extension

### Staging
1. SSH to the staging Postgres box.
2. Install TimescaleDB packages (example for Ubuntu/Debian):
   ```bash
   sudo apt update
   sudo apt install timescaledb-2-postgresql-13  # adjust to PG version
   sudo timescaledb-tune  # let it update postgresql.conf (accept defaults)
   sudo systemctl restart postgresql
   ```
3. Inside `psql`:
   ```sql
   CREATE EXTENSION IF NOT EXISTS timescaledb;
   ```

### Production (Lightsail)
Repeat the same steps during the maintenance window after verifying the package repo for Amazon Linux/Ubuntu (depending on the Lightsail blueprint). Always recheck `CREATE EXTENSION` succeeds.

## 2. Convert tables to hypertables

> Always run in staging first. Wrap each `create_hypertable` call in a transaction for easy rollback.

Example for `aircraft_states`:
```sql
\c fly_overhead
BEGIN;
SELECT create_hypertable(
  'aircraft_states',
  'last_contact',
  migrate_data => true,
  if_not_exists => true
);
COMMIT;
```

Recommended order:
1. `aircraft_states`
2. `flight_routes_cache`
3. `webhook_events` / history tables

Post-conversion validation:
```sql
SELECT hypertable_id, table_name FROM timescaledb_information.hypertables;
SELECT COUNT(*) FROM aircraft_states;
```

Rollback (if needed before COMMIT): `ROLLBACK`. After commit, drop hypertable via `SELECT drop_chunks('aircraft_states', older_than => INTERVAL '0'); ALTER TABLE aircraft_states SET (timescaledb.hypertable = false);` (only if failure occurs—otherwise restore from backup).

## 3. Compression policies

Only enable after hypertables prove stable in staging. Example:
```sql
ALTER TABLE aircraft_states SET (timescaledb.compress, timescaledb.compress_orderby = 'last_contact DESC', timescaledb.compress_segmentby = 'icao24');
SELECT add_compression_policy('aircraft_states', INTERVAL '7 days');
```

Repeat for other hypertables, using larger intervals for cache tables (e.g., 30 days). Compression can be triggered manually:
```sql
SELECT compress_chunk(i.chunk_name)
FROM timescaledb_information.chunks i
WHERE hypertable_name = 'aircraft_states'
  AND i.ranged_chunk_end < now() - INTERVAL '7 days';
```

## 4. Application deployment

No code changes are needed solely for the conversion—existing queries continue to work. After staging burn-in:
1. Deploy the current `staging` build to production.
2. Monitor ingest/webhook workers for any regression.
3. Repeat the hypertable + compression process on Lightsail.

## 5. Verification checklist

- [ ] Snapshot + logical backup completed.
- [ ] `CREATE EXTENSION timescaledb` works in staging.
- [ ] All target tables converted via `create_hypertable`.
- [ ] `SELECT COUNT(*)` before/after match.
- [ ] Compression policy added and first manual `compress_chunk` succeeds.
- [ ] App smoke tests (ingest/webhook/portal) pass in staging.
- [ ] Production extension install & hypertable conversion completed.

Once these boxes are checked, proceed to Phase 3.2 (Timescale-specific aggregates, retention policies, and code optimizations).
