import { Request, Response, NextFunction } from 'express';
import { extractApiKey, optionalApiKeyAuth, requireApiKeyAuth } from '../apiKeyAuth';
import postgresRepository from '../../repositories/PostgresRepository';
import bcrypt from 'bcryptjs';
import type { ApiKey } from '../../types/database.types';

// Mock dependencies
jest.mock('../../repositories/PostgresRepository');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockPostgresRepository = postgresRepository as jest.Mocked<typeof postgresRepository>;

describe('API Key Authentication', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      query: {},
      ip: '127.0.0.1',
      path: '/test',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('extractApiKey', () => {
    it('should extract API key from Authorization Bearer header (sk_live_)', () => {
      mockRequest.headers = {
        authorization: 'Bearer sk_live_' + 'a'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('sk_live_' + 'a'.repeat(32));
    });

    it('should extract API key from Authorization Bearer header (sk_dev_)', () => {
      mockRequest.headers = {
        authorization: 'Bearer sk_dev_' + 'b'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('sk_dev_' + 'b'.repeat(32));
    });

    it('should extract feeder API key from Authorization Bearer header (fd_)', () => {
      mockRequest.headers = {
        authorization: 'Bearer fd_' + 'c'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('fd_' + 'c'.repeat(32));
    });

    it('should extract API key from X-API-Key header', () => {
      mockRequest.headers = {
        'x-api-key': 'sk_live_' + 'd'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('sk_live_' + 'd'.repeat(32));
    });

    it('should extract feeder API key from X-API-Key header', () => {
      mockRequest.headers = {
        'x-api-key': 'fd_' + 'e'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('fd_' + 'e'.repeat(32));
    });

    it('should extract API key from query parameter', () => {
      mockRequest.query = {
        api_key: 'sk_live_' + 'f'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('sk_live_' + 'f'.repeat(32));
    });

    it('should extract feeder API key from query parameter', () => {
      mockRequest.query = {
        api_key: 'fd_' + 'g'.repeat(32),
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBe('fd_' + 'g'.repeat(32));
    });

    it('should return null when no API key is provided', () => {
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBeNull();
    });

    it('should return null for invalid prefix in Bearer header', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid_prefix_123',
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBeNull();
    });

    it('should return null for invalid prefix in X-API-Key header', () => {
      mockRequest.headers = {
        'x-api-key': 'invalid_prefix_123',
      };
      const key = extractApiKey(mockRequest as Request);
      expect(key).toBeNull();
    });
  });

  describe('optionalApiKeyAuth', () => {
    it('should pass through when no API key is provided', async () => {
      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should authenticate valid development API key', async () => {
      const apiKey = 'sk_dev_' + 'a'.repeat(32);
      const keyHash = await bcrypt.hash(apiKey, 10);
      const mockApiKey: ApiKey = {
        id: 1,
        key_id: 'key_123',
        key_hash: keyHash,
        key_prefix: 'sk_dev_',
        name: 'Test Dev Key',
        description: null,
        user_id: null,
        scopes: ['internal:all'],
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

      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(mockApiKey);

      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).apiKey).toBeDefined();
      expect((mockRequest as any).apiKey.type).toBe('development');
      expect((mockRequest as any).apiKey.prefix).toBe('sk_dev_');
    });

    it('should authenticate valid production API key', async () => {
      const apiKey = 'sk_live_' + 'b'.repeat(32);
      const keyHash = await bcrypt.hash(apiKey, 10);
      const mockApiKey: ApiKey = {
        id: 2,
        key_id: 'key_456',
        key_hash: keyHash,
        key_prefix: 'sk_live_',
        name: 'Test Prod Key',
        description: null,
        user_id: 1,
        scopes: ['read', 'aircraft:read'],
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

      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(mockApiKey);

      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).apiKey).toBeDefined();
      expect((mockRequest as any).apiKey.type).toBe('production');
      expect((mockRequest as any).apiKey.prefix).toBe('sk_live_');
    });

    it('should authenticate valid feeder API key', async () => {
      const apiKey = 'fd_' + 'c'.repeat(32);
      const keyHash = await bcrypt.hash(apiKey, 10);
      const mockApiKey: ApiKey = {
        id: 3,
        key_id: 'key_789',
        key_hash: keyHash,
        key_prefix: 'fd_',
        name: 'Test Feeder Key',
        description: 'Feeder API key',
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

      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(mockApiKey);

      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).apiKey).toBeDefined();
      expect((mockRequest as any).apiKey.type).toBe('feeder');
      expect((mockRequest as any).apiKey.prefix).toBe('fd_');
      expect((mockRequest as any).apiKey.scopes).toEqual(['feeder:write', 'feeder:read', 'aircraft:write']);
    });

    it('should reject invalid API key format', async () => {
      // Use a key with valid prefix but wrong length (will fail format validation)
      const invalidKey = 'sk_live_' + 'a'.repeat(31); // Should be 32 chars, only 31
      mockRequest.headers = {
        authorization: `Bearer ${invalidKey}`,
      };

      // optionalApiKeyAuth validates format and rejects invalid keys
      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      // Should return 401 for invalid format
      expect(mockResponse.status).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.error).toBeDefined();
      expect(jsonCall.error.code).toBe('INVALID_API_KEY_FORMAT');
      expect(jsonCall.error.status).toBe(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject non-existent API key', async () => {
      const apiKey = 'sk_live_' + 'd'.repeat(32);
      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(null);

      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject expired API key', async () => {
      const apiKey = 'sk_live_' + 'e'.repeat(32);
      const keyHash = await bcrypt.hash(apiKey, 10);
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      const mockApiKey: ApiKey = {
        id: 4,
        key_id: 'key_expired',
        key_hash: keyHash,
        key_prefix: 'sk_live_',
        name: 'Expired Key',
        description: null,
        user_id: null,
        scopes: ['read'],
        status: 'active',
        last_used_at: null,
        usage_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: expiredDate,
        created_by: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      };

      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(mockApiKey);

      await optionalApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireApiKeyAuth', () => {
    it('should reject request without API key', async () => {
      await requireApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should authenticate valid feeder API key', async () => {
      const apiKey = 'fd_' + 'f'.repeat(32);
      const keyHash = await bcrypt.hash(apiKey, 10);
      const mockApiKey: ApiKey = {
        id: 5,
        key_id: 'key_feeder',
        key_hash: keyHash,
        key_prefix: 'fd_',
        name: 'Feeder Key',
        description: null,
        user_id: null,
        scopes: ['feeder:write', 'aircraft:write'],
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

      mockRequest.headers = {
        authorization: `Bearer ${apiKey}`,
      };

      mockPostgresRepository.validateApiKey = jest.fn().mockResolvedValue(mockApiKey);

      await requireApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).apiKey).toBeDefined();
      expect((mockRequest as any).apiKey.type).toBe('feeder');
    });

    it('should reject invalid API key format', async () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid_format',
      };

      await requireApiKeyAuth(mockRequest as any, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
