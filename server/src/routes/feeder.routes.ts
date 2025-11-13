import { Router, Response, NextFunction } from 'express';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import { requireApiKeyAuth, optionalApiKeyAuth, type AuthenticatedRequest } from '../middlewares/apiKeyAuth';
import { optionalAuthenticateToken } from './auth.routes';
import { rateLimitMiddleware } from '../middlewares/rateLimitMiddleware';
import { requireScopes } from '../middlewares/permissionMiddleware';
import { API_SCOPES } from '../config/scopes';

const router = Router();

/**
 * POST /api/feeder/aircraft
 * Receive aircraft state data from feeders
 * Requires API key with feeder:write scope
 */
router.post(
  '/feeder/aircraft',
  requireApiKeyAuth,
  requireScopes(API_SCOPES.FEEDER_WRITE, API_SCOPES.AIRCRAFT_WRITE),
  rateLimitMiddleware,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { feeder_id, states } = req.body;

    if (!feeder_id || !Array.isArray(states)) {
      return res.status(400).json({
        processed: 0,
        errors: [{ error: 'Invalid request: feeder_id and states array required' }],
      });
    }

    let feeder;
    try {
      feeder = await postgresRepository.getFeederById(feeder_id);
      if (!feeder) {
        return res.status(400).json({
          processed: 0,
          errors: [{ error: `Feeder not found: ${feeder_id}` }],
        });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Error checking feeder', { feeder_id, error: err.message });
      return res.status(500).json({
        processed: 0,
        errors: [{ error: 'Internal server error' }],
      });
    }

    const errors: Array<{ icao24: string; error: string }> = [];
    let processed = 0;
    const ingestionTimestamp = new Date();

    for (const { state, feeder_id: stateFeederId } of states) {
      try {
        if (!Array.isArray(state) || state.length !== 19) {
          errors.push({
            icao24: state?.[0] || 'unknown',
            error: 'Invalid state array length (expected 19 items)',
          });
          continue;
        }

        const icao24 = state[0];
        if (!icao24 || typeof icao24 !== 'string' || icao24.length !== 6) {
          errors.push({
            icao24: icao24 || 'unknown',
            error: 'Invalid icao24 (must be 6-character hex string)',
          });
          continue;
        }

        if (state[4] === null || state[4] === undefined) {
          errors.push({
            icao24,
            error: 'Missing required field: last_contact',
          });
          continue;
        }

        if (state[6] !== null && state[6] !== undefined) {
          if (state[6] < -90 || state[6] > 90) {
            errors.push({
              icao24,
              error: 'Invalid latitude (must be between -90 and 90)',
            });
            continue;
          }
        }

        if (state[5] !== null && state[5] !== undefined) {
          if (state[5] < -180 || state[5] > 180) {
            errors.push({
              icao24,
              error: 'Invalid longitude (must be between -180 and 180)',
            });
            continue;
          }
        }

        if (state[7] !== null && state[7] !== undefined) {
          if (state[7] < -1500 || state[7] > 60000) {
            errors.push({
              icao24,
              error: 'Invalid baro_altitude (must be between -1500 and 60000 meters)',
            });
            continue;
          }
        }

        if (state[9] !== null && state[9] !== undefined) {
          if (state[9] < 0 || state[9] > 1500) {
            errors.push({
              icao24,
              error: 'Invalid velocity (must be between 0 and 1500 m/s)',
            });
            continue;
          }
        }

        if (state[17] !== null && state[17] !== undefined) {
          if (state[17] < 0 || state[17] > 19) {
            errors.push({
              icao24,
              error: 'Invalid category (must be between 0 and 19)',
            });
            continue;
          }
        }

        const finalFeederId = stateFeederId || feeder_id;

        let createdAt: Date;
        if (state[18]) {
          createdAt = new Date(state[18]);
          if (isNaN(createdAt.getTime())) {
            createdAt = new Date();
          }
        } else {
          createdAt = new Date();
        }

        if (processed % 10 === 0 || processed === 1 || !state[1]) {
          logger.debug('Processing aircraft state from feeder', {
            icao24,
            callsign: state[1] || null,
            hasCallsign: !!state[1],
            processed,
            last_contact: state[4] ? new Date(state[4] * 1000).toISOString() : null,
            feeder_id: finalFeederId,
          });
        }

        await postgresRepository.upsertAircraftStateWithPriority(
          state,
          finalFeederId,
          ingestionTimestamp,
          'feeder',
          10,
        );

        processed++;
      } catch (error) {
        const err = error as Error;
        logger.error('Error processing aircraft state', {
          icao24: state?.[0] || 'unknown',
          error: err.message,
        });
        errors.push({
          icao24: state?.[0] || 'unknown',
          error: err.message,
        });
      }
    }

    postgresRepository.updateFeederLastSeen(feeder_id).catch((err: Error) => {
      logger.warn('Failed to update feeder last seen', { feeder_id, error: err.message });
    });

    return res.status(200).json({
      processed,
      errors: errors.length > 0 ? errors : undefined,
    });
  },
);

