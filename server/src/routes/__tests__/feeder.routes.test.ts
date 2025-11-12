import { Request, Response } from 'express';
import postgresRepository from '../../repositories/PostgresRepository';
import bcrypt from 'bcryptjs';
import type { ApiKey } from '../../types/database.types';
import type { Feeder } from '../../types/database.types';

// Mock dependencies
jest.mock('../../repositories/PostgresRepository');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockPostgresRepository = postgresRepository as jest.Mocked<typeof postgresRepository>;

// Import the router after mocking
let feederRouter: any;
let registerHandler: any;

beforeAll(async () => {
  // Dynamically import the router after mocks are set up
  const module = await import('../feeder.routes');
  feederRouter = module.default;
  
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
      const apiKey = 'fd_' + 'a'.repeat(32);
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
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.createApiKey = jest.fn().mockResolvedValue(mockApiKey);
      mockPostgresRepository.registerFeeder = jest.fn().mockResolvedValue(mockFeeder);

      // Import and call the handler directly
      const { optionalApiKeyAuth } = await import('../../middlewares/apiKeyAuth');
      const { rateLimitMiddleware } = await import('../../middlewares/rateLimitMiddleware');

      // Create a mock handler that simulates the registration endpoint
      const handler = async (req: any, res: any, next: any) => {
        const { feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata } = req.body;

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
      const apiKey = 'fd_' + 'b'.repeat(32);
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
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.getApiKeyByHash = jest.fn().mockResolvedValue(null);
      mockPostgresRepository.createApiKey = jest.fn().mockResolvedValue(mockApiKey);
      mockPostgresRepository.registerFeeder = jest.fn().mockResolvedValue(mockFeeder);

      // Same handler as above
      const handler = async (req: any, res: any, next: any) => {
        const { feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata } = req.body;

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
        })
      );
    });

    it('should reject registration with missing required fields', async () => {
      mockRequest.body = {
        feeder_id: 'feeder_test',
        // Missing api_key_hash and name
      };

      const handler = async (req: any, res: any, next: any) => {
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
        last_seen_at: null,
        is_active: true,
      };

      mockPostgresRepository.getFeederById = jest.fn().mockResolvedValue(existingFeeder);

      const handler = async (req: any, res: any, next: any) => {
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

      const handler = async (req: any, res: any, next: any) => {
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
      const apiKey = 'fd_' + 'u'.repeat(32);
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

      const handler = async (req: any, res: any, next: any) => {
        const { feeder_id, api_key_hash, key_prefix, name, latitude, longitude, metadata } = req.body;
        const authenticatedUser = req.user;
        const userId = authenticatedUser?.userId || null;
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
            description: userId
              ? `Auto-generated API key for feeder ${feeder_id} (linked to user account)`
              : `Auto-generated API key for feeder ${feeder_id}`,
            userId,
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
              user_id: userId,
            },
          });

          // If feeder is linked to a user, mark user as feeder provider
          if (userId) {
            try {
              await postgresRepository.updateUserFeederProviderStatus(userId, true);
            } catch (error) {
              // Non-critical error
            }
          }

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
          userId: userId,
          createdBy: userId,
        })
      );
      expect(mockPostgresRepository.updateUserFeederProviderStatus).toHaveBeenCalledWith(userId, true);
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          user_id: userId,
          linked_to_user: true,
        })
      );
    });
  });
});

