const router = require('express').Router();
const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');

/**
 * POST /api/feeder/aircraft
 * Receive aircraft state data from feeders
 */
router.post('/feeder/aircraft', async (req, res, next) => {
  const { feeder_id, timestamp, states } = req.body;

  // Validate request body
  if (!feeder_id || !Array.isArray(states)) {
    return res.status(400).json({
      processed: 0,
      errors: [{ error: 'Invalid request: feeder_id and states array required' }],
    });
  }

  // Validate feeder exists
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
    logger.error('Error checking feeder', { feeder_id, error: error.message });
    return res.status(500).json({
      processed: 0,
      errors: [{ error: 'Internal server error' }],
    });
  }

  const errors = [];
  let processed = 0;
  const ingestionTimestamp = new Date();

  // Process each state
  for (const { state, feeder_id: stateFeederId } of states) {
    try {
      // Validate state array structure (19 items)
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

      // Validate required fields
      if (state[4] === null || state[4] === undefined) {
        errors.push({
          icao24,
          error: 'Missing required field: last_contact',
        });
        continue;
      }

      // Validate latitude/longitude if present
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

      // Validate altitude if present
      if (state[7] !== null && state[7] !== undefined) {
        if (state[7] < -1500 || state[7] > 60000) {
          errors.push({
            icao24,
            error: 'Invalid baro_altitude (must be between -1500 and 60000 meters)',
          });
          continue;
        }
      }

      // Validate velocity if present
      if (state[9] !== null && state[9] !== undefined) {
        if (state[9] < 0 || state[9] > 1500) {
          errors.push({
            icao24,
            error: 'Invalid velocity (must be between 0 and 1500 m/s)',
          });
          continue;
        }
      }

      // Validate category if present
      if (state[17] !== null && state[17] !== undefined) {
        if (state[17] < 0 || state[17] > 19) {
          errors.push({
            icao24,
            error: 'Invalid category (must be between 0 and 19)',
          });
          continue;
        }
      }

      // Use stateFeederId if provided, otherwise use feeder_id from request
      const finalFeederId = stateFeederId || feeder_id;

      // Parse created_at timestamp (index 18)
      let createdAt;
      if (state[18]) {
        createdAt = new Date(state[18]);
        if (isNaN(createdAt.getTime())) {
          createdAt = new Date();
        }
      } else {
        createdAt = new Date();
      }

      // Log callsign from feeder for debugging
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

      // Upsert aircraft state with priority
      // Feeder data has priority 10 (HIGHER priority than OpenSky's 30)
      // Local feeder data is more accurate and should not be overwritten
      await postgresRepository.upsertAircraftStateWithPriority(
        state,
        finalFeederId,
        ingestionTimestamp,
        'feeder', // data_source
        10, // source_priority (HIGHER priority than OpenSky - won't be overwritten)
      );

      processed++;
    } catch (error) {
      logger.error('Error processing aircraft state', {
        icao24: state?.[0] || 'unknown',
        error: error.message,
      });
      errors.push({
        icao24: state?.[0] || 'unknown',
        error: error.message,
      });
    }
  }

  // Update feeder last seen (non-critical, don't fail if this errors)
  postgresRepository.updateFeederLastSeen(feeder_id).catch((err) => {
    logger.warn('Failed to update feeder last seen', { feeder_id, error: err.message });
  });

  return res.status(200).json({
    processed,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * POST /api/feeder/register
 * Register a new feeder
 */
router.post('/feeder/register', async (req, res, next) => {
  const {
    feeder_id, api_key_hash, name, latitude, longitude, metadata,
  } = req.body;

  // Validate required fields
  if (!feeder_id || !api_key_hash) {
    return res.status(400).json({
      success: false,
      error: 'feeder_id and api_key_hash are required',
      details: {},
    });
  }

  try {
    // Check if feeder already exists
    const existing = await postgresRepository.getFeederById(feeder_id);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Feeder already exists',
        details: { feeder_id },
      });
    }

    // Register feeder
    const feeder = await postgresRepository.registerFeeder({
      feeder_id,
      api_key_hash,
      name,
      latitude,
      longitude,
      metadata,
    });

    logger.info('Feeder registered', { feeder_id, name });

    return res.status(200).json({
      success: true,
      feeder_id: feeder.feeder_id,
    });
  } catch (error) {
    logger.error('Error registering feeder', { feeder_id, error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: { message: error.message },
    });
  }
});

/**
 * POST /api/feeder/stats
 * Update feeder statistics
 */
router.post('/feeder/stats', async (req, res, next) => {
  const { feeder_id, messages_received, unique_aircraft } = req.body;

  // Validate required fields
  if (!feeder_id || messages_received === undefined || unique_aircraft === undefined) {
    return res.status(400).json({
      success: false,
      error: 'feeder_id, messages_received, and unique_aircraft are required',
    });
  }

  try {
    // Validate feeder exists
    const feeder = await postgresRepository.getFeederById(feeder_id);
    if (!feeder) {
      return res.status(400).json({
        success: false,
        error: 'Feeder not found',
      });
    }

    // Update stats
    await postgresRepository.upsertFeederStats(
      feeder_id,
      messages_received,
      unique_aircraft,
    );

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error('Error updating feeder stats', { feeder_id, error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PUT /api/feeder/last-seen
 * Update feeder last seen timestamp
 */
router.put('/feeder/last-seen', async (req, res, next) => {
  const { feeder_id } = req.body;

  if (!feeder_id) {
    return res.status(400).json({
      success: false,
      error: 'feeder_id is required',
    });
  }

  try {
    // Update last seen (non-critical operation)
    await postgresRepository.updateFeederLastSeen(feeder_id);

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.warn('Error updating feeder last seen', { feeder_id, error: error.message });
    // Don't fail the request for this non-critical operation
    return res.status(200).json({
      success: true,
    });
  }
});

/**
 * GET /api/feeder/me
 * Get feeder information (authenticated by API key)
 */
router.get('/feeder/me', async (req, res, next) => {
  try {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization header',
        message: 'Expected format: Authorization: Bearer <api_key>',
      });
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer " prefix

    // Validate API key format (should be sk_live_...)
    if (!apiKey || !apiKey.startsWith('sk_live_') || apiKey.length < 20) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key format',
      });
    }

    // Find feeder by API key
    const feeder = await postgresRepository.getFeederByApiKey(apiKey);

    if (!feeder) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    // Check feeder status
    if (feeder.status === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Feeder account suspended',
        message: 'Please contact support for assistance',
      });
    }

    if (feeder.status === 'inactive') {
      return res.status(403).json({
        success: false,
        error: 'Feeder account inactive',
      });
    }

    // Return feeder information
    return res.status(200).json({
      feeder_id: feeder.feeder_id,
      name: feeder.name || 'Unnamed Feeder',
      status: feeder.status,
      location: feeder.latitude && feeder.longitude ? {
        latitude: feeder.latitude,
        longitude: feeder.longitude,
      } : null,
      created_at: feeder.created_at,
      last_seen_at: feeder.last_seen_at || null,
    });
  } catch (error) {
    logger.error('Error getting feeder info', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;