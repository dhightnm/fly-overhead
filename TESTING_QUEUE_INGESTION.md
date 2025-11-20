# Testing Queue-Based Ingestion in Dev

## Prerequisites

1. **Redis is running** - The queue service requires Redis
2. **Environment variables** - Queue is enabled by default, but you can control it

## Quick Start

### 1. Start the dev environment

```bash
# Start Redis and database
docker compose -f docker-compose.dev.yml up -d db redis

# Start the server (worker runs embedded by default)
docker compose -f docker-compose.dev.yml up server
```

### 2. Verify Queue is Enabled

Check the server logs for:
- `QueueService connected to Redis`
- `Starting aircraft ingestion worker`

### 3. Test the Queue

Make a request to the `/api/flights` endpoint:

```bash
curl "http://localhost:3005/api/flights?lat=40.7128&lon=-74.0060&radius=50"
```

**Expected behavior:**
- Request returns immediately with aircraft data
- Server logs show: `Queued aircraft states for ingestion`
- Worker logs show: `Ingested aircraft batch`

### 4. Monitor Queue Activity

**Check Redis queue length:**
```bash
docker exec fly-overhead-redis redis-cli LLEN flyoverhead:aircraft_ingest
```

**Watch worker logs:**
```bash
docker compose -f docker-compose.dev.yml logs -f server | grep -i "ingest\|queue"
```

## Configuration

### Enable/Disable Queue

**In `.env` file:**
```bash
# Disable queue (falls back to direct DB writes)
DISABLE_QUEUE_INGESTION=true

# Enable queue (default)
ENABLE_QUEUE_INGESTION=true
```

### Enable/Disable Embedded Worker

**In `.env` file:**
```bash
# Disable embedded worker (run worker separately)
DISABLE_EMBEDDED_QUEUE_WORKER=true

# Enable embedded worker (default)
ENABLE_EMBEDDED_QUEUE_WORKER=true
```

### Run Worker Separately

If you disable the embedded worker, you can run it as a separate process:

```bash
# In the server container
docker exec -it fly-overhead-server npm run worker:ingest

# Or locally (if you have Node.js installed)
cd server
npm run worker:ingest
```

## Testing Scenarios

### 1. Normal Flow (Queue Enabled)

1. Make API request → Data enqueued
2. Worker processes batch → Data written to DB
3. Request returns immediately (doesn't wait for DB write)

### 2. Queue Disabled (Direct Writes)

1. Set `DISABLE_QUEUE_INGESTION=true`
2. Restart server
3. Make API request → Data written directly to DB
4. Request waits for DB write to complete

### 3. Worker Failure

1. Stop the worker (if running separately)
2. Make API requests → Data enqueued but not processed
3. Check queue length: `redis-cli LLEN flyoverhead:aircraft_ingest`
4. Restart worker → Queue processes backlog

### 4. Redis Failure

1. Stop Redis: `docker stop fly-overhead-redis`
2. Make API request → Falls back to direct DB writes
3. Check logs for: `QueueService failed to connect to Redis`

## Troubleshooting

### Queue not processing

- Check Redis is running: `docker ps | grep redis`
- Check worker logs: `docker compose logs server | grep worker`
- Verify queue has messages: `redis-cli LLEN flyoverhead:aircraft_ingest`

### Messages stuck in queue

- Check worker is running
- Check database connection
- Look for error logs: `docker compose logs server | grep -i error`

### High queue length

- Worker may be slower than ingestion rate
- Consider increasing `QUEUE_BATCH_SIZE` in `.env`
- Consider running multiple workers (future enhancement)

## Performance Testing

### Measure Queue Throughput

```bash
# Enqueue messages
for i in {1..100}; do
  curl "http://localhost:3005/api/flights?lat=40.7128&lon=-74.0060&radius=50" > /dev/null 2>&1
done

# Monitor queue length
watch -n 1 'docker exec fly-overhead-redis redis-cli LLEN flyoverhead:aircraft_ingest'
```

### Compare Queue vs Direct Writes

1. **With queue:** Measure API response time (should be fast)
2. **Without queue:** Set `DISABLE_QUEUE_INGESTION=true`, measure API response time (may be slower)

## Next Steps

After verifying queue works in dev:
1. Run unit tests: `cd server && npm test`
2. Test with production-like load
3. Monitor database connection pool usage
4. Proceed to Phase 2: Live State Cache

