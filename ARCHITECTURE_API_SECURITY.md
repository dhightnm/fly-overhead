# API Security Architecture - Production Level

## Executive Summary

This document outlines a comprehensive, production-ready API security architecture for the Fly Overhead platform. The architecture implements a multi-tiered API key system with OAuth2 support, rate limiting, and role-based access control (RBAC).

## Current State Analysis

### Existing Authentication
- **JWT-based user authentication** (login/register/Google OAuth)
- **Feeder API keys** (bcrypt-hashed, `sk_live_*` format)
- **No API key system** for general API consumers
- **No rate limiting** per API consumer
- **No dev/testing bypass** mechanism

### Current Endpoints
1. **Public Routes** (no auth):
   - `/api/health`, `/api/ready`, `/api/opensky-status`
   
2. **User Routes** (JWT auth):
   - `/api/auth/me` (requires JWT)
   
3. **Feeder Routes** (API key auth):
   - `/api/feeder/*` (uses `sk_live_*` API keys)
   
4. **Aircraft Data Routes** (currently public):
   - `/api/area/*`, `/api/planes/*`, `/api/route/*`, `/api/history/*`
   - `/api/spatial/*`, `/api/airports/*`, `/api/navaids/*`
   - `/api/flightplan/*`

## Proposed Architecture

### 1. API Key System

#### Key Types and Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     API Key Hierarchy                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  DEVELOPMENT (sk_dev_*)                              │  │
│  │  - Bypass rate limits                                │  │
│  │  - Full API access                                   │  │
│  │  - Detailed logging                                  │  │
│  │  - Never expires                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  INTERNAL (sk_internal_*)                           │  │
│  │  - Service-to-service communication                 │  │
│  │  - High rate limits (10,000/hour)                   │  │
│  │  - Full API access                                   │  │
│  │  - Minimal logging                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PRODUCTION (sk_live_*)                              │  │
│  │  - External customers/feeders                        │  │
│  │  - Standard rate limits (1,000/hour)                │  │
│  │  - Scoped permissions                                │  │
│  │  - Full audit logging                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  RESTRICTED (sk_restricted_*)                        │  │
│  │  - Limited public API consumers                      │  │
│  │  - Low rate limits (100/hour)                       │  │
│  │  - Read-only access                                  │  │
│  │  - Throttled during high load                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PUBLIC (no key)                                     │  │
│  │  - Anonymous access                                  │  │
│  │  - Very low rate limits (10/hour per IP)           │  │
│  │  - Basic endpoints only                              │  │
│  │  - Heavily cached responses                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

#### Key Format Specification

```
Format: {prefix}_{env}_{32_char_hex}

Prefixes:
- sk_dev_        → Development keys (bypass rate limits)
- sk_internal_   → Internal service keys (high limits)
- sk_live_       → Production customer keys (standard limits)
- sk_restricted_ → Restricted public keys (low limits)

Examples:
- sk_dev_7f83b1657ff1fc53b92dc18148a1d65d
- sk_internal_a3c4f7e2d9b8c1e5f6a7b8c9d0e1f2a3
- sk_live_9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a
- sk_restricted_5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

### 2. Database Schema

```sql
-- API Keys table
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  key_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL,                    -- bcrypt hash
  key_prefix TEXT NOT NULL,                  -- sk_dev_, sk_live_, etc
  key_type TEXT NOT NULL CHECK (key_type IN ('development', 'internal', 'production', 'restricted')),
  name TEXT NOT NULL,                         -- Human readable name
  description TEXT,
  
  -- Ownership
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Permissions & Scopes
  scopes TEXT[] DEFAULT '{}',                -- ['aircraft:read', 'history:read', 'airports:read']
  rate_limit_tier TEXT NOT NULL DEFAULT 'standard',
  custom_rate_limit_per_hour INTEGER,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  enabled BOOLEAN DEFAULT true,
  
  -- Metadata
  last_used_at TIMESTAMPTZ,
  usage_count BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  
  -- Security
  ip_whitelist INET[],                       -- Optional IP restrictions
  origin_whitelist TEXT[],                   -- Optional origin restrictions
  
  -- Audit
  created_by INTEGER REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES users(id),
  revoked_reason TEXT
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status) WHERE status = 'active';
CREATE INDEX idx_api_keys_type ON api_keys(key_type);

