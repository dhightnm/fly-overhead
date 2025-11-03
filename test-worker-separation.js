/**
 * Simple script to test worker separation without PM2
 * Run this to verify worker.js works independently
 * 
 * Usage:
 *   node test-worker-separation.js
 * 
 * This starts the worker process directly - good for testing
 */

const { startWorker } = require('./server/worker');

console.log('Starting worker process for testing...');
console.log('Press Ctrl+C to stop');

startWorker().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});

