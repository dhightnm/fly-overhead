import { generateApiKey, validateApiKeyFormat, maskApiKey, generateSecureHex } from '../apiKeyGenerator';

describe('API Key Generator', () => {
  describe('generateApiKey', () => {
    it('should generate development key with sk_dev_ prefix', () => {
      const result = generateApiKey('development');
      expect(result.key).toMatch(/^sk_dev_[a-f0-9]{32}$/);
      expect(result.prefix).toBe('sk_dev_');
      expect(result.key.length).toBe(39);
    });

    it('should generate development key with dev alias', () => {
      const result = generateApiKey('dev');
      expect(result.key).toMatch(/^sk_dev_[a-f0-9]{32}$/);
      expect(result.prefix).toBe('sk_dev_');
    });

    it('should generate production key with sk_live_ prefix', () => {
      const result = generateApiKey('production');
      expect(result.key).toMatch(/^sk_live_[a-f0-9]{32}$/);
      expect(result.prefix).toBe('sk_live_');
      expect(result.key.length).toBe(40);
    });

    it('should generate production key with live alias', () => {
      const result = generateApiKey('live');
      expect(result.key).toMatch(/^sk_live_[a-f0-9]{32}$/);
      expect(result.prefix).toBe('sk_live_');
    });

    it('should generate feeder key with fd_ prefix', () => {
      const result = generateApiKey('feeder');
      expect(result.key).toMatch(/^fd_[a-f0-9]{64}$/);
      expect(result.prefix).toBe('fd_');
      expect(result.key.length).toBe(67);
    });

    it('should generate feeder key with fd alias', () => {
      const result = generateApiKey('fd');
      expect(result.key).toMatch(/^fd_[a-f0-9]{64}$/);
      expect(result.prefix).toBe('fd_');
    });

    it('should default to production key when no type specified', () => {
      const result = generateApiKey();
      expect(result.key).toMatch(/^sk_live_[a-f0-9]{32}$/);
      expect(result.prefix).toBe('sk_live_');
    });

    it('should throw error for invalid key type', () => {
      expect(() => generateApiKey('invalid')).toThrow(
        "Invalid API key type: invalid. Use 'development', 'production', or 'feeder'",
      );
    });

    it('should generate unique keys on each call', () => {
      const key1 = generateApiKey('production');
      const key2 = generateApiKey('production');
      expect(key1.key).not.toBe(key2.key);
    });
  });

  describe('validateApiKeyFormat', () => {
    describe('Development keys', () => {
      it('should validate correct development key', () => {
        const key = 'sk_dev_' + 'a'.repeat(32);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(true);
        expect(result.type).toBe('development');
        expect(result.prefix).toBe('sk_dev_');
      });

      it('should reject development key with wrong length', () => {
        const key = 'sk_dev_' + 'a'.repeat(31);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid development key length');
      });
    });

    describe('Production keys', () => {
      it('should validate correct production key', () => {
        const key = 'sk_live_' + 'b'.repeat(32);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(true);
        expect(result.type).toBe('production');
        expect(result.prefix).toBe('sk_live_');
      });

      it('should reject production key with wrong length', () => {
        const key = 'sk_live_' + 'b'.repeat(31);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid production key length');
      });
    });

    describe('Feeder keys', () => {
      it('should validate correct feeder key', () => {
        const key = 'fd_' + 'c'.repeat(64);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(true);
        expect(result.type).toBe('feeder');
        expect(result.prefix).toBe('fd_');
      });

      it('should reject feeder key with wrong length', () => {
        const key = 'fd_' + 'c'.repeat(63);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid feeder key length');
      });

      it('should reject feeder key that is too short', () => {
        const key = 'fd_' + 'c'.repeat(10);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid feeder key length');
      });

      it('should reject feeder key that is too long', () => {
        const key = 'fd_' + 'c'.repeat(65);
        const result = validateApiKeyFormat(key);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid feeder key length');
      });
    });

    describe('Invalid keys', () => {
      it('should reject null key', () => {
        const result = validateApiKeyFormat(null as any);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('API key must be a string');
      });

      it('should reject undefined key', () => {
        const result = validateApiKeyFormat(undefined as any);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('API key must be a string');
      });

      it('should reject key with invalid prefix', () => {
        const result = validateApiKeyFormat('invalid_prefix_123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid API key prefix');
      });

      it('should reject empty string', () => {
        const result = validateApiKeyFormat('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('API key must be a string');
      });
    });
  });

  describe('maskApiKey', () => {
    it('should mask development key', () => {
      const key = 'sk_dev_' + 'a'.repeat(32);
      const masked = maskApiKey(key);
      expect(masked).toMatch(/^sk_dev_\*{28}[a-f0-9]{4}$/);
      expect(masked.length).toBe(39);
    });

    it('should mask production key', () => {
      const key = 'sk_live_' + 'b'.repeat(32);
      const masked = maskApiKey(key);
      expect(masked).toMatch(/^sk_live_\*{28}[a-f0-9]{4}$/);
      expect(masked.length).toBe(40);
    });

    it('should mask feeder key', () => {
      const key = 'fd_' + 'c'.repeat(64);
      const masked = maskApiKey(key);
      expect(masked).toMatch(/^fd_\*{60}[a-f0-9]{4}$/);
      expect(masked.length).toBe(67);
    });

    it('should handle short keys', () => {
      const masked = maskApiKey('abc');
      expect(masked).toBe('****');
    });

    it('should handle empty string', () => {
      const masked = maskApiKey('');
      expect(masked).toBe('****');
    });

    it('should handle keys without known prefix', () => {
      const key = 'unknown_' + 'x'.repeat(20);
      const masked = maskApiKey(key);
      // Should mask all but last 4 characters
      expect(masked.length).toBe(key.length);
      expect(masked.endsWith('xxxx')).toBe(true);
      expect(masked.startsWith('****')).toBe(true);
    });
  });

  describe('generateSecureHex', () => {
    it('should generate hex string of specified length', () => {
      const hex = generateSecureHex(16);
      expect(hex).toMatch(/^[a-f0-9]{16}$/);
      expect(hex.length).toBe(16);
    });

    it('should default to 32 characters', () => {
      const hex = generateSecureHex();
      expect(hex).toMatch(/^[a-f0-9]{32}$/);
      expect(hex.length).toBe(32);
    });

    it('should generate unique values', () => {
      const hex1 = generateSecureHex(32);
      const hex2 = generateSecureHex(32);
      expect(hex1).not.toBe(hex2);
    });
  });
});
