/**
 * Backward compatibility: Re-export TypeScript config
 * This allows old JS code to continue working during migration
 * Try compiled version first, fall back to source if not found
 */
try {
  // Try compiled TypeScript first (production/build)
  module.exports = require('../dist/config/index').default;
} catch (e) {
  // Fall back to source TypeScript (development with ts-node)
  module.exports = require('../src/config/index').default;
}
