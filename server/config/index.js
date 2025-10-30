require('dotenv').config();

/**
 * Centralized configuration management
 * All environment variables and config should live here
 */
module.exports = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3005,
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0',
  },
  database: {
    postgres: {
      url: process.env.POSTGRES_URL || 'postgresql://example:example@localhost:5432/fly_overhead',
      pool: {
        min: 2,
        max: 10,
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
      apiKey: process.env.N2YO_API_KEY || 'M3FTYY-Q2CLZF-U76MTW-553N',
    },
    aviationEdge: {
      // Note: Using AviationStack API (different from Aviation Edge)
      // The /routes endpoint requires higher subscription - using /flights instead
      baseUrl: 'https://api.aviationstack.com/v1',
      apiKey: process.env.AVIATION_EDGE_API_KEY || process.env.AVIATION_STACK_API_KEY,
    },
    flightAware: {
      baseUrl: 'https://aeroapi.flightaware.com/aeroapi',
      apiKey: process.env.FLIGHTAWARE_API_KEY,
    },
  },
  cors: {
    allowedOrigins: [
      'http://flyoverhead.com',
      'https://flyoverhead.com',
      'http://www.flyoverhead.com',
      'https://www.flyoverhead.com',
      `http://localhost:${process.env.PORT || 3005}`,
    ],
  },
  aircraft: {
    updateInterval: 120000, // 2 minutes
    staleRecordThreshold: 2 * 60 * 60 * 1000, // 2 hours
    recentContactThreshold: 10 * 60, // 10 minutes in seconds
  },
};
