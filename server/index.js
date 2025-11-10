/**
 * Backward compatibility entry point
 * Re-exports the TypeScript compiled version
 * After migration is complete, this can be removed and package.json main can point directly to dist/index.js
 */
require('dotenv').config();

// In production, use compiled TypeScript
// In development, can use ts-node if needed
if (process.env.NODE_ENV === 'production' || process.env.USE_COMPILED === 'true') {
  // Use compiled JavaScript
  module.exports = require('./dist/index');
} else {
  // For development, can use ts-node-dev directly
  // This file is mainly for backward compatibility
  console.warn('Warning: Using index.js entry point. Consider using "npm run dev" for TypeScript development.');
  console.warn('Or set USE_COMPILED=true to use compiled version.');
  
  // Try to use compiled version if it exists, otherwise fall back to ts-node
  try {
    require.resolve('./dist/index.js');
    module.exports = require('./dist/index');
  } catch (e) {
    console.error('Compiled TypeScript not found. Please run "npm run build" first.');
    console.error('Or use "npm run dev" for development with ts-node-dev.');
    process.exit(1);
  }
}
