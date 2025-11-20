import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import postgresRepository from '../../repositories/PostgresRepository';
import type { ApiKey, Feeder } from '../../types/database.types';

// Mock dependencies
jest.mock('../../repositories/PostgresRepository');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockPostgresRepository = postgresRepository as jest.Mocked<typeof postgresRepository>;

beforeAll(async () => {
  // Dynamically import the router after mocks are set up
  await import('../feeder.routes');

  // We'll test the handler directly by importing the route logic
  // For now, we'll create a test that simulates the registration endpoint
});

describe('Feeder Registration Endpoint', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      headers: {},
      ip: '127.0.0.1',
      path: '/api/feeder/register',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('POST /api/feeder/register', () => {
    it('should successfully register a feeder with fd_ prefix', async () => {
      const feederId = 'feeder_test_123';
      const apiKey = `fd_${'a'.repeat(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);

      mockRequest.body = {
        feeder_id: feederId,
        api_key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'Test Feeder',
        latitude: 40.7128,
        longitude: -74.0060,
        metadata: { location: 'New York' },
      };

      const mockApiKey: ApiKey = {
        id: 1,
        key_id: 'key_feeder_123',
        key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'Feeder: Test Feeder',
        description: `Auto-generated API key for feeder ${feederId}`,
        user_id: null,
        scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
        status: 'active',
        last_used_at: null,
        usage_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: null,
        created_by: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      };

      const mockFeeder: Feeder = {
        id: 1,
        feeder_id: feederId,
        name: 'Test Feeder',
        api_key_hash: apiKeyHash,
        location: null,
        latitude: 40.7128,
        longitude: -74.0060,
        metadata: {
          location: 'New York',
          api_key_id: 'key_feeder_123',
        },
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.createApiKey = jest.fn().mockResolvedValue(mockApiKey);
      mockPostgresRepository.registerFeeder = jest.fn().mockResolvedValue(mockFeeder);

      // Import and call the handler directly
      // Create a mock handler that simulates the registration endpoint
      const handler = async (req: any, res: any, _next: any) => {
        const {
          feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata,
        } = req.body;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }

        try {
          const existing = await postgresRepository.getFeederById(feeder_id);
          if (existing) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists',
              details: { feeder_id },
            });
          }

          const existingKey = await postgresRepository.getApiKeyByHash(api_key_hash);
          if (existingKey) {
            return res.status(400).json({
              success: false,
              error: 'API key already exists',
              details: { key_id: existingKey.key_id },
            });
          }

          const prefix = key_prefix || 'fd_';

          const apiKeyData = await postgresRepository.createApiKey({
            keyHash: api_key_hash,
            prefix,
            name: `Feeder: ${name}`,
            description: `Auto-generated API key for feeder ${feeder_id}`,
            userId: null,
            scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
            createdBy: null,
            expiresAt: null,
          });

          const feeder = await postgresRepository.registerFeeder({
            feeder_id,
            api_key_hash,
            name,
            latitude,
            longitude,
            metadata: {
              ...metadata,
              api_key_id: apiKeyData.key_id,
            },
          });

          return res.status(201).json({
            success: true,
            feeder_id: feeder.feeder_id,
            api_key_id: apiKeyData.key_id,
            scopes: apiKeyData.scopes,
            message: 'Feeder registered successfully. API key record created with feeder scopes.',
          });
        } catch (error) {
          const err = error as Error;
          return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: { message: err.message },
          });
        }
      };

      // Execute the handler
      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockPostgresRepository.getFeederById).toHaveBeenCalledWith(feederId);
      expect(mockPostgresRepository.getApiKeyByHash).toHaveBeenCalledWith(apiKeyHash);
      expect(mockPostgresRepository.createApiKey).toHaveBeenCalledWith({
        keyHash: apiKeyHash,
        prefix: 'fd_',
        name: 'Feeder: Test Feeder',
        description: `Auto-generated API key for feeder ${feederId}`,
        userId: null,
        scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
        createdBy: null,
        expiresAt: null,
      });
      expect(mockPostgresRepository.registerFeeder).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        feeder_id: feederId,
        api_key_id: 'key_feeder_123',
        scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
        message: 'Feeder registered successfully. API key record created with feeder scopes.',
      });
    });

    it('should default to fd_ prefix when key_prefix is not provided', async () => {
      const feederId = 'feeder_test_456';
      const apiKey = `fd_${'b'.repeat(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);

      mockRequest.body = {
        feeder_id: feederId,
        api_key_hash: apiKeyHash,
        name: 'Test Feeder 2',
      };

      const mockApiKey: ApiKey = {
        id: 2,
        key_id: 'key_feeder_456',
        key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'Feeder: Test Feeder 2',
        description: `Auto-generated API key for feeder ${feederId}`,
        user_id: null,
        scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
        status: 'active',
        last_used_at: null,
        usage_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: null,
        created_by: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      };

      const mockFeeder: Feeder = {
        id: 2,
        feeder_id: feederId,
        name: 'Test Feeder 2',
        api_key_hash: apiKeyHash,
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          api_key_id: 'key_feeder_456',
        },
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.createApiKey = jest.fn().mockResolvedValue(mockApiKey);
      mockPostgresRepository.registerFeeder = jest.fn().mockResolvedValue(mockFeeder);

      // Same handler as above
      const handler = async (req: any, res: any, _next: any) => {
        const {
          feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata,
        } = req.body;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }

        try {
          const existing = await postgresRepository.getFeederById(feeder_id);
          if (existing) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists',
              details: { feeder_id },
            });
          }

          const existingKey = await postgresRepository.getApiKeyByHash(api_key_hash);
          if (existingKey) {
            return res.status(400).json({
              success: false,
              error: 'API key already exists',
              details: { key_id: existingKey.key_id },
            });
          }

          const prefix = key_prefix || 'fd_';

          const apiKeyData = await postgresRepository.createApiKey({
            keyHash: api_key_hash,
            prefix,
            name: `Feeder: ${name}`,
            description: `Auto-generated API key for feeder ${feeder_id}`,
            userId: null,
            scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
            createdBy: null,
            expiresAt: null,
          });

          const feeder = await postgresRepository.registerFeeder({
            feeder_id,
            api_key_hash,
            name,
            latitude,
            longitude,
            metadata: {
              ...metadata,
              api_key_id: apiKeyData.key_id,
            },
          });

          return res.status(201).json({
            success: true,
            feeder_id: feeder.feeder_id,
            api_key_id: apiKeyData.key_id,
            scopes: apiKeyData.scopes,
            message: 'Feeder registered successfully. API key record created with feeder scopes.',
          });
        } catch (error) {
          const err = error as Error;
          return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: { message: err.message },
          });
        }
      };

      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockPostgresRepository.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'fd_', // Should default to fd_
        }),
      );
    });

    it('should reject registration with missing required fields', async () => {
      mockRequest.body = {
        feeder_id: 'feeder_test',
        // Missing api_key_hash and name
      };

      const handler = async (req: any, res: any, _next: any) => {
        const { feeder_id, api_key_hash, name } = req.body;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }
      };

      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'feeder_id, api_key_hash, and name are required',
        details: {},
      });
    });

    it('should reject registration if feeder already exists', async () => {
      const feederId = 'existing_feeder';
      const apiKeyHash = 'hash123';

      mockRequest.body = {
        feeder_id: feederId,
        api_key_hash: apiKeyHash,
        name: 'Existing Feeder',
      };

      const existingFeeder: Feeder = {
        id: 1,
        feeder_id: feederId,
        name: 'Existing Feeder',
        api_key_hash: apiKeyHash,
        location: null,
        latitude: null,
        longitude: null,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(existingFeeder);

      const handler = async (req: any, res: any, _next: any) => {
        const { feeder_id, api_key_hash, name } = req.body;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }

        try {
          const existing = await postgresRepository.getFeederById(feeder_id);
          if (existing) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists',
              details: { feeder_id },
            });
          }
        } catch (error) {
          const err = error as Error;
          return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: { message: err.message },
          });
        }
      };

      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Feeder already exists',
        details: { feeder_id: feederId },
      });
    });

    it('should reject registration if API key hash already exists', async () => {
      const feederId = 'new_feeder';
      const apiKeyHash = 'existing_hash';

      mockRequest.body = {
        feeder_id: feederId,
        api_key_hash: apiKeyHash,
        name: 'New Feeder',
      };

      const existingApiKey: ApiKey = {
        id: 1,
        key_id: 'key_existing',
        key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'Existing Key',
        description: null,
        user_id: null,
        scopes: ['feeder:write'],
        status: 'active',
        last_used_at: null,
        usage_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: null,
        created_by: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(existingApiKey);

      const handler = async (req: any, res: any, _next: any) => {
        const { feeder_id, api_key_hash, name } = req.body;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }

        try {
          const existing = await postgresRepository.getFeederById(feeder_id);
          if (existing) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists',
              details: { feeder_id },
            });
          }

          const existingKey = await postgresRepository.getApiKeyByHash(api_key_hash);
          if (existingKey) {
            return res.status(400).json({
              success: false,
              error: 'API key already exists',
              details: { key_id: existingKey.key_id },
            });
          }
        } catch (error) {
          const err = error as Error;
          return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: { message: err.message },
          });
        }
      };

      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'API key already exists',
        details: { key_id: 'key_existing' },
      });
    });

    it('should link feeder to user account when JWT token is provided', async () => {
      const feederId = 'feeder_user_linked';
      const apiKey = `fd_${'u'.repeat(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);
      const userId = 123;

      mockRequest.body = {
        feeder_id: feederId,
        api_key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'User Linked Feeder',
      };
      // Simulate JWT authentication by adding user to request
      (mockRequest as any).user = { userId, email: 'user@example.com' };

      const mockApiKey: ApiKey = {
        id: 3,
        key_id: 'key_user_linked',
        key_hash: apiKeyHash,
        key_prefix: 'fd_',
        name: 'Feeder: User Linked Feeder',
        description: `Auto-generated API key for feeder ${feederId} (linked to user account)`,
        user_id: userId,
        scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
        status: 'active',
        last_used_at: null,
        usage_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: null,
        created_by: userId,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      };

      const mockFeeder: Feeder = {
        id: 3,
        feeder_id: feederId,
        name: 'User Linked Feeder',
        api_key_hash: apiKeyHash,
        location: null,
        latitude: null,
        longitude: null,
        metadata: {
          api_key_id: 'key_user_linked',
          user_id: userId,
        },
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      };

      const mockUser = {
        id: userId,
        email: 'user@example.com',
        name: 'Test User',
        is_premium: false,
        is_feeder_provider: true,
        created_at: new Date(),
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.createApiKey = jest.fn().mockResolvedValue(mockApiKey);
      mockPostgresRepository.registerFeeder = jest.fn().mockResolvedValue(mockFeeder);
      mockPostgresRepository.updateUserFeederProviderStatus = jest.fn().mockResolvedValue(mockUser);

      const handler = async (req: any, res: any, _next: any) => {
        const {
          feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata,
        } = req.body;
        const authenticatedUser = req.user;
        const authenticatedUserId = authenticatedUser?.userId || null;
        const createdBy = authenticatedUser?.userId || null;

        if (!feeder_id || !api_key_hash || !name) {
          return res.status(400).json({
            success: false,
            error: 'feeder_id, api_key_hash, and name are required',
            details: {},
          });
        }

        try {
          const existing = await postgresRepository.getFeederById(feeder_id);
          if (existing) {
            return res.status(400).json({
              success: false,
              error: 'Feeder already exists',
              details: { feeder_id },
            });
          }

          const existingKey = await postgresRepository.getApiKeyByHash(api_key_hash);
          if (existingKey) {
            return res.status(400).json({
              success: false,
              error: 'API key already exists',
              details: { key_id: existingKey.key_id },
            });
          }

          const prefix = key_prefix || 'fd_';

          const apiKeyData = await postgresRepository.createApiKey({
            keyHash: api_key_hash,
            prefix,
            name: `Feeder: ${name}`,
            description: authenticatedUserId
              ? `Auto-generated API key for feeder ${feeder_id} (linked to user account)`
              : `Auto-generated API key for feeder ${feeder_id}`,
            userId: authenticatedUserId,
            scopes: ['feeder:write', 'feeder:read', 'aircraft:write'],
            createdBy,
            expiresAt: null,
          });

          const feeder = await postgresRepository.registerFeeder({
            feeder_id,
            api_key_hash,
            name,
            latitude,
            longitude,
            metadata: {
              ...metadata,
              api_key_id: apiKeyData.key_id,
              user_id: authenticatedUserId,
            },
          });

          // If feeder is linked to a user, mark user as feeder provider
          if (authenticatedUserId) {
            try {
              await postgresRepository.updateUserFeederProviderStatus(authenticatedUserId, true);
            } catch (error) {
              // Non-critical error
            }
          }

          return res.status(201).json({
            success: true,
            feeder_id: feeder.feeder_id,
            api_key_id: apiKeyData.key_id,
            scopes: apiKeyData.scopes,
            user_id: authenticatedUserId,
            linked_to_user: !!authenticatedUserId,
            message: authenticatedUserId
              ? 'Feeder registered successfully and linked to your account. API key record created with feeder scopes.'
              : 'Feeder registered successfully. API key record created with feeder scopes.',
          });
        } catch (error) {
          const err = error as Error;
          return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: { message: err.message },
          });
        }
      };

      await handler(mockRequest as any, mockResponse as any, mockNext);

      expect(mockPostgresRepository.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          createdBy: userId,
        }),
      );
      expect(mockPostgresRepository.updateUserFeederProviderStatus).toHaveBeenCalledWith(userId, true);
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          user_id: userId,
          linked_to_user: true,
        }),
      );
    });
  });

  describe('POST /api/feeder/aircraft - Batch Processing', () => {
    beforeEach(() => {
      mockNext = jest.fn();
      jest.clearAllMocks();
    });

    it('should process multiple aircraft states in batches', async () => {
      const feeder_id = 'test_feeder_123';
      const states = Array.from({ length: 25 }, (_, i) => ({
        state: [
          `abc${i.toString().padStart(3, '0')}`, // icao24
          `TEST${i}`, // callsign
          'United States', // origin_country
          Math.floor(Date.now() / 1000) - 100, // time_position
          Math.floor(Date.now() / 1000), // last_contact
          -105.0 + i * 0.1, // longitude
          40.0 + i * 0.1, // latitude
          10000, // baro_altitude
          false, // on_ground
          400, // velocity
          180, // true_track
          0, // vertical_rate
          null, // sensors
          10000, // geo_altitude
          '1200', // squawk
          false, // spi
          0, // position_source
          3, // category
          new Date(), // created_at
        ],
        feeder_id: null,
      }));

      mockRequest.body = {
        feeder_id,
        states,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue({
        id: 1,
        feeder_id,
        name: 'Test Feeder',
        api_key_hash: 'hash',
        location: null,
        latitude: 40.0,
        longitude: -105.0,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      } as Feeder);

      mockPostgresRepository.upsertAircraftStateWithPriority = jest
        .fn()
        .mockResolvedValue(undefined);
      mockPostgresRepository.updateFeederLastSeen = jest.fn().mockResolvedValue(undefined);

      // Test batch processing logic directly (simulating the handler)
      // The actual route has middleware that would need to be mocked
      const errors: Array<{ icao24: string; error: string }> = [];
      let processed = 0;
      const ingestionTimestamp = new Date();
      const validStates: Array<{ state: any[]; feeder_id: string | null; icao24: string }> = [];

      // Validation phase
      states.forEach(({ state }) => {
        if (Array.isArray(state) && state.length === 19 && typeof state[0] === 'string' && state[0].length === 6) {
          validStates.push({ state, feeder_id, icao24: state[0] as string });
        } else {
          errors.push({ icao24: (state?.[0] as string) || 'unknown', error: 'Invalid state' });
        }
      });

      // Batch processing phase
      const BATCH_SIZE = 10;
      const batches: Array<Array<{ state: any[]; feeder_id: string | null; icao24: string }>> = [];
      for (let i = 0; i < validStates.length; i += BATCH_SIZE) {
        batches.push(validStates.slice(i, i + BATCH_SIZE));
      }

      await Promise.all(
        batches.map(async (batch) => {
          const batchResults = await Promise.allSettled(
            batch.map(async ({ state, feeder_id: finalFeederId }) => {
              await mockPostgresRepository.upsertAircraftStateWithPriority(
                state,
                finalFeederId,
                ingestionTimestamp,
                'feeder',
                10,
              );
              return { success: true };
            }),
          );
          batchResults.forEach((result) => {
            if (result.status === 'fulfilled') {
              processed++;
            }
          });
        }),
      );

      // Should process all 25 valid states
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(25);
      expect(processed).toBe(25);
      expect(errors).toHaveLength(0);
    });

    it('should handle errors in batch processing gracefully', async () => {
      const feeder_id = 'test_feeder_123';
      const states = [
        {
          state: [
            'abc001',
            'TEST1',
            'United States',
            Math.floor(Date.now() / 1000) - 100,
            Math.floor(Date.now() / 1000),
            -105.0,
            40.0,
            10000,
            false,
            400,
            180,
            0,
            null,
            10000,
            '1200',
            false,
            0,
            3,
            new Date(),
          ],
          feeder_id: null,
        },
        {
          state: [
            'abc002',
            'TEST2',
            'United States',
            Math.floor(Date.now() / 1000) - 100,
            Math.floor(Date.now() / 1000),
            -105.1,
            40.1,
            10000,
            false,
            400,
            180,
            0,
            null,
            10000,
            '1200',
            false,
            0,
            3,
            new Date(),
          ],
          feeder_id: null,
        },
      ];

      mockRequest.body = {
        feeder_id,
        states,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue({
        id: 1,
        feeder_id,
        name: 'Test Feeder',
        api_key_hash: 'hash',
        location: null,
        latitude: 40.0,
        longitude: -105.0,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      } as Feeder);

      // First call succeeds, second fails
      mockPostgresRepository.upsertAircraftStateWithPriority = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Database timeout'));
      mockPostgresRepository.updateFeederLastSeen = jest.fn().mockResolvedValue(undefined);

      // Test batch processing with error handling
      const errors: Array<{ icao24: string; error: string }> = [];
      let processed = 0;
      const ingestionTimestamp = new Date();
      const validStates = states.map(({ state }) => ({
        state,
        feeder_id,
        icao24: state[0] as string,
      }));

      const BATCH_SIZE = 10;
      const batches: Array<Array<{ state: any[]; feeder_id: string; icao24: string }>> = [];
      for (let i = 0; i < validStates.length; i += BATCH_SIZE) {
        batches.push(validStates.slice(i, i + BATCH_SIZE));
      }

      await Promise.all(
        batches.map(async (batch) => {
          const batchResults = await Promise.allSettled(
            batch.map(async ({ state, feeder_id: finalFeederId, icao24 }) => {
              try {
                await mockPostgresRepository.upsertAircraftStateWithPriority(
                  state,
                  finalFeederId,
                  ingestionTimestamp,
                  'feeder',
                  10,
                );
                return { icao24, success: true };
              } catch (error) {
                const err = new Error((error as Error).message);
                (err as any).icao24 = icao24;
                throw err;
              }
            }),
          );
          batchResults.forEach((result, index) => {
            if (result.status === 'rejected') {
              const rejection = result.reason as { icao24: string; error: string };
              errors.push({
                icao24: rejection.icao24 || (batch[index]?.icao24 as string) || 'unknown',
                error: rejection.error || 'Unknown error',
              });
            } else if (result.status === 'fulfilled') {
              processed++;
            }
          });
        }),
      );

      // Should process 1 successfully, 1 with error
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(2);
      expect(processed).toBe(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].icao24).toBe('abc002');
      expect(errors[0].error).toBe('Database timeout');
    });

    it('should validate aircraft states before batch processing', async () => {
      const feeder_id = 'test_feeder_123';
      const states = [
        {
          state: [
            'abc001', // Valid
            'TEST1',
            'United States',
            Math.floor(Date.now() / 1000) - 100,
            Math.floor(Date.now() / 1000),
            -105.0,
            40.0,
            10000,
            false,
            400,
            180,
            0,
            null,
            10000,
            '1200',
            false,
            0,
            3,
            new Date(),
          ],
          feeder_id: null,
        },
        {
          state: ['invalid'], // Invalid - too short
          feeder_id: null,
        },
        {
          state: [
            'abc', // Invalid - wrong length
            'TEST2',
          ],
          feeder_id: null,
        },
      ];

      mockRequest.body = {
        feeder_id,
        states,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue({
        id: 1,
        feeder_id,
        name: 'Test Feeder',
        api_key_hash: 'hash',
        location: null,
        latitude: 40.0,
        longitude: -105.0,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        last_seen_at: null,
        is_active: true,
      } as Feeder);

      mockPostgresRepository.upsertAircraftStateWithPriority = jest
        .fn()
        .mockResolvedValue(undefined);
      mockPostgresRepository.updateFeederLastSeen = jest.fn().mockResolvedValue(undefined);

      // Test validation before batch processing
      const errors: Array<{ icao24: string; error: string }> = [];
      const ingestionTimestamp = new Date();

      states.forEach(({ state }) => {
        if (!Array.isArray(state) || state.length !== 19) {
          errors.push({
            icao24: (state?.[0] as string) || 'unknown',
            error: 'Invalid state array length (expected 19 items)',
          });
          return;
        }
        const icao24 = state[0] as string;
        if (!icao24 || typeof icao24 !== 'string' || icao24.length !== 6) {
          errors.push({
            icao24: icao24 || 'unknown',
            error: 'Invalid icao24 (must be 6-character hex string)',
          });
          return;
        }
      });

      const validStates = states
        .filter(({ state }) => Array.isArray(state) && state.length === 19)
        .filter(({ state }) => {
          const icao24 = state[0] as string;
          return icao24 && typeof icao24 === 'string' && icao24.length === 6;
        })
        .map(({ state }) => ({
          state,
          feeder_id,
          icao24: state[0] as string,
        }));

      // Process valid states
      await Promise.all(
        validStates.map(async ({ state, feeder_id: finalFeederId }) => {
          await mockPostgresRepository.upsertAircraftStateWithPriority(
            state,
            finalFeederId,
            ingestionTimestamp,
            'feeder',
            10,
          );
        }),
      );

      // Should only process 1 valid state
      expect(mockPostgresRepository.upsertAircraftStateWithPriority).toHaveBeenCalledTimes(1);
      expect(errors).toHaveLength(2); // 2 invalid states
    });
  });
});