/**
 * POST /api/feeder/register
 * Register a new feeder and automatically create an API key record with feeder scopes
 *
 * This endpoint accepts registration from the feeder service, which generates its own
 * API key and hash. We create the API key record in the api_keys table with proper
 * scopes so the feeder can authenticate and use the API.
 *
 * Supports two registration modes:
 * 1. Authenticated (with JWT): Links feeder to user account
 * 2. Unauthenticated: Creates standalone feeder (backward compatible)
 *
 * This endpoint is PUBLIC to allow new feeders to sign up
 * Rate limiting bypassed - feeder service already limits to 5/hour
 *
 * Expected payload (from feeder service):
 * - feeder_id: Unique identifier for the feeder
 * - api_key_hash: Pre-hashed API key from feeder service
 * - key_prefix: Optional prefix (e.g., 'fd_'), defaults to 'fd_' if not provided
 * - name: Feeder name
 * - latitude/longitude: Optional location
 * - metadata: Optional metadata object
 *
 * Headers (optional):
 * - Authorization: Bearer <jwt_token> - If provided, links feeder to user account
 */
router.post(
  '/feeder/register',
  optionalAuthenticateToken, // Optional: Extract user from JWT if present
  optionalApiKeyAuth, // Allow but don't require (for new feeder registration)
  // Note: Rate limiting bypassed for registration - feeder service already limits to 5/hour
  // This is a one-time operation and shouldn't be blocked by anonymous tier limits
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata } = req.body;

    if (!feeder_id || !api_key_hash || !name) {
      return res.status(400).json({
        success: false,
        error: 'feeder_id, api_key_hash, and name are required',
        details: {},
      });
    }

    try {
      // Check if feeder already exists
      const existing = await postgresRepository.getFeederById(feeder_id);
      if (existing) {
        // Check if feeder already has an API key entry
        const existingApiKeyId = existing.metadata?.api_key_id;
        if (existingApiKeyId) {
          // Check if API key still exists
          const apiKeyExists = await postgresRepository.getApiKeyById(existingApiKeyId);
          if (apiKeyExists) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists and has an API key',
              details: { feeder_id, api_key_id: existingApiKeyId },
            });
          }
        }
        // Feeder exists but no API key - we'll create one below
        logger.info('Feeder exists but missing API key entry, creating one', { feeder_id });
      }

      // Check if API key hash already exists (prevent duplicate keys)
      const existingKey = await postgresRepository.getApiKeyByHash(api_key_hash);
      if (existingKey) {
        return res.status(400).json({
          success: false,
          error: 'API key already exists',
          details: { key_id: existingKey.key_id },
        });
      }

      // Use provided prefix or default to feeder prefix (fd_)
      const prefix = key_prefix || 'fd_';

      // Extract user ID from JWT if authenticated (from optionalAuthenticateToken)
      // The optionalAuthenticateToken middleware adds req.user if JWT is valid
      const authenticatedUser = (req as any).user as { userId: number; email: string } | undefined;
      const userId = authenticatedUser?.userId || null;
      const createdBy = authenticatedUser?.userId || null;

      // Create the API key record in the api_keys table with feeder scopes
      // Link to user account if JWT token was provided
      const apiKeyData = await postgresRepository.createApiKey({
        keyHash: api_key_hash,
        prefix,
        name: `Feeder: ${name}`,
        description: userId
          ? `Auto-generated API key for feeder ${feeder_id} (linked to user account)`
          : `Auto-generated API key for feeder ${feeder_id}`,
        userId, // Link to user if authenticated, null otherwise
        scopes: [API_SCOPES.FEEDER_WRITE, API_SCOPES.FEEDER_READ, API_SCOPES.AIRCRAFT_WRITE],
        createdBy, // Track who created the key
        expiresAt: null, // No expiration for feeder keys
      });

      // Register or update the feeder in the feeders table
      let feeder;
      if (existing) {
        // Update existing feeder
        await postgresRepository.getDb().none(
          `UPDATE feeders 
           SET name = COALESCE($1, name),
               api_key_hash = COALESCE($2, api_key_hash),
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{api_key_id}',
                 to_jsonb($3::text)
               )
           WHERE feeder_id = $4`,
          [name, api_key_hash, apiKeyData.key_id, feeder_id]
        );
        feeder = existing;
        feeder.metadata = {
          ...(feeder.metadata || {}),
          api_key_id: apiKeyData.key_id,
          user_id: userId,
        };
      } else {
        // Register new feeder
        feeder = await postgresRepository.registerFeeder({
          feeder_id,
          api_key_hash, // Store the hash for backward compatibility
          name,
          latitude,
          longitude,
          metadata: {
            ...metadata,
            api_key_id: apiKeyData.key_id, // Link to the API key record
            user_id: userId, // Store user ID in metadata for easy lookup
          },
        });
      }

      // If feeder is linked to a user, mark user as feeder provider
      if (userId) {
        try {
          await postgresRepository.updateUserFeederProviderStatus(userId, true);
          logger.info('User marked as feeder provider', { user_id: userId });
        } catch (error) {
          const err = error as Error;
          // Non-critical error - log but don't fail registration
          logger.warn('Failed to update user feeder provider status', {
            user_id: userId,
            error: err.message,
          });
        }
      }

      logger.info('Feeder registered with API key record created', {
        feeder_id,
        name,
        api_key_id: apiKeyData.key_id,
        user_id: userId,
        scopes: apiKeyData.scopes,
        linked_to_user: !!userId,
      });

      // Return success - the feeder service will return the actual API key to the user
      return res.status(201).json({
        success: true,
        feeder_id: feeder.feeder_id,
        api_key_id: apiKeyData.key_id,
        scopes: apiKeyData.scopes,
        user_id: userId,
        linked_to_user: !!userId,
        message: userId
          ? 'Feeder registered successfully and linked to your account. API key record created with feeder scopes.'
          : 'Feeder registered successfully. API key record created with feeder scopes.',
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Error registering feeder', {
        feeder_id,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: { message: err.message },
      });
    }
  },
);

