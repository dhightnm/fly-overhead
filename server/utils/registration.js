/**
 * Registration utilities
 */

/**
 * Normalize an aircraft registration identifier.
 * - Uppercase
 * - Remove whitespace and punctuation (non-alphanumeric)
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function normalizeRegistration(value) {
  if (!value) return null;
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  normalizeRegistration,
};

