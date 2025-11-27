import { Router, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import {
  requireApiKeyAuth,
  optionalApiKeyAuth,
  extractApiKey,
  type AuthenticatedRequest,
} from '../middlewares/apiKeyAuth';
import { optionalAuthenticateToken } from './auth.routes';
import { requireScopes } from '../middlewares/permissionMiddleware';
import { API_SCOPES } from '../config/scopes';
import {
  feederAircraftBatchSchema,
  feederLastSeenSchema,
  feederRegisterSchema,
  feederStatsSchema,
} from '../schemas/feeder.schemas';
import { STATE_INDEX, validateAircraftState } from '../utils/aircraftState';
import { validateApiKeyFormat } from '../utils/apiKeyGenerator';

type InvalidState = Extract<ReturnType<typeof validateAircraftState>, { valid: false }>;

const router = Router();
const LEGACY_FEEDER_WARNING_INTERVAL_MS = 60 * 1000;
const legacyFeederWarningCache = new Map<string, number>();

const ensureFeederWriteAccess = (allowLegacyFallback = false) => (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const scopes = req.apiKey?.scopes || req.auth?.scopes || [];
  if (scopes.includes(API_SCOPES.FEEDER_WRITE) || scopes.includes(API_SCOPES.AIRCRAFT_WRITE)) {
    return next();
  }

  if (allowLegacyFallback && req.body?.feeder_id) {
    const feederId = req.body.feeder_id as string;
    const now = Date.now();
    const lastWarnedAt = legacyFeederWarningCache.get(feederId) || 0;
    if (now - lastWarnedAt >= LEGACY_FEEDER_WARNING_INTERVAL_MS) {
      logger.warn('Legacy feeder stats endpoint accessed without API key', {
        feeder_id: feederId,
        path: req.path,
      });
      legacyFeederWarningCache.set(feederId, now);
    }
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Feeder API key with feeder:write scope required',
  });
};

const maybeAuthenticateFeederRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const apiKey = extractApiKey(req);
  if (apiKey && validateApiKeyFormat(apiKey)) {
    await optionalApiKeyAuth(req, res, next);
    return;
  }

  if (apiKey) {
    logger.warn('Ignoring feeder auth header with unexpected format', {
      path: req.path,
    });
  }

  req.apiKey = undefined;
  req.auth = req.auth || {
    authenticated: false,
    type: 'anonymous',
    scopes: [],
  };
  next();
};

const formatZodErrors = (error: ZodError) => error.issues.map((issue) => ({
  icao24: 'unknown',
  error: `${issue.path.join('.') || 'body'}: ${issue.message}`,
}));

/**
 * POST /api/feeder/aircraft
 * Receive aircraft state data from feeders
 * Requires API key with feeder:write scope
 */
