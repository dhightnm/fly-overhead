import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { AppConfig } from '../types/config.types';

const rootEnvPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

dotenv.config();

/**
 * Centralized configuration management
 * All environment variables and config should live here
 */
const config: AppConfig = {
  server: {
    port: parseInt(process.env.PORT || '3005', 10),
    env: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
    host: process.env.HOST || '0.0.0.0',
  },
  database: {
    postgres: {
      url: process.env.POSTGRES_URL || 'postgresql://example:example@localhost:5432/fly_overhead',
      pool: {
        min: 2,
        max: 15, // Increased from 10 to handle multiple concurrent webapp users
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
      dailyBudget: process.env.AERODATABOX_DAILY_BUDGET ? parseInt(process.env.AERODATABOX_DAILY_BUDGET, 10) : undefined,
    },
  },
  cors: {
    allowedOrigins: [
      'http://flyoverhead.com',
      'https://flyoverhead.com',
      'http://www.flyoverhead.com',
      'https://www.flyoverhead.com',
      `http://localhost:${process.env.PORT || 3005}`,
      `http://192.168.58.15:${process.env.PORT || 3005}`,
      'http://192.168.58.15:3000',
      'http://192.168.58.15:3005',
      'http://192.168.58.15',
    ],
    allowedIPs: ['192.168.58.15'],
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
};

export default config;

