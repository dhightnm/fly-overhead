/**
 * PM2 ecosystem configuration for LOCAL testing (Docker-compatible)
 * 
 * This config uses different ports to avoid conflicts with Docker containers
 * 
 * Usage:
 *   pm2 start ecosystem.config.local.js
 * 
 * NOTE: Docker containers should be stopped or use different ports
 */
module.exports = {
  apps: [
    {
      name: 'fly-overhead-web-local',
      script: './server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        ENABLE_WORKER: 'false', // Worker runs in separate process
        PORT: 3006, // Different port to avoid Docker conflict (Docker uses 3005)
        HOST: '0.0.0.0',
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
    },
    {
      name: 'fly-overhead-worker-local',
      script: './server/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3007, // Not used, but different for clarity
        // Use same POSTGRES_URL as Docker (or local Postgres)
        POSTGRES_URL: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5433/fly_overhead',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',
    },
  ],
};