-- Rate limiting table (sliding window counter)
CREATE TABLE api_rate_limits (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
  ip_address INET,
  endpoint_pattern TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(api_key_id, endpoint_pattern, window_start),
  UNIQUE(ip_address, endpoint_pattern, window_start)
);

CREATE INDEX idx_rate_limits_window ON api_rate_limits(window_start);
CREATE INDEX idx_rate_limits_key_id ON api_rate_limits(api_key_id);
CREATE INDEX idx_rate_limits_ip ON api_rate_limits(ip_address);

-- API usage logs (for billing and analytics)
CREATE TABLE api_usage_logs (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  request_id UUID DEFAULT gen_random_uuid(),
  
  -- Request details
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  
  -- Client info
  ip_address INET,
  user_agent TEXT,
  origin TEXT,
  
  -- Rate limiting
  rate_limited BOOLEAN DEFAULT false,
  rate_limit_remaining INTEGER,
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Partition by month for performance
CREATE INDEX idx_usage_logs_api_key ON api_usage_logs(api_key_id, created_at DESC);
CREATE INDEX idx_usage_logs_created ON api_usage_logs(created_at DESC);

-- Organizations table (for multi-tenant support)
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'pro', 'enterprise')),
  
  -- Rate limits at org level
  max_api_keys INTEGER DEFAULT 5,
  monthly_request_quota INTEGER DEFAULT 10000,
  requests_this_month BIGINT DEFAULT 0,
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
```

### 3. Permission Scopes

```javascript
// Hierarchical permission system
const SCOPES = {
  // Read-only aircraft data
  'aircraft:read': ['GET /api/area/*', 'GET /api/planes/*', 'GET /api/route/*'],
  'aircraft:write': ['POST /api/feeder/aircraft'],  // Feeders only
  
  // Historical data
  'history:read': ['GET /api/history/*'],
  'history:write': [], // Reserved for future
  
  // Airport data
  'airports:read': ['GET /api/airports/*', 'GET /api/navaids/*'],
  
  // Spatial queries
  'spatial:read': ['GET /api/spatial/*'],
  
  // Flight plans
  'flightplan:read': ['GET /api/flightplan/*'],
  
  // Admin operations
  'admin:keys': ['POST /api/admin/keys', 'DELETE /api/admin/keys/*'],
  'admin:users': ['GET /api/admin/users/*', 'PUT /api/admin/users/*'],
  
  // Special permissions
  'feeder:data': ['POST /api/feeder/aircraft', 'POST /api/feeder/stats'],
  'internal:all': ['*'], // Full access for internal services
};

