import { createApiKeySchema, listApiKeysSchema } from '../admin.schemas';

describe('admin schemas', () => {
  describe('createApiKeySchema', () => {
    it('parses a complete payload and coerces dates', () => {
      const expiresAtIso = '2030-01-01T00:00:00.000Z';
      const parsed = createApiKeySchema.parse({
        name: 'Fleet Maintenance',
        description: 'Key for ops dashboard',
        type: 'production',
        scopes: ['aircraft:read', 'internal:all'],
        expiresAt: expiresAtIso,
      });

      expect(parsed.name).toBe('Fleet Maintenance');
      expect(parsed.type).toBe('production');
      expect(parsed.expiresAt).toBeInstanceOf(Date);
      expect(parsed.scopes).toEqual(['aircraft:read', 'internal:all']);
    });

    it('applies defaults and allows optional fields to be omitted', () => {
      const parsed = createApiKeySchema.parse({
        name: 'Dev Console Key',
      });

      expect(parsed.type).toBe('production'); // default
      expect(parsed.description).toBeUndefined();
      expect(parsed.scopes).toBeUndefined();
      expect(parsed.expiresAt).toBeUndefined();
    });

    it('rejects unknown key types and empty scopes', () => {
      expect(() => createApiKeySchema.parse({
        name: 'Bad Key',
        type: 'invalid',
      })).toThrow();

      expect(() => createApiKeySchema.parse({
        name: 'Another Key',
        scopes: [''],
      })).toThrow();
    });
  });

  describe('listApiKeysSchema', () => {
    it('applies pagination defaults when params are missing', () => {
      const parsed = listApiKeysSchema.parse({});
      expect(parsed.limit).toBe(100);
      expect(parsed.offset).toBe(0);
      expect(parsed.status).toBeUndefined();
      expect(parsed.type).toBeUndefined();
    });

    it('accepts valid filters and coerces numeric inputs', () => {
      const parsed = listApiKeysSchema.parse({
        status: 'active',
        type: 'development',
        limit: '250',
        offset: '5',
      });

      expect(parsed.limit).toBe(250);
      expect(parsed.offset).toBe(5);
      expect(parsed.type).toBe('development');
      expect(parsed.status).toBe('active');
    });

    it('rejects values outside of allowed bounds', () => {
      expect(() => listApiKeysSchema.parse({ limit: 2000 })).toThrow();
      expect(() => listApiKeysSchema.parse({ offset: -1 })).toThrow();
      expect(() => listApiKeysSchema.parse({ type: 'invalid' })).toThrow();
    });
  });
});
