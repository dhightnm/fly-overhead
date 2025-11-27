import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { AppConfig } from '../types/config.types';

const rootEnvPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

dotenv.config();

const serverEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
const isProduction = serverEnv === 'production';

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const poolMin = Math.max(1, parseNumber(process.env.POSTGRES_POOL_MIN, 2));
const defaultPoolMax = isProduction ? 20 : 5;
const poolMax = Math.max(poolMin, parseNumber(process.env.POSTGRES_POOL_MAX, defaultPoolMax));

const resolveBooleanFlag = (
  enableKey: string | undefined,
  disableKey: string | undefined,
  defaultValue: boolean,
): boolean => {
  if (enableKey !== undefined) {
    return enableKey === 'true';
  }
  if (disableKey !== undefined) {
    return disableKey !== 'true';
  }
  return defaultValue;
};

const backgroundJobsEnabled = resolveBooleanFlag(
  process.env.ENABLE_BACKGROUND_JOBS,
  process.env.DISABLE_BACKGROUND_JOBS,
  isProduction,
);

const conusPollingEnabled = backgroundJobsEnabled
  ? resolveBooleanFlag(
    process.env.ENABLE_CONUS_POLLING,
    process.env.DISABLE_CONUS_POLLING,
    isProduction,
  )
  : false;

const backfillEnabled = backgroundJobsEnabled
  ? resolveBooleanFlag(
    process.env.ENABLE_BACKGROUND_BACKFILL,
    process.env.DISABLE_BACKGROUND_BACKFILL,
    isProduction,
  )
  : false;

const metricsEnabled = resolveBooleanFlag(
  process.env.ENABLE_METRICS,
  process.env.DISABLE_METRICS,
  false, // Disabled by default - enable when ready
);

const prometheusExportEnabled = resolveBooleanFlag(
  process.env.ENABLE_PROMETHEUS_EXPORT,
  process.env.DISABLE_PROMETHEUS_EXPORT,
  false, // Disabled by default - requires Prometheus infrastructure
);

const queueEnabled = resolveBooleanFlag(
  process.env.ENABLE_QUEUE_INGESTION,
  process.env.DISABLE_QUEUE_INGESTION,
  true,
);
const spawnWorkerInProcess = resolveBooleanFlag(
  process.env.ENABLE_EMBEDDED_QUEUE_WORKER,
  process.env.DISABLE_EMBEDDED_QUEUE_WORKER,
  true,
);
const liveStateEnabled = resolveBooleanFlag(
  process.env.ENABLE_LIVE_STATE_CACHE,
  process.env.DISABLE_LIVE_STATE_CACHE,
  true,
);

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const queueKey = process.env.QUEUE_KEY || 'flyoverhead:aircraft_ingest';
const queueDlqKey = process.env.QUEUE_DLQ_KEY || `${queueKey}:dlq`;
const queueDelayedKey = process.env.QUEUE_DELAYED_KEY || `${queueKey}:delayed`;
const queueBatchSize = Math.max(10, parseNumber(process.env.QUEUE_BATCH_SIZE, 200));
const queuePollIntervalMs = Math.max(250, parseNumber(process.env.QUEUE_POLL_INTERVAL_MS, 1000));
const queueMaxAttempts = Math.max(1, parseNumber(process.env.QUEUE_MAX_ATTEMPTS, 5));
const queueRetryBackoffMs = Math.max(100, parseNumber(process.env.QUEUE_RETRY_BASE_DELAY_MS, 5000));
const queueRetryJitterMs = Math.max(0, parseNumber(process.env.QUEUE_RETRY_JITTER_MS, 750));
const queueDelayedPromotionBatchSize = Math.max(
  1,
  parseNumber(process.env.QUEUE_DELAYED_PROMOTION_BATCH_SIZE, 100),
);

const liveStateTtlSeconds = Math.max(60, parseNumber(process.env.LIVE_STATE_TTL_SECONDS, 300));
const liveStateCleanupSeconds = Math.max(15, parseNumber(process.env.LIVE_STATE_CLEANUP_INTERVAL_SECONDS, 60));
const liveStateMaxEntries = Math.max(1000, parseNumber(process.env.LIVE_STATE_MAX_ENTRIES, 50000));
const liveStateMinResults = Math.max(0, parseNumber(process.env.LIVE_STATE_MIN_RESULTS_BEFORE_DB, 25));

const aircraftCacheEnabled = resolveBooleanFlag(
  process.env.ENABLE_AIRCRAFT_REDIS_CACHE,
  process.env.DISABLE_AIRCRAFT_REDIS_CACHE,
  true,
);
const aircraftCacheRedisUrl = process.env.AIRCRAFT_CACHE_REDIS_URL || redisUrl;
const aircraftCachePrefix = process.env.AIRCRAFT_CACHE_PREFIX || 'flyoverhead:aircraft';
const aircraftCacheTtlSeconds = Math.max(60, parseNumber(process.env.AIRCRAFT_CACHE_TTL_SECONDS, 600));
const aircraftCacheWarmerEnabled = resolveBooleanFlag(
  process.env.ENABLE_AIRCRAFT_CACHE_WARMER,
  process.env.DISABLE_AIRCRAFT_CACHE_WARMER,
  true,
);
const aircraftCacheWarmIntervalSeconds = Math.max(
  60,
  parseNumber(process.env.AIRCRAFT_CACHE_WARM_INTERVAL_SECONDS, 300),
);
const aircraftCacheWarmLookbackMinutes = Math.max(
  1,
  parseNumber(process.env.AIRCRAFT_CACHE_WARM_LOOKBACK_MINUTES, 15),
);
const aircraftCacheWarmBatchSize = Math.max(
  50,
  parseNumber(process.env.AIRCRAFT_CACHE_WARM_BATCH_SIZE, 500),
);

