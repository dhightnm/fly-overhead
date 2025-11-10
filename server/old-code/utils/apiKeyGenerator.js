const crypto = require('crypto');
const logger = require('./logger');

/**
 * API Key Generator Utility
 * Generates secure API keys with proper prefixes
 */

/**
 * Generate a secure random hex string
 * @param {number} length - Length of the hex string (default: 32)
 * @returns {string} - Random hex string
 */
function generateSecureHex(length = 32) {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

/**
 * Generate an API key with the specified type
 * @param {string} type - Key type: 'development' or 'production'
 * @returns {object} - { key: string, prefix: string }
 */
function generateApiKey(type = 'production') {
  let prefix;
  
  switch (type) {
    case 'development':
    case 'dev':
      prefix = 'sk_dev_';
      break;
    case 'production':
    case 'live':
      prefix = 'sk_live_';
      break;
    default:
      throw new Error(`Invalid API key type: ${type}. Use 'development' or 'production'`);
  }
  
  const randomPart = generateSecureHex(32);
  const key = `${prefix}${randomPart}`;
  
  logger.debug('Generated API key', { 
    prefix, 
    keyLength: key.length,
    lastFour: key.slice(-4)
  });
  
  return {
    key,
    prefix,
  };
}

/**
 * Validate API key format
 * @param {string} key - API key to validate
 * @returns {object} - { valid: boolean, error?: string, type?: string }
 */
function validateApiKeyFormat(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'API key must be a string' };
  }
  
  // Check if key starts with valid prefix
  if (key.startsWith('sk_dev_')) {
    if (key.length !== 39) { // sk_dev_ (7 chars) + 32 hex chars
      return { valid: false, error: 'Invalid development key length' };
    }
    return { valid: true, type: 'development', prefix: 'sk_dev_' };
  }
  
  if (key.startsWith('sk_live_')) {
    if (key.length !== 40) { // sk_live_ (8 chars) + 32 hex chars
      return { valid: false, error: 'Invalid production key length' };
    }
    return { valid: true, type: 'production', prefix: 'sk_live_' };
  }
  
  return { valid: false, error: 'Invalid API key prefix. Must start with sk_dev_ or sk_live_' };
}

/**
 * Mask an API key for logging (show only last 4 characters)
 * @param {string} key - API key to mask
 * @returns {string} - Masked key
 */
function maskApiKey(key) {
  if (!key || key.length < 4) {
    return '****';
  }
  
  const prefix = key.startsWith('sk_dev_') ? 'sk_dev_' : 
                 key.startsWith('sk_live_') ? 'sk_live_' : '';
  const lastFour = key.slice(-4);
  
  return `${prefix}${'*'.repeat(key.length - prefix.length - 4)}${lastFour}`;
}

module.exports = {
  generateApiKey,
  validateApiKeyFormat,
  maskApiKey,
  generateSecureHex,
};