// Default scopes by key type
const DEFAULT_SCOPES_BY_TYPE = {
  development: ['internal:all'],
  internal: ['internal:all'],
  production: ['aircraft:read', 'history:read', 'airports:read', 'spatial:read', 'flightplan:read'],
  restricted: ['aircraft:read', 'airports:read'],
};
```

### 4. Rate Limiting Strategy

#### Tiered Rate Limits

```javascript
const RATE_LIMIT_TIERS = {
  // Development (no limits)
  development: {
    hourly: Infinity,
    daily: Infinity,
    burst: Infinity,
    concurrent: Infinity,
  },
  
  // Internal services
  internal: {
    hourly: 10000,
    daily: 200000,
    burst: 100,      // 100 requests per 10 seconds
    concurrent: 50,   // 50 simultaneous requests
  },
  
  // Production (paid customers)
  production_enterprise: {
    hourly: 5000,
    daily: 100000,
    burst: 50,
    concurrent: 25,
  },
  
  production_pro: {
    hourly: 2000,
    daily: 40000,
    burst: 30,
    concurrent: 15,
  },
  
  production_basic: {
    hourly: 1000,
    daily: 20000,
    burst: 20,
    concurrent: 10,
  },
  
  // Restricted public access
  restricted: {
    hourly: 100,
    daily: 1000,
    burst: 5,
    concurrent: 2,
  },
  
  // Anonymous (no API key)
  anonymous: {
    hourly: 10,      // Per IP
    daily: 50,       // Per IP
    burst: 2,
    concurrent: 1,
  },
};
```

#### Rate Limit Algorithm

**Sliding Window Counter** (hybrid approach for accuracy + performance)

```
┌──────────────────────────────────────────────────────────┐
│         Sliding Window Rate Limit Algorithm              │
├──────────────────────────────────────────────────────────┤
│                                                            │
│  Current Window     Previous Window                       │
│  ┌──────────┐       ┌──────────┐                         │
│  │          │       │          │                         │
│  │  count   │   +   │  count   │  * overlap_factor      │
│  │   = 50   │       │  = 80    │    = 0.3               │
│  │          │       │          │                         │
│  └──────────┘       └──────────┘                         │
│       ↓                   ↓                               │
│       50      +      (80 * 0.3)     =   74               │
│                                                            │
│  If 74 < hourly_limit (100): Allow request               │
│  Else: Rate limit (429 Too Many Requests)                │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 5. Middleware Stack

```
Request Flow:
┌──────────────┐
│   Client     │
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────────┐
│  1. CORS Middleware                  │
│     - Origin validation               │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  2. Request Logger                   │
│     - Request ID generation          │
│     - Timing start                   │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  3. API Key Extractor                │
│     - Parse Authorization header     │
│     - Parse X-API-Key header         │
│     - Parse query param (fallback)   │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  4. API Key Validator                │
│     - Verify key hash                │
│     - Check status & expiry          │
│     - Load permissions               │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  5. Permission Checker               │
│     - Verify scope for endpoint      │
│     - Check IP/Origin whitelist      │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  6. Rate Limiter                     │
│     - Check sliding window           │
│     - Check burst limits             │
│     - Check concurrent requests      │
│     - Return 429 if exceeded         │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  7. Usage Logger                     │
│     - Log to api_usage_logs          │
│     - Update last_used_at            │
│     - Increment usage_count          │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  8. Route Handler                    │
│     - Business logic                 │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│  9. Response Headers                 │
│     - X-RateLimit-Limit              │
│     - X-RateLimit-Remaining          │
│     - X-RateLimit-Reset              │
│     - X-Request-ID                   │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────┐
│   Response   │
└──────────────┘
```

### 6. OAuth 2.0 Integration

For users who want OAuth instead of API keys:

```
OAuth 2.0 Flow (Client Credentials Grant):
┌──────────────┐
│   Client     │
└──────┬───────┘
       │
       │ POST /oauth/token
       │ client_id=xxx&client_secret=yyy&grant_type=client_credentials
       ↓
┌──────────────────────────────────────┐
│  OAuth Server (/api/oauth/token)     │
│  - Validate client credentials       │
│  - Generate access token (JWT)       │
│  - Return: { access_token, expires }│
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────┐
│  Access      │
│  Token       │ (JWT with scopes embedded)
│  Returned    │
└──────┬───────┘
       │
       │ GET /api/aircraft/...
       │ Authorization: Bearer <access_token>
       ↓
┌──────────────────────────────────────┐
│  API Endpoint                        │
│  - Validate JWT signature            │
│  - Check expiry                      │
│  - Extract scopes from token         │
│  - Apply rate limits                 │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────┐
│   Response   │
└──────────────┘
```

#### OAuth Token Structure

