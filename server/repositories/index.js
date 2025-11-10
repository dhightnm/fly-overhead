/**
 * Backward compatibility: Re-export TypeScript repository facade
 * This allows old JS code to continue working during migration
 * Try compiled version first, fall back to source if not found
 */
try {
  // Try compiled TypeScript first (production/build)
  const tsModule = require('../dist/repositories/index');
  // Export the default export (singleton instance) directly
  module.exports = tsModule.default || tsModule;
} catch (e) {
  // Fall back to source TypeScript (development with ts-node)
  const tsModule = require('../src/repositories/index');
  module.exports = tsModule.default || tsModule;
}
