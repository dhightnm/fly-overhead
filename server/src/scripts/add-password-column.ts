#!/usr/bin/env node

/**
 * Migration script to add password column to users table
 *
 * Usage: npm run migrate:password
 * or: ts-node src/scripts/add-password-column.ts
 */

import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

async function runMigration(): Promise<void> {
  try {
    logger.info('Starting password column migration...');

    await postgresRepository.addPasswordColumnToUsers();

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

