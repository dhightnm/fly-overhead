/**
 * Configuration type definitions
 */

export interface ServerConfig {
  port: number;
  env: 'development' | 'production' | 'test';
  host: string;
}

export interface DatabaseConfig {
  postgres: {
    url: string;
    pool: {
      min: number;
      max: number;
    };
  };
}

export interface AwsConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface ExternalApiConfig {
  opensky: {
    baseUrl: string;
    user?: string;
    pass?: string;
  };
  airplanesLive: {
    baseUrl: string;
    maxRadiusNm: number;
    rateLimit: {
      requestsPerSecond: number;
    };
  };
  n2yo: {
    baseUrl: string;
    apiKey?: string;
  };
  flightAware: {
    baseUrl: string;
    apiKey?: string;
  };
  aerodatabox: {
    baseUrl: string;
    apiKey?: string;
    dailyBudget?: number;
  };
}

export interface CorsConfig {
  allowedOrigins: string[];
  allowedIPs: string[];
}

export interface AircraftConfig {
  updateInterval: number;
  staleRecordThreshold: number;
  recentContactThreshold: number;
  devModeStaleThreshold: number;
}

export interface QueueConfig {
  enabled: boolean;
  redisUrl: string;
  key: string;
  dlqKey: string;
  delayedKey: string;
  batchSize: number;
  pollIntervalMs: number;
  spawnWorkerInProcess: boolean;
  maxAttempts: number;
  retryBackoffMs: number;
  retryJitterMs: number;
  delayedPromotionBatchSize: number;
}

export interface LiveStateConfig {
  enabled: boolean;
  ttlSeconds: number;
  cleanupIntervalSeconds: number;
  maxEntries: number;
  minResultsBeforeDbFallback: number;
}

export interface AircraftCacheConfig {
  enabled: boolean;
  redisUrl: string;
  prefix: string;
  ttlSeconds: number;
  warmerEnabled: boolean;
  warmIntervalSeconds: number;
  warmLookbackMinutes: number;
  warmBatchSize: number;
}

export interface CacheConfig {
  aircraft: AircraftCacheConfig;
}

export interface WebhookConfig {
  enabled: boolean;
  redisUrl: string;
  queueKey: string;
  delayedKey: string;
  dlqKey: string;
  batchSize: number;
  pollIntervalMs: number;
  maxAttempts: number;
  backoffMs: number;
  retryJitterMs: number;
  delayedPromotionBatchSize: number;
  deliveryTimeoutMs: number;
  signatureHeader: string;
  timestampHeader: string;
  spawnWorkerInProcess: boolean;
  enforceHttps: boolean;
  subscriberRateLimitPerMinute: number;
  circuitBreaker: {
    failureThreshold: number;
    resetSeconds: number;
  };
}

export interface AuthConfig {
  devKeyAllowedEmails: string[];
}

export interface StripeConfig {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  apiVersion: string;
  successUrl: string;
  cancelUrl: string;
  prices: {
    flightTrackingPro?: string;
    efbBasic?: string;
    efbPro?: string;
    apiStarter?: string;
    apiProfessional?: string;
  };
}

export interface FeederConfig {
  circuitBreaker: {
    failureThreshold: number;
    resetSeconds: number;
  };
  perSubscriberRateLimits: {
    statsPerHour: number;
    lastSeenPerHour: number;
    infoPerHour: number;
  };
}

export interface FeatureFlagsConfig {
  backgroundJobsEnabled: boolean;
  conusPollingEnabled: boolean;
  backfillEnabled: boolean;
  metricsEnabled: boolean;
  prometheusExportEnabled: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  aws: AwsConfig;
  redisUrl: string;
  external: ExternalApiConfig;
  cors: CorsConfig;
  aircraft: AircraftConfig;
  features: FeatureFlagsConfig;
  queue: QueueConfig;
  liveState: LiveStateConfig;
  cache: CacheConfig;
  webhooks: WebhookConfig;
  feeders: FeederConfig;
  auth: AuthConfig;
  stripe: StripeConfig;
}