/**
 * POST /api/feeder/stats
 * Update feeder statistics
 * Requires API key with feeder:write scope
 */
router.post(
  '/feeder/stats',
  requireApiKeyAuth,
  requireScopes(API_SCOPES.FEEDER_WRITE),
  rateLimitMiddleware,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { feeder_id, messages_received, unique_aircraft } = req.body;

    if (!feeder_id || messages_received === undefined || unique_aircraft === undefined) {
      return res.status(400).json({
        success: false,
        error: 'feeder_id, messages_received, and unique_aircraft are required',
      });
    }

    try {
      const feeder = await postgresRepository.getFeederById(feeder_id);
      if (!feeder) {
        return res.status(400).json({
          success: false,
          error: 'Feeder not found',
        });
      }

      await postgresRepository.upsertFeederStats(feeder_id, messages_received, unique_aircraft);

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Error updating feeder stats', { feeder_id, error: err.message });
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

/**
 * PUT /api/feeder/last-seen
 * Update feeder last seen timestamp
 * Requires API key with feeder:write scope
 */
router.put(
  '/feeder/last-seen',
  requireApiKeyAuth,
  requireScopes(API_SCOPES.FEEDER_WRITE),
  rateLimitMiddleware,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { feeder_id } = req.body;

    if (!feeder_id) {
      return res.status(400).json({
        success: false,
        error: 'feeder_id is required',
      });
    }

    try {
      await postgresRepository.updateFeederLastSeen(feeder_id);

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      const err = error as Error;
      logger.warn('Error updating feeder last seen', { feeder_id, error: err.message });
      return res.status(200).json({
        success: true,
      });
    }
  },
);

/**
 * GET /api/feeder/me
 * Get feeder information (authenticated by API key)
 * Requires API key with feeder:read scope
 */
router.get(
  '/feeder/me',
  requireApiKeyAuth,
  requireScopes(API_SCOPES.FEEDER_READ),
  rateLimitMiddleware,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      // Get feeder by API key hash (works for both user-linked and standalone feeders)
      const apiKeyHash = req.apiKey?.keyHash;
      if (!apiKeyHash) {
        return res.status(400).json({
          success: false,
          error: 'API key hash not found',
        });
      }

      // Look up feeder by API key hash
      const feeder = await postgresRepository.getFeederByApiKey(
        req.headers.authorization?.replace('Bearer ', '') || '',
      );

      if (!feeder) {
        // If not found by hash, try to find by metadata link
        const userId = req.apiKey?.userId;
        if (userId) {
          // Try to find feeder linked to this user
          const feeders = await postgresRepository.getDb().any(
            `SELECT * FROM feeders WHERE metadata->>'user_id' = $1`,
            [userId.toString()],
          );
          if (feeders.length > 0) {
            return res.status(200).json({
              success: true,
              feeder_id: feeders[0].feeder_id,
              name: feeders[0].name,
              status: feeders[0].status,
              apiKey: {
                id: req.apiKey?.keyId,
                name: req.apiKey?.name,
                type: req.apiKey?.type,
                scopes: req.apiKey?.scopes,
              },
              message: 'Feeder authentication successful',
            });
          }
        }

        // Fallback: return API key info even if feeder not found
        return res.status(200).json({
          success: true,
          apiKey: {
            id: req.apiKey?.keyId,
            name: req.apiKey?.name,
            type: req.apiKey?.type,
            scopes: req.apiKey?.scopes,
          },
          message: 'Feeder authentication successful (API key valid)',
        });
      }

      // Return feeder info
      return res.status(200).json({
        success: true,
        feeder_id: feeder.feeder_id,
        name: feeder.name,
        status: feeder.status,
        apiKey: {
          id: req.apiKey?.keyId,
          name: req.apiKey?.name,
          type: req.apiKey?.type,
          scopes: req.apiKey?.scopes,
        },
        message: 'Feeder authentication successful',
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Error getting feeder info', { error: err.message });
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  },
);

export default router;
