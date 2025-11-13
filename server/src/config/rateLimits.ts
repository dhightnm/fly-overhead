/**
 * Rate Limit Configuration
 * Defines rate limits for different API key tiers
 */

export interface RateLimitTier {
  name: string;
  hourlyLimit: number;
  dailyLimit: number;
  burstLimit: number; // requests per 10 seconds
  concurrentLimit: number;
  bypassRateLimit: boolean;
}

/**
 * Rate limit tiers based on API key type and scopes
 */
export const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  // Development keys - bypass all rate limits for testing
  development: {
    name: 'Development',
    hourlyLimit: Infinity,
    dailyLimit: Infinity,
    burstLimit: Infinity,
    concurrentLimit: Infinity,
    bypassRateLimit: true,
  },

  // Admin/Internal keys - very high limits for internal services
  admin: {
    name: 'Admin/Internal',
    hourlyLimit: 100000,
    dailyLimit: 1000000,
    burstLimit: 1000,
    concurrentLimit: 100,
    bypassRateLimit: false,
  },

  // Feeder keys - higher limits for data providers (ADS-B feeders)
  feeder: {
    name: 'Feeder',
    hourlyLimit: 10000,
    dailyLimit: 200000,
    burstLimit: 200,
    concurrentLimit: 50,
    bypassRateLimit: false,
  },

  // Production keys - standard limits for authenticated users
  production: {
    name: 'Production',
    hourlyLimit: 1000,
    dailyLimit: 20000,
    burstLimit: 20,
    concurrentLimit: 10,
    bypassRateLimit: false,
  },

  // Restricted keys - low limits for public/trial users
  restricted: {
    name: 'Restricted',
    hourlyLimit: 100,
    dailyLimit: 500,
    burstLimit: 5,
    concurrentLimit: 3,
    bypassRateLimit: false,
  },

  // Web app (same-origin requests from React app) - NO rate limits for seamless UX
  webapp: {
    name: 'Web App',
    hourlyLimit: Infinity,
    dailyLimit: Infinity,
    burstLimit: Infinity,
    concurrentLimit: Infinity,
    bypassRateLimit: true, // Bypass rate limiting entirely for webapp
  },

  // Anonymous (no API key, external requests) - very limited access
  anonymous: {
    name: 'Anonymous',
    hourlyLimit: 50,
    dailyLimit: 200,
    burstLimit: 3,
    concurrentLimit: 2,
    bypassRateLimit: false,
  },
};

/**
 * Get rate limit tier for a given API key type and scopes
 */
export function getRateLimitTier(keyType?: string, scopes?: string[]): RateLimitTier {
  // Development keys always bypass
  if (keyType === 'development') {
    return RATE_LIMIT_TIERS.development;
  }

  // Feeder keys get special high limits (data providers)
  if (keyType === 'feeder') {
    return RATE_LIMIT_TIERS.feeder;
  }

  // Check if key has admin scope
  if (scopes && (scopes.includes('admin:*') || scopes.includes('internal:all'))) {
    return RATE_LIMIT_TIERS.admin;
  }

  // Production keys
  if (keyType === 'production') {
    return RATE_LIMIT_TIERS.production;
  }

  // Web app (same-origin requests)
  if (keyType === 'webapp') {
    return RATE_LIMIT_TIERS.webapp;
  }

  // Restricted keys
  if (keyType === 'restricted') {
    return RATE_LIMIT_TIERS.restricted;
  }

  // Default to anonymous
  return RATE_LIMIT_TIERS.anonymous;
}

/**
 * Rate limit window configurations
 */
export const RATE_LIMIT_WINDOWS = {
  BURST: 10, // seconds
  HOURLY: 3600, // seconds
  DAILY: 86400, // seconds
};

/**
 * Rate limit response headers
 */
export const RATE_LIMIT_HEADERS = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset',
  RETRY_AFTER: 'Retry-After',
};