router.post(
  '/feeder/aircraft',
  requireApiKeyAuth,
  requireScopes(API_SCOPES.FEEDER_WRITE, API_SCOPES.AIRCRAFT_WRITE),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsedBody = feederAircraftBatchSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        processed: 0,
        errors: formatZodErrors(parsedBody.error),
      });
    }

    const { feeder_id: bodyFeederId, states } = parsedBody.data;

    let feeder;
    try {
      feeder = await postgresRepository.getFeederById(bodyFeederId);
      if (!feeder) {
        return res.status(400).json({
          processed: 0,
          errors: [{ error: `Feeder not found: ${bodyFeederId}` }],
        });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Error checking feeder', { feeder_id: bodyFeederId, error: err.message });
      return res.status(500).json({
        processed: 0,
        errors: [{ error: 'Internal server error' }],
      });
    }

    const errors: Array<{ icao24: string; error: string }> = [];
    let processed = 0;
    const ingestionTimestamp = new Date();

    // Validate all states first and collect valid ones for batch processing
    const validStates: Array<{
      state: any[];
      feeder_id: string | null;
      icao24: string;
    }> = [];

    for (const entry of states) {
      const { state: rawState, feeder_id: stateFeederId } = entry;
      try {
        const validation = validateAircraftState(rawState);
        if (!validation.valid) {
          const fallbackIcao = Array.isArray(rawState) ? rawState[STATE_INDEX.ICAO24] : 'unknown';
          const { error } = validation as InvalidState;
          errors.push({
            icao24: fallbackIcao || 'unknown',
            error,
          });
          continue;
        }

        const normalizedState = validation.state;
        const icao24 = normalizedState[STATE_INDEX.ICAO24];
        const finalFeederId = stateFeederId || bodyFeederId;
        validStates.push({ state: normalizedState, feeder_id: finalFeederId, icao24 });
      } catch (error) {
        const err = error as Error;
        logger.error('Error validating aircraft state', {
          icao24: Array.isArray(rawState) ? rawState[STATE_INDEX.ICAO24] : 'unknown',
          error: err.message,
        });
        const fallbackIcao = Array.isArray(rawState) ? rawState[STATE_INDEX.ICAO24] : 'unknown';
        errors.push({
          icao24: fallbackIcao || 'unknown',
          error: err.message,
        });
      }
    }

    // Process valid states in batches to reduce connection pool usage
    // Batch size of 10 allows parallel processing while keeping connection usage reasonable
    const BATCH_SIZE = 10;
    for (let i = 0; i < validStates.length; i += BATCH_SIZE) {
      const batch = validStates.slice(i, i + BATCH_SIZE);

      // Log progress for first item in batch or every 10th batch
      if (i === 0 || i % (BATCH_SIZE * 10) === 0) {
        logger.debug('Processing aircraft batch from feeder', {
          batchStart: i,
          batchSize: batch.length,
          totalValid: validStates.length,
          processed,
        });
      }

      // Process batch in parallel - each upsert uses a connection from the pool
      // Using Promise.allSettled to ensure all items in batch are attempted even if some fail
      const batchResults = await Promise.allSettled(
        batch.map(async ({ state, feeder_id: finalFeederId, icao24 }) => {
          try {
            await postgresRepository.upsertAircraftStateWithPriority(
              state,
              finalFeederId,
              ingestionTimestamp,
              'feeder',
              10,
            );
            return { icao24, success: true };
          } catch (error) {
            const err = error as Error;
            logger.error('Error processing aircraft state in batch', {
              icao24,
              error: err.message,
            });
            const batchError = new Error(err.message);
            (batchError as any).icao24 = icao24;
            throw batchError;
          }
        }),
      );

      // Collect errors from batch
      const batchProcessed = batchResults.filter((result) => result.status === 'fulfilled').length;
      processed += batchProcessed;

      batchResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const rejection = result.reason as Error & { icao24?: string };
          errors.push({
            icao24: rejection.icao24 || batch[index]?.icao24 || 'unknown',
            error: rejection.message || 'Unknown error',
          });
        }
      });
    }

    postgresRepository.updateFeederLastSeen(bodyFeederId).catch((err: Error) => {
      logger.warn('Failed to update feeder last seen', { feeder_id: bodyFeederId, error: err.message });
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
  async (req: AuthenticatedRequest, res: Response) => {
    const parsedBody = feederRegisterSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid feeder registration payload',
        details: parsedBody.error.format(),
      });
    }

    const {
      feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata,
    } = parsedBody.data;

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
          [name, api_key_hash, apiKeyData.key_id, feeder_id],
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
  maybeAuthenticateFeederRequest,
  ensureFeederWriteAccess(true),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsedBody = feederStatsSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stats payload',
        details: parsedBody.error.format(),
      });
    }

    const { feeder_id, messages_received, unique_aircraft } = parsedBody.data;

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
  maybeAuthenticateFeederRequest,
  ensureFeederWriteAccess(true),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsedBody = feederLastSeenSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payload',
        details: parsedBody.error.format(),
      });
    }
    const { feeder_id } = parsedBody.data;

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
  async (req: AuthenticatedRequest, res: Response) => {
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
          const feeders = await postgresRepository
            .getDb()
            .any('SELECT * FROM feeders WHERE metadata->>\'user_id\' = $1', [userId.toString()]);
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
