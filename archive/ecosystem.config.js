/**
 * PM2 ecosystem configuration for AWS EC2 deployment
 * 
 * This config runs:
 * 1. Web server (API + static files)
 * 2. Worker process (data fetching, background jobs)
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup  # Setup PM2 to start on boot
 * 
 * Monitoring:
 *   pm2 list
 *   pm2 logs
 *   pm2 monit
 */
module.exports = {
  apps: [
    {
      name: 'fly-overhead-web',
      script: './server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENABLE_WORKER: 'false', // Worker runs in separate process
        PORT: 3005,
      },
      env_production: {
        NODE_ENV: 'production',
        ENABLE_WORKER: 'false',
        PORT: 3005,
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      // Restart if CPU > 80% for 5 minutes
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
    {
      name: 'fly-overhead-worker',
      script: './server/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3006, // Different port (not used, but good practice)
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G', // Worker may use more memory
      // Restart if CPU > 90% for 5 minutes (worker does heavy lifting)
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};

