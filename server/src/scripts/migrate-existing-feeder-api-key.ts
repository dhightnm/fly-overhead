/**
 * Migration script: Create API key entry for existing feeder
 * This handles feeders that were registered before the new API key system
 */

import { getConnection } from '../repositories/DatabaseConnection';
// bcrypt import removed - not used in this script (hashing done elsewhere)
import logger from '../utils/logger';
import { API_SCOPES } from '../config/scopes';

async function migrateFeederApiKey(feederId: string, plainApiKey: string): Promise<void> {
  const db = getConnection().getDb();

  try {
    // Get the feeder
    const feeder = await db.oneOrNone(
      'SELECT feeder_id, name, api_key_hash, metadata FROM feeders WHERE feeder_id = $1',
      [feederId],
    );

    if (!feeder) {
      throw new Error(`Feeder not found: ${feederId}`);
    }

    logger.info('Found feeder', { feeder_id: feederId, name: feeder.name });

    // Check if API key already exists
    const existingKey = await db.oneOrNone(
      'SELECT key_id FROM api_keys WHERE key_hash = $1',
      [feeder.api_key_hash],
    );

    if (existingKey) {
      logger.info('API key already exists in api_keys table', {
        feeder_id: feederId,
        key_id: existingKey.key_id,
      });
      return;
    }

    // Determine prefix from the plain API key
    let prefix = 'fd_';
    if (plainApiKey.startsWith('sk_live_')) {
      prefix = 'sk_live_';
    } else if (plainApiKey.startsWith('sk_dev_')) {
      prefix = 'sk_dev_';
    } else if (plainApiKey.startsWith('fd_')) {
      prefix = 'fd_';
    }

    // Extract user_id from metadata if available
    const userId = feeder.metadata?.user_id || null;

    // Create API key entry
    const apiKeyData = await db.one(
      `INSERT INTO api_keys(
        key_hash, key_prefix, name, description,
        user_id, scopes, created_by, expires_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING key_id, key_prefix, name, scopes, user_id`,
      [
        feeder.api_key_hash,
        prefix,
        `Feeder: ${feeder.name}`,
        `Migrated API key for existing feeder ${feederId}`,
        userId,
        [API_SCOPES.FEEDER_WRITE, API_SCOPES.FEEDER_READ, API_SCOPES.AIRCRAFT_WRITE],
        userId,
        null,
      ],
    );

    // Update feeder metadata to link to API key
    await db.none(
      `UPDATE feeders 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{api_key_id}',
         to_jsonb($1::text)
       )
       WHERE feeder_id = $2`,
      [apiKeyData.key_id, feederId],
    );

    logger.info('Successfully migrated feeder API key', {
      feeder_id: feederId,
      key_id: apiKeyData.key_id,
      key_prefix: apiKeyData.key_prefix,
      user_id: userId,
    });
    logger.info('✅ Migration successful', {
      feeder: feeder.name,
      api_key_id: apiKeyData.key_id,
      prefix: apiKeyData.key_prefix,
      scopes: apiKeyData.scopes,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Error migrating feeder API key', {
      feeder_id: feederId,
      error: err.message,
      stack: err.stack,
    });
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  const feederId = process.argv[2];
  const plainApiKey = process.argv[3];

  if (!feederId || !plainApiKey) {
    logger.error('Usage: ts-node migrate-existing-feeder-api-key.ts <feeder_id> <plain_api_key>');
    logger.error('Example: ts-node migrate-existing-feeder-api-key.ts feeder_123 sk_live_abc...');
    process.exit(1);
  }

  migrateFeederApiKey(feederId, plainApiKey)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed', { error: (error as Error).message });
      process.exit(1);
    });
}

export default migrateFeederApiKey;