```javascript
// JWT Payload
{
  "iss": "https://api.flyoverhead.com",
  "sub": "sk_live_9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a",  // API key ID
  "aud": "https://api.flyoverhead.com",
  "exp": 1735689600,  // 1 hour from now
  "iat": 1735686000,
  "scopes": ["aircraft:read", "history:read"],
  "tier": "production_basic",
  "key_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 7. Security Best Practices

#### API Key Management

1. **Key Rotation**
   - Keys should be rotatable without service interruption
   - Support multiple active keys per user
   - Grace period for old keys during rotation

2. **Key Storage**
   - Never log full API keys (only last 4 chars)
   - Hash keys with bcrypt (cost factor 10+)
   - Never return full key after creation

3. **Key Revocation**
   - Immediate revocation support
   - Soft delete (keep for audit)
   - Notification to key owner

#### Rate Limit Bypass for Development

```javascript
// Development key features
const DEV_KEY_FEATURES = {
  bypassRateLimits: true,
  detailedLogging: true,
  accessTestEndpoints: true,
  noExpiry: true,
  
  // Security restrictions still apply
  requireIPWhitelist: true,  // Even dev keys should be IP-restricted
  auditLogging: true,
  
  // Special headers for dev keys
  responseHeaders: {
    'X-Dev-Mode': 'true',
    'X-Cache-Status': 'MISS|HIT',
    'X-Query-Time-Ms': '123',
    'X-Rate-Limit-Bypassed': 'true'
  }
};
```

### 8. Monitoring & Alerting

#### Metrics to Track

```javascript
const METRICS = {
  // Usage metrics
  'api.requests.total': 'counter',
  'api.requests.by_key': 'counter',
  'api.requests.by_endpoint': 'counter',
  'api.response_time': 'histogram',
  
  // Rate limiting metrics
  'api.rate_limit.exceeded': 'counter',
  'api.rate_limit.remaining': 'gauge',
  
  // Security metrics
  'api.auth.invalid_key': 'counter',
  'api.auth.expired_key': 'counter',
  'api.auth.revoked_key': 'counter',
  'api.auth.ip_blocked': 'counter',
  
  // Error metrics
  'api.errors.4xx': 'counter',
  'api.errors.5xx': 'counter',
};
```

#### Alerts

```javascript
const ALERTS = {
  // Security alerts (critical)
  'invalid_key_spike': {
    condition: 'api.auth.invalid_key > 100 in 1 minute',
    severity: 'critical',
    action: 'Auto-block IP, notify security team'
  },
  
  'rate_limit_abuse': {
    condition: 'api.rate_limit.exceeded > 1000 by same key in 5 minutes',
    severity: 'high',
    action: 'Auto-suspend key, notify team'
  },
  
  // Operational alerts (warning)
  'high_error_rate': {
    condition: 'api.errors.5xx > 100 in 5 minutes',
    severity: 'warning',
    action: 'Notify on-call engineer'
  },
  
  'slow_response_time': {
    condition: 'p95(api.response_time) > 2000ms for 5 minutes',
    severity: 'warning',
    action: 'Notify performance team'
  }
};
```

### 9. Admin API Endpoints

New endpoints for API key management:

```
POST   /api/admin/keys                 - Create new API key
GET    /api/admin/keys                 - List all keys (with filters)
GET    /api/admin/keys/:keyId          - Get key details
PUT    /api/admin/keys/:keyId          - Update key (scopes, rate limits)
DELETE /api/admin/keys/:keyId          - Revoke key
POST   /api/admin/keys/:keyId/rotate   - Rotate key (get new key, old still valid for grace period)

GET    /api/admin/usage/:keyId         - Get usage statistics
GET    /api/admin/usage/:keyId/logs    - Get detailed usage logs