const webhooksEnabled = resolveBooleanFlag(
  process.env.ENABLE_WEBHOOKS,
  process.env.DISABLE_WEBHOOKS,
  true,
);
const enforceWebhookHttps = resolveBooleanFlag(
  process.env.ENFORCE_HTTPS_WEBHOOKS,
  process.env.ALLOW_INSECURE_WEBHOOKS,
  true,
);
const webhookQueueKey = process.env.WEBHOOK_QUEUE_KEY || 'flyoverhead:webhooks';
const webhookDelayedKey = process.env.WEBHOOK_QUEUE_DELAYED_KEY || `${webhookQueueKey}:delayed`;
const webhookDlqKey = process.env.WEBHOOK_QUEUE_DLQ_KEY || `${webhookQueueKey}:dlq`;
const webhookBatchSize = Math.max(1, parseNumber(process.env.WEBHOOK_QUEUE_BATCH_SIZE, 50));
const webhookPollIntervalMs = Math.max(250, parseNumber(process.env.WEBHOOK_QUEUE_POLL_INTERVAL_MS, 1000));
const webhookMaxAttempts = Math.max(1, parseNumber(process.env.WEBHOOK_MAX_ATTEMPTS, 6));
const webhookBackoffMs = Math.max(1000, parseNumber(process.env.WEBHOOK_BACKOFF_MS, 15000));
const webhookRetryJitterMs = Math.max(0, parseNumber(process.env.WEBHOOK_RETRY_JITTER_MS, 2000));
const webhookDelayedPromotionBatchSize = Math.max(
  1,
  parseNumber(process.env.WEBHOOK_DELAYED_PROMOTION_BATCH_SIZE, 100),
);
const webhookTimeoutMs = Math.max(2000, parseNumber(process.env.WEBHOOK_TIMEOUT_MS, 10000));
const webhookSubscriberRateLimitPerMinute = Math.max(0, parseNumber(
  process.env.WEBHOOK_SUBSCRIBER_RATE_LIMIT_PER_MINUTE,
  60,
));
const webhookCircuitBreakerFailureThreshold = Math.max(
  1,
  parseNumber(process.env.WEBHOOK_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5),
);
const webhookCircuitBreakerResetSeconds = Math.max(
  30,
  parseNumber(process.env.WEBHOOK_CIRCUIT_BREAKER_RESET_SECONDS, 300),
);
const spawnWebhookDispatcherInProcess = resolveBooleanFlag(
  process.env.ENABLE_EMBEDDED_WEBHOOK_DISPATCHER,
  process.env.DISABLE_EMBEDDED_WEBHOOK_DISPATCHER,
  true,
);
const defaultAllowedOrigins = [
  'https://flyoverhead.com',
  'http://flyoverhead.com',
  'https://www.flyoverhead.com',
  'http://www.flyoverhead.com',
  'https://api.flyoverhead.com',
  'https://app.flyoverhead.com',
  `http://localhost:${process.env.PORT || 3005}`,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3005',
  'http://192.168.58.15:3000',
  'http://192.168.58.15:3005',
  'http://192.168.58.15',
];
const defaultAllowedIPs = ['192.168.58.15'];
const parseListEnv = (value: string | undefined): string[] => (value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const envAllowedOrigins = parseListEnv(process.env.CORS_ALLOWED_ORIGINS);
const envAllowedIPs = parseListEnv(process.env.CORS_ALLOWED_IPS);
const devKeyAllowedEmails = parseListEnv(process.env.DEV_KEY_ALLOWED_EMAILS);

/**
 * Centralized configuration management
 * All environment variables and config should live here
 */
const config: AppConfig = {
  server: {
    port: parseInt(process.env.PORT || '3005', 10),
    env: serverEnv,
    host: process.env.HOST || '0.0.0.0',
  },
  database: {
    postgres: {
      url: process.env.POSTGRES_URL || 'postgresql://example:example@localhost:5432/fly_overhead',
      pool: {
        min: poolMin,
        max: poolMax,
      },
    },
  },
  aws: {
    region: process.env.AWS_REGION || 'us-west-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  external: {
    opensky: {
      baseUrl: 'https://opensky-network.org/api',
      user: process.env.OPENSKY_USER,
      pass: process.env.OPENSKY_PASS,
    },
    airplanesLive: {
      baseUrl: process.env.AIRPLANES_LIVE_BASE_URL || 'https://api.airplanes.live/v2',
      maxRadiusNm: 250, // Maximum radius in nautical miles
      rateLimit: {
        requestsPerSecond: 1,
      },
    },
    n2yo: {
      baseUrl: 'https://api.n2yo.com/rest/v1',
      apiKey: process.env.N2YO_API_KEY,
    },
    flightAware: {
      baseUrl: 'https://aeroapi.flightaware.com/aeroapi',
      apiKey: process.env.FLIGHTAWARE_API_KEY,
    },
    aerodatabox: {
      baseUrl: process.env.AERODATABOX_BASE_URL || 'https://prod.api.market/api/v1/aedbx/aerodatabox',
      apiKey: process.env.AERODATABOX_API_KEY,
      dailyBudget: process.env.AERODATABOX_DAILY_BUDGET
        ? parseInt(process.env.AERODATABOX_DAILY_BUDGET, 10)
        : undefined,
    },
  },
  cors: {
    allowedOrigins: envAllowedOrigins.length > 0 ? envAllowedOrigins : defaultAllowedOrigins,
    allowedIPs: envAllowedIPs.length > 0 ? envAllowedIPs : defaultAllowedIPs,
  },
  aircraft: {
    updateInterval: 600000, // 10 minutes (600 seconds) - safer for OpenSky rate limits
    // OpenSky authenticated users get ~4000 credits/day
    // At 10 min intervals = 144 calls/day (well within limits)
    // Previous 2 min interval = 720 calls/day (too aggressive)
    staleRecordThreshold: 2 * 60 * 60 * 1000, // 2 hours
    recentContactThreshold: 30 * 60, // 30 minutes in seconds (increased to show more aircraft during rate limiting)
    devModeStaleThreshold: 24 * 60 * 60, // 24 hours in seconds - for development when rate limited
  },
  features: {
    backgroundJobsEnabled,
    conusPollingEnabled,
    backfillEnabled,
    metricsEnabled,
    prometheusExportEnabled,
  },
  queue: {
    enabled: queueEnabled,
    redisUrl,
    key: queueKey,
    dlqKey: queueDlqKey,
    delayedKey: queueDelayedKey,
    batchSize: queueBatchSize,
    pollIntervalMs: queuePollIntervalMs,
    spawnWorkerInProcess,
    maxAttempts: queueMaxAttempts,
    retryBackoffMs: queueRetryBackoffMs,
    retryJitterMs: queueRetryJitterMs,
    delayedPromotionBatchSize: queueDelayedPromotionBatchSize,
  },
  liveState: {
    enabled: liveStateEnabled,
    ttlSeconds: liveStateTtlSeconds,
    cleanupIntervalSeconds: liveStateCleanupSeconds,
    maxEntries: liveStateMaxEntries,
    minResultsBeforeDbFallback: liveStateMinResults,
  },
  cache: {
    aircraft: {
      enabled: aircraftCacheEnabled,
      redisUrl: aircraftCacheRedisUrl,
      prefix: aircraftCachePrefix,
      ttlSeconds: aircraftCacheTtlSeconds,
      warmerEnabled: aircraftCacheWarmerEnabled,
      warmIntervalSeconds: aircraftCacheWarmIntervalSeconds,
      warmLookbackMinutes: aircraftCacheWarmLookbackMinutes,
      warmBatchSize: aircraftCacheWarmBatchSize,
    },
  },
  webhooks: {
    enabled: webhooksEnabled,
    redisUrl,
    queueKey: webhookQueueKey,
    delayedKey: webhookDelayedKey,
    dlqKey: webhookDlqKey,
    batchSize: webhookBatchSize,
    pollIntervalMs: webhookPollIntervalMs,
    maxAttempts: webhookMaxAttempts,
    backoffMs: webhookBackoffMs,
    retryJitterMs: webhookRetryJitterMs,
    delayedPromotionBatchSize: webhookDelayedPromotionBatchSize,
    deliveryTimeoutMs: webhookTimeoutMs,
    signatureHeader: 'x-flyover-signature',
    timestampHeader: 'x-flyover-timestamp',
    spawnWorkerInProcess: spawnWebhookDispatcherInProcess,
    enforceHttps: enforceWebhookHttps,
    subscriberRateLimitPerMinute: webhookSubscriberRateLimitPerMinute,
    circuitBreaker: {
      failureThreshold: webhookCircuitBreakerFailureThreshold,
      resetSeconds: webhookCircuitBreakerResetSeconds,
    },
  },
  feeders: {
    circuitBreaker: {
      failureThreshold: Math.max(1, parseNumber(process.env.FEEDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 10)),
      resetSeconds: Math.max(30, parseNumber(process.env.FEEDER_CIRCUIT_BREAKER_RESET_SECONDS, 300)),
    },
    perSubscriberRateLimits: {
      statsPerHour: parseNumber(process.env.FEEDER_STATS_PER_HOUR, 60),
      lastSeenPerHour: parseNumber(process.env.FEEDER_LAST_SEEN_PER_HOUR, 120),
      infoPerHour: parseNumber(process.env.FEEDER_INFO_PER_HOUR, 100),
    },
  },
  auth: {
    devKeyAllowedEmails,
  },
};

export default config;
