import crypto from 'crypto';
import logger from './logger';

/**
 * API Key Generator Utility
 * Generates secure API keys with proper prefixes
 */

interface ApiKeyResult {
  key: string;
  prefix: string;
}

interface ApiKeyValidation {
  valid: boolean;
  error?: string;
  type?: string;
  prefix?: string;
}

/**
 * Generate a secure random hex string
 * @param hexLength - Length of hex string to generate (not bytes)
 */
export function generateSecureHex(hexLength: number = 32): string {
  const bytesNeeded = Math.ceil(hexLength / 2);
  return crypto.randomBytes(bytesNeeded).toString('hex').substring(0, hexLength);
}

/**
 * Generate an API key with the specified type
 */
export function generateApiKey(type: string = 'production'): ApiKeyResult {
  let prefix: string;

  switch (type) {
    case 'development':
    case 'dev':
      prefix = 'sk_dev_';
      break;
    case 'production':
    case 'live':
      prefix = 'sk_live_';
      break;
    case 'feeder':
    case 'fd':
      prefix = 'fd_';
      break;
    default:
      throw new Error(`Invalid API key type: ${type}. Use 'development', 'production', or 'feeder'`);
  }

  // Feeder keys use 64 hex chars (32 bytes), others use 32 hex chars (16 bytes)
  const hexLength = type === 'feeder' || type === 'fd' ? 64 : 32;
  const randomPart = generateSecureHex(hexLength);
  const key = `${prefix}${randomPart}`;

  logger.debug('Generated API key', {
    prefix,
    keyLength: key.length,
    lastFour: key.slice(-4),
  });

  return {
    key,
    prefix,
  };
}

/**
 * Validate API key format
 */
export function validateApiKeyFormat(key: string): ApiKeyValidation {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'API key must be a string' };
  }

  // Check if key starts with valid prefix
  if (key.startsWith('sk_dev_')) {
    if (key.length !== 39) {
      // sk_dev_ (7 chars) + 32 hex chars
      return { valid: false, error: 'Invalid development key length' };
    }
    return { valid: true, type: 'development', prefix: 'sk_dev_' };
  }

  if (key.startsWith('sk_live_')) {
    if (key.length !== 40) {
      // sk_live_ (8 chars) + 32 hex chars
      return { valid: false, error: 'Invalid production key length' };
    }
    return { valid: true, type: 'production', prefix: 'sk_live_' };
  }

  if (key.startsWith('fd_')) {
    if (key.length !== 67) {
      // fd_ (3 chars) + 64 hex chars
      return { valid: false, error: 'Invalid feeder key length' };
    }
    return { valid: true, type: 'feeder', prefix: 'fd_' };
  }

  return { valid: false, error: 'Invalid API key prefix. Must start with sk_dev_, sk_live_, or fd_' };
}

/**
 * Mask an API key for logging (show only last 4 characters)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 4) {
    return '****';
  }

  const prefix = key.startsWith('sk_dev_')
    ? 'sk_dev_'
    : key.startsWith('sk_live_')
    ? 'sk_live_'
    : key.startsWith('fd_')
    ? 'fd_'
    : '';
  const lastFour = key.slice(-4);

  return `${prefix}${'*'.repeat(key.length - prefix.length - 4)}${lastFour}`;
}