POST   /api/admin/organizations        - Create organization
GET    /api/admin/organizations        - List organizations
PUT    /api/admin/organizations/:orgId - Update organization
```

### 10. Backward Compatibility

To maintain backward compatibility:

```javascript
// Gradual migration strategy
const MIGRATION_PLAN = {
  phase1: {
    // Months 1-2: Soft launch
    actions: [
      'Deploy API key system',
      'Keep all endpoints public',
      'Add optional API key support',
      'Monitor adoption'
    ]
  },
  
  phase2: {
    // Months 3-4: Encourage adoption
    actions: [
      'Add rate limits to anonymous access',
      'Higher limits for API key users',
      'Email existing users about API keys',
      'Documentation and examples'
    ]
  },
  
  phase3: {
    // Months 5-6: Enforce
    actions: [
      'Require API keys for high-volume endpoints',
      'Keep basic endpoints public with strict limits',
      'Grace period for migrations'
    ]
  },
  
  phase4: {
    // Months 7+: Full enforcement
    actions: [
      'All endpoints require API key or JWT',
      'Public access limited to health checks',
      'Legacy support deprecated'
    ]
  }
};
```

### 11. Implementation Priority

```
Priority 1 (Week 1-2): Core Infrastructure
├── Database schema migration
├── API key generation utilities
├── API key validation middleware
└── Basic rate limiting

Priority 2 (Week 3-4): Security & Permissions
├── Scope-based authorization
├── IP/Origin whitelisting
├── Development key support (bypass rate limits)
└── Audit logging

Priority 3 (Week 5-6): Admin & Management
├── Admin API endpoints
├── Key rotation support
├── Usage analytics
└── Dashboard UI

Priority 4 (Week 7-8): OAuth & Advanced
├── OAuth 2.0 server
├── JWT token generation
├── Token refresh flow
└── Documentation

Priority 5 (Week 9-10): Monitoring & Polish
├── Metrics collection
├── Alert configuration
├── Load testing
└── Security audit
```

## Configuration

### Environment Variables

```bash
# API Security
API_KEY_SECRET=<random-256-bit-secret>
API_KEY_BCRYPT_ROUNDS=10

# OAuth
OAUTH_JWT_SECRET=<random-256-bit-secret>
OAUTH_JWT_EXPIRES_IN=3600  # 1 hour
OAUTH_REFRESH_EXPIRES_IN=2592000  # 30 days

# Rate Limiting
RATE_LIMIT_REDIS_URL=redis://localhost:6379/1
RATE_LIMIT_ENABLED=true
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=false

# Development
DEV_API_KEY=sk_dev_7f83b1657ff1fc53b92dc18148a1d65d
DEV_KEY_IP_WHITELIST=127.0.0.1,192.168.1.0/24

# Monitoring
SENTRY_DSN=<sentry-dsn>
LOG_LEVEL=info
```

## Testing Strategy

```javascript
// Test coverage requirements
const TESTS = {
  unit: [
    'API key generation',
    'Key validation',
    'Permission checking',
    'Rate limit calculation',
    'Scope matching'
  ],
  
  integration: [
    'End-to-end API key flow',
    'Rate limiting across windows',
    'Permission denied scenarios',
    'Key rotation',
    'OAuth token exchange'
  ],
  
  security: [
    'Brute force protection',
    'Invalid key handling',
    'SQL injection prevention',
    'XSS prevention',
    'CSRF protection'
  ],
  
  performance: [
    'Rate limiter performance (>10k req/s)',
    'Key validation latency (<5ms)',
    'Database query optimization',
    'Redis caching efficiency'
  ],
  
  load: [
    'Sustained 1000 req/s per endpoint',
    'Burst handling (100 req/s spike)',
    'Graceful degradation',
    'Rate limit accuracy under load'
  ]
};
```

## Documentation Requirements

1. **API Documentation** (OpenAPI/Swagger)
2. **Getting Started Guide** (API key creation)
3. **Authentication Guide** (API keys vs OAuth)
4. **Rate Limiting Guide** (limits, headers, handling 429s)
5. **Security Best Practices** (key storage, rotation)
6. **Migration Guide** (for existing users)
7. **Admin Guide** (key management, monitoring)

## Success Criteria

- [ ] Zero security vulnerabilities in audit
- [ ] Sub-5ms latency overhead for auth
- [ ] 99.99% uptime for auth service
- [ ] < 0.1% false positive rate limits
- [ ] 100% API endpoint coverage
- [ ] < 1% customer support tickets related to auth
- [ ] Full audit trail for all key operations

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-08  
**Author:** Staff Engineering Team  
**Status:** Ready for Review

