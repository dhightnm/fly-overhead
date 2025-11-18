#!/usr/bin/env node

/**
 * Migration script to add is_feeder_provider column to users table
 *
 * Usage: npm run migrate:feeder-provider
 * or: ts-node src/scripts/migrate-feeder-provider.ts
 */

import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

async function runMigration(): Promise<void> {
  try {
    logger.info('Starting feeder provider column migration...');

    await postgresRepository.addFeederProviderColumnToUsers();

    logger.info('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    logger.error('❌ Migration failed', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

// Run migration
runMigration();
