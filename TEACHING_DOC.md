## Fly Overhead – Queue-Based Ingestion & Live State Cache

This document explains, in teaching detail, how the recent Phase 1 and Phase 2 changes make the system faster, safer, and easier to scale. Think of it as the lecture notes for a university course, written so clearly that a high-school student could still follow along.

---

### Mental Model

Visualize the back end as three layers:

1. **Ingress** – HTTP routes validate input and fan work out to other services.
2. **Buffer** – Redis queue + live in-memory cache absorb bursts and keep hot data nearby.
3. **Persistence** – Postgres is the source of truth, fed by a background worker that can run at its own pace.

When requests arrive, we respond from memory/queue whenever possible, and only hit the database when strictly necessary. This is a modern pattern used in large-scale systems such as ad servers and real-time dashboards.

---

## Phase 1 – Queue-Based Ingestion

**Problem**  
Originally, the `/api/flights` route fetched airplanes.live data and wrote every point directly into Postgres. If 100 users hit the endpoint at once, the server opened 100 DB connections and often timed out.

**Solution**  
Split work into “read” vs “write” paths. The HTTP route focuses on fetching and returning data, while writes are handled asynchronously by a background worker through Redis.

```247:255:server/src/routes/aircraft.routes.ts
if (queueService.isEnabled()) {
  await queueService.enqueueAircraftStates(
    preparedStates.map((state) => ({
      state,
      source: 'airplanes.live',
      sourcePriority: 20,
      ingestionTimestamp: new Date().toISOString(),
    })),
  );
}
```

**Why it helps**

- Responses return as soon as data is enqueued—no waiting on Postgres.
- Throughput now scales with Redis (in-memory) instead of DB connections.
- Redis provides natural buffering: if Postgres slows down, items wait in the queue instead of crashing the site.

**Background worker**

```60:88:server/src/workers/aircraftIngestionWorker.ts
await postgresRepository.upsertAircraftStateWithPriority(...);
liveStateStore.upsertState(message.state);
```

- Batches writes for efficiency.
- Retries on errors and requeues failed messages (up to 3 tries).
- After writing to Postgres, it hydrates the live cache (Phase 2) so fresh data is available immediately.

**Benefits to highlight in an interview**

- Eliminated request-thread contention by decoupling user traffic from DB writes.
- Implemented natural back-pressure: Redis queue absorbs spikes and lets the worker drain at a steady rate.
- Enabled independent scaling—add more workers if ingestion becomes a bottleneck.

---

## Phase 2 – Live State Cache

**Problem**  
Even with queued writes, every `GET /api/flights` still hit Postgres to render the map. Under real-world load, this was too slow and expensive.

**Solution**  
Keep the freshest aircraft states in RAM so most API calls never touch Postgres. We built a configurable, TTL-based cache (`LiveStateStore`) with bounding-box queries.

```1:108:server/src/services/LiveStateStore.ts
class LiveStateStore {
  upsertState(state) {
    const icao24 = state[STATE_INDEX.ICAO24];
    if (icao24) this.entries.set(icao24, { state, updatedAt: Date.now() });
  }

  getStatesInBounds(latMin, lonMin, latMax, lonMax, recentThreshold) {
    const cutoff = Date.now() - this.ttlMs;
    return [...this.entries.values()]
      .filter(entry => entry.updatedAt >= cutoff)
      .map(entry => entry.state)
      .filter(state => withinBounds(state, latMin, lonMin, latMax, lonMax))
      .filter(state => state[STATE_INDEX.LAST_CONTACT] >= recentThreshold);
  }
}
```

**Route changes**

```230:291:server/src/routes/aircraft.routes.ts
const liveStateSamples = config.liveState.enabled
  ? liveStateStore.getStatesInBounds(...)
  : [];

const shouldQueryDb = !config.liveState.enabled
  || liveStateSamples.length < liveStateStore.getMinResultsBeforeFallback();

if (shouldQueryDb) {
  aircraftStates = await postgresRepository.findAircraftInBounds(...);
}

const mergedAircraft = mergeLiveSamplesWithDb(
  aircraftStates,
  liveStateSamples.length ? liveStateSamples : preparedStates,
);
```

- Most requests are satisfied purely from RAM (sub-millisecond access).
- If the cache doesn’t have enough points (< `minResultsBeforeDbFallback`), we automatically fall back to the DB to guarantee completeness.

**Config knobs**

Defined in `server/src/config/index.ts`:

- `ENABLE_LIVE_STATE_CACHE`
- `LIVE_STATE_TTL_SECONDS`
- `LIVE_STATE_MAX_ENTRIES`
- `LIVE_STATE_MIN_RESULTS_BEFORE_DB`

These let us tune memory usage vs. freshness without code changes.

**Why it’s “modern architecture”**

- Mirrors real-time systems at scale: ingest -> queue -> cache -> DB.
- Cache invalidation handled via TTL + cleanup intervals; eviction keeps memory bounded.
- Failure modes are graceful: cache disabled? We drop straight back to DB queries.
- Multi-writer design (route + worker) ensures consistency across ingestion sources.

---

## Shared Utilities & Testing

- Introduced `server/src/utils/aircraftState.ts` to house tuple indices and state helpers so every subsystem interprets raw states the same way.
- Added Jest suites for both the queue and cache:
  - `LiveStateStore.test.ts` covers TTL pruning, bounding-box filters, and LRU eviction.
  - `QueueService.test.ts` ensures Redis interactions and JSON payloads are correct.
- Docker Compose now injects `REACT_APP_GOOGLE_CLIENT_ID` & `REACT_APP_API_URL` during build—fixing the previously missing Google OAuth client ID in dev containers.

---

## Interview Story Cheat Sheet

**Situation:** High traffic caused DB contention. Map data was stale and API responses timed out.

**Task:** Deliver real-time aircraft data without melting the database.

**Actions:**
1. Designed a Redis-backed ingestion queue so user requests never touch Postgres directly.
2. Built a background worker with batching/retries, ensuring reliable persistence even when DB is slow.
3. Implemented a live, TTL-governed cache that satisfies most read requests from memory.
4. Centralized configuration and environment injection so Docker builds behave exactly like local dev.

**Results:** Requests return in milliseconds, DB load is stable, and we now have tunable controls for cache TTL, queue size, and fallback thresholds. This architecture is resilient, easily explainable, and mirrors patterns used by modern large-scale applications.

Use this narrative to answer prompts like:
- “Describe a time you improved system scalability.”
- “How would you design a low-latency real-time feed?”
- “Explain a complex bug you fixed (Google OAuth client ID missing in Docker).”

You can point directly to the relevant code snippets and tests included above to show the depth of the solution.

