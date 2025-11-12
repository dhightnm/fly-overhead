import { hasScope, hasAnyScope, getRequiredScopes, API_SCOPES } from '../scopes';

describe('Scopes Configuration', () => {
  describe('hasScope', () => {
    it('should return true for direct scope match', () => {
      const userScopes = ['aircraft:read', 'airports:read'];
      expect(hasScope(userScopes, 'aircraft:read')).toBe(true);
    });

    it('should return false for missing scope', () => {
      const userScopes = ['aircraft:read'];
      expect(hasScope(userScopes, 'history:read')).toBe(false);
    });

    it('should grant all permissions for internal:all', () => {
      const userScopes = ['internal:all'];
      expect(hasScope(userScopes, 'aircraft:read')).toBe(true);
      expect(hasScope(userScopes, 'history:write')).toBe(true);
      expect(hasScope(userScopes, 'admin:keys')).toBe(true);
    });

    it('should handle wildcard scopes correctly', () => {
      const userScopes = ['aircraft:*'];
      expect(hasScope(userScopes, 'aircraft:read')).toBe(true);
      expect(hasScope(userScopes, 'aircraft:write')).toBe(true);
    });

    it('should handle admin wildcard correctly', () => {
      const userScopes = ['admin:*'];
      expect(hasScope(userScopes, 'admin:keys')).toBe(true);
      expect(hasScope(userScopes, 'admin:users')).toBe(true);
      expect(hasScope(userScopes, 'aircraft:read')).toBe(true);
    });
  });

  describe('hasAnyScope', () => {
    it('should return true if user has any of the required scopes', () => {
      const userScopes = ['aircraft:read'];
      const requiredScopes = ['aircraft:read', 'history:read'];
      expect(hasAnyScope(userScopes, requiredScopes)).toBe(true);
    });

    it('should return false if user has none of the required scopes', () => {
      const userScopes = ['airports:read'];
      const requiredScopes = ['aircraft:read', 'history:read'];
      expect(hasAnyScope(userScopes, requiredScopes)).toBe(false);
    });

    it('should handle wildcard scopes in hasAnyScope', () => {
      const userScopes = ['aircraft:*'];
      const requiredScopes = ['aircraft:read', 'history:read'];
      expect(hasAnyScope(userScopes, requiredScopes)).toBe(true);
    });
  });

  describe('getRequiredScopes', () => {
    it('should return correct scopes for aircraft endpoints', () => {
      const scopes = getRequiredScopes('GET', '/api/area/all');
      expect(scopes).toContain('aircraft:read');
    });

    it('should return correct scopes for admin endpoints', () => {
      const scopes = getRequiredScopes('POST', '/api/admin/keys');
      expect(scopes).toContain('admin:keys');
    });

    it('should return correct scopes for feeder endpoints', () => {
      const scopes = getRequiredScopes('POST', '/api/feeder/aircraft');
      expect(scopes).toContain('feeder:write');
    });

    it('should match wildcard patterns', () => {
      const scopes = getRequiredScopes('GET', '/api/history/abc123');
      expect(scopes).toContain('history:read');
    });

    it('should return null for undefined endpoints', () => {
      const scopes = getRequiredScopes('GET', '/api/nonexistent');
      expect(scopes).toBeNull();
    });
  });

  describe('API_SCOPES constants', () => {
    it('should have all expected scope constants', () => {
      expect(API_SCOPES.INTERNAL_ALL).toBe('internal:all');
      expect(API_SCOPES.ADMIN_ALL).toBe('admin:*');
      expect(API_SCOPES.AIRCRAFT_READ).toBe('aircraft:read');
      expect(API_SCOPES.HISTORY_READ).toBe('history:read');
      expect(API_SCOPES.FEEDER_WRITE).toBe('feeder:write');
    });
  });

  describe('Development keys', () => {
    it('should have internal:all scope for development keys', () => {
      const devScopes = ['internal:all'];
      expect(hasScope(devScopes, 'admin:keys')).toBe(true);
      expect(hasScope(devScopes, 'aircraft:write')).toBe(true);
      expect(hasScope(devScopes, 'feeder:write')).toBe(true);
    });
  });

  describe('Production keys', () => {
    it('should have limited scopes for production keys', () => {
      const prodScopes = ['read', 'aircraft:read', 'airports:read'];
      expect(hasScope(prodScopes, 'aircraft:read')).toBe(true);
      expect(hasScope(prodScopes, 'aircraft:write')).toBe(false);
      expect(hasScope(prodScopes, 'admin:keys')).toBe(false);
    });
  });

  describe('Feeder keys', () => {
    it('should have correct scopes for feeder keys', () => {
      const feederScopes = ['feeder:write', 'feeder:read', 'aircraft:write'];
      expect(hasScope(feederScopes, 'feeder:write')).toBe(true);
      expect(hasScope(feederScopes, 'aircraft:write')).toBe(true);
      expect(hasScope(feederScopes, 'admin:keys')).toBe(false);
    });
  });
});

