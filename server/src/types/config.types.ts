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
  batchSize: number;
  pollIntervalMs: number;
  spawnWorkerInProcess: boolean;
}

export interface FeatureFlagsConfig {
  backgroundJobsEnabled: boolean;
  conusPollingEnabled: boolean;
  backfillEnabled: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  aws: AwsConfig;
  external: ExternalApiConfig;
  cors: CorsConfig;
  aircraft: AircraftConfig;
  features: FeatureFlagsConfig;
  queue: QueueConfig;
}
