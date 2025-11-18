/**
 * API Scope Configuration
 * Defines granular permissions for API endpoints
 */

/**
 * Available API scopes
 */
export const API_SCOPES = {
  // Admin/Internal scopes
  INTERNAL_ALL: 'internal:all', // Full access (internal services)
  ADMIN_ALL: 'admin:*', // All admin operations
  ADMIN_KEYS: 'admin:keys', // Manage API keys
  ADMIN_USERS: 'admin:users', // Manage users
  ADMIN_FEEDERS: 'admin:feeders', // Manage feeders

  // Aircraft data scopes
  AIRCRAFT_ALL: 'aircraft:*', // All aircraft operations
  AIRCRAFT_READ: 'aircraft:read', // Read aircraft data
  AIRCRAFT_WRITE: 'aircraft:write', // Submit aircraft data (feeders)

  // Historical data scopes
  HISTORY_ALL: 'history:*', // All history operations
  HISTORY_READ: 'history:read', // Read historical data
  HISTORY_WRITE: 'history:write', // Write historical data

  // Airport data scopes
  AIRPORTS_READ: 'airports:read', // Read airport data
  NAVAIDS_READ: 'navaids:read', // Read navaid data

  // Spatial query scopes
  SPATIAL_READ: 'spatial:read', // Spatial queries

  // Flight plan scopes
  FLIGHTPLAN_READ: 'flightplan:read', // Read flight plans

  // Route data scopes
  ROUTES_READ: 'routes:read', // Read route data

  // Feeder scopes
  FEEDER_WRITE: 'feeder:write', // Submit feeder data
  FEEDER_READ: 'feeder:read', // Read feeder info

  // General read scope (default)
  READ: 'read', // Basic read access
} as const;

/**
 * Scope hierarchy - wildcards include all child scopes
 */
export const SCOPE_HIERARCHY: Record<string, string[]> = {
  'internal:all': Object.values(API_SCOPES), // Internal has everything
  'admin:*': [
    API_SCOPES.ADMIN_KEYS,
    API_SCOPES.ADMIN_USERS,
    API_SCOPES.ADMIN_FEEDERS,
    API_SCOPES.AIRCRAFT_READ,
    API_SCOPES.HISTORY_READ,
    API_SCOPES.AIRPORTS_READ,
    API_SCOPES.SPATIAL_READ,
    API_SCOPES.FLIGHTPLAN_READ,
    API_SCOPES.ROUTES_READ,
  ],
  'aircraft:*': [API_SCOPES.AIRCRAFT_READ, API_SCOPES.AIRCRAFT_WRITE],
  'history:*': [API_SCOPES.HISTORY_READ, API_SCOPES.HISTORY_WRITE],
};

/**
 * Default scopes by key type
 */
export const DEFAULT_SCOPES: Record<string, string[]> = {
  development: [API_SCOPES.INTERNAL_ALL], // Dev keys get everything
  production: [
    API_SCOPES.READ,
    API_SCOPES.AIRCRAFT_READ,
    API_SCOPES.AIRPORTS_READ,
    API_SCOPES.ROUTES_READ,
  ],
  restricted: [API_SCOPES.READ],
  feeder: [API_SCOPES.FEEDER_WRITE, API_SCOPES.FEEDER_READ, API_SCOPES.AIRCRAFT_WRITE],
};

/**
 * Endpoint to scope mapping
 * Maps API endpoints to required scopes
 */
export const ENDPOINT_SCOPES: Record<string, string[]> = {
  // Aircraft endpoints
  'GET /api/area/*': [API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ],
  'POST /api/area/fetch/*': [API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ],
  'GET /api/planes/*': [API_SCOPES.AIRCRAFT_READ, API_SCOPES.READ],
  'GET /api/route/*': [API_SCOPES.ROUTES_READ, API_SCOPES.READ],

  // History endpoints
  'GET /api/history/*': [API_SCOPES.HISTORY_READ, API_SCOPES.READ],

  // Spatial endpoints
  'GET /api/spatial/*': [API_SCOPES.SPATIAL_READ, API_SCOPES.READ],

  // Airport endpoints
  'GET /api/airports/*': [API_SCOPES.AIRPORTS_READ, API_SCOPES.READ],
  'GET /api/navaids/*': [API_SCOPES.NAVAIDS_READ, API_SCOPES.READ],

  // Flight plan endpoints
  'GET /api/flightplan/*': [API_SCOPES.FLIGHTPLAN_READ, API_SCOPES.READ],

  // Route stats
  'GET /api/routes/stats': [API_SCOPES.ROUTES_READ, API_SCOPES.READ],

  // Feeder endpoints
  'POST /api/feeder/aircraft': [API_SCOPES.FEEDER_WRITE, API_SCOPES.AIRCRAFT_WRITE],
  'POST /api/feeder/register': [API_SCOPES.FEEDER_WRITE],
  'POST /api/feeder/stats': [API_SCOPES.FEEDER_WRITE],
  'PUT /api/feeder/last-seen': [API_SCOPES.FEEDER_WRITE],
  'GET /api/feeder/me': [API_SCOPES.FEEDER_READ],

  // Admin endpoints (require admin scope)
  'POST /api/admin/keys': [API_SCOPES.ADMIN_KEYS],
  'GET /api/admin/keys': [API_SCOPES.ADMIN_KEYS],
  'GET /api/admin/keys/*': [API_SCOPES.ADMIN_KEYS],
  'PUT /api/admin/keys/*': [API_SCOPES.ADMIN_KEYS],
  'DELETE /api/admin/keys/*': [API_SCOPES.ADMIN_KEYS],
};

/**
 * Check if a user has a required scope
 * Handles wildcard scopes and hierarchy
 */
export function hasScope(userScopes: string[], requiredScope: string): boolean {
  // Check direct match
  if (userScopes.includes(requiredScope)) {
    return true;
  }

  // Check wildcard scopes
  for (const userScope of userScopes) {
    // Check if user has internal:all (grants everything)
    if (userScope === API_SCOPES.INTERNAL_ALL) {
      return true;
    }

    // Check hierarchy
    const childScopes = SCOPE_HIERARCHY[userScope];
    if (childScopes && childScopes.includes(requiredScope)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a user has any of the required scopes (OR logic)
 */
export function hasAnyScope(userScopes: string[], requiredScopes: string[]): boolean {
  for (const requiredScope of requiredScopes) {
    if (hasScope(userScopes, requiredScope)) {
      return true;
    }
  }
  return false;
}

/**
 * Get required scopes for an endpoint
 */
export function getRequiredScopes(method: string, path: string): string[] | null {
  const key = `${method} ${path}`;

  // Direct match
  if (ENDPOINT_SCOPES[key]) {
    return ENDPOINT_SCOPES[key];
  }

  // Pattern match (wildcards)
  for (const [pattern, scopes] of Object.entries(ENDPOINT_SCOPES)) {
    const [patternMethod, patternPath] = pattern.split(' ');

    if (patternMethod !== method) {
      continue;
    }

    // Convert wildcard pattern to regex
    const regex = new RegExp(
      `^${patternPath.replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+')}$`,
    );

    if (regex.test(path)) {
      return scopes;
    }
  }

  return null;
}
