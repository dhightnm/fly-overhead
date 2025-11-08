# API Security Implementation Checklist

## Overview
This document provides a detailed implementation checklist for the API security architecture. Use this as a project management tool to track progress through the implementation phases.

## Phase 1: Database & Core Infrastructure (Week 1-2)

### Database Schema
- [ ] **Create API Keys Table**
  - [ ] Write migration for `api_keys` table
  - [ ] Add indexes (key_hash, user_id, status, key_type)
  - [ ] Add constraints and checks
  - [ ] Test rollback script
  - [ ] **Estimated Time:** 4 hours
  - **Files to create:**
    - `server/migrations/001_create_api_keys_table.sql`
  
- [ ] **Create Rate Limiting Table**
  - [ ] Write migration for `api_rate_limits` table
  - [ ] Add indexes (window_start, api_key_id, ip_address)
  - [ ] Add composite unique constraints
  - [ ] Test with sample data
  - [ ] **Estimated Time:** 3 hours
  - **Files to create:**
    - `server/migrations/002_create_rate_limits_table.sql`

- [ ] **Create Usage Logs Table**
  - [ ] Write migration for `api_usage_logs` table
  - [ ] Add partitioning by month (optional but recommended)
  - [ ] Add indexes for performance
  - [ ] Set up automated partition creation
  - [ ] **Estimated Time:** 4 hours
  - **Files to create:**
    - `server/migrations/003_create_usage_logs_table.sql`

- [ ] **Create Organizations Table**
  - [ ] Write migration for `organizations` table
  - [ ] Add slug unique constraint
  - [ ] Add foreign key to users table
  - [ ] Seed with default organization
  - [ ] **Estimated Time:** 2 hours
  - **Files to create:**
    - `server/migrations/004_create_organizations_table.sql`

### Repository Layer
- [ ] **Update PostgresRepository**
  - [ ] Add `createApiKey(data)` method
  - [ ] Add `getApiKeyByHash(hash)` method
  - [ ] Add `getApiKeyById(keyId)` method
  - [ ] Add `listApiKeysByUserId(userId)` method
  - [ ] Add `updateApiKeyStatus(keyId, status)` method
  - [ ] Add `revokeApiKey(keyId, revokedBy, reason)` method
  - [ ] Add `updateApiKeyUsage(keyId, lastUsedAt)` method
  - [ ] Add `incrementApiKeyUsageCount(keyId)` method
  - [ ] **Estimated Time:** 6 hours
  - **Files to modify:**
    - `server/repositories/PostgresRepository.js`
  
- [ ] **Rate Limiting Repository Methods**
  - [ ] Add `checkRateLimit(keyId, endpoint, window)` method
  - [ ] Add `incrementRateLimit(keyId, endpoint, window)` method
  - [ ] Add `getRateLimitStatus(keyId, endpoint)` method
  - [ ] Add `cleanupExpiredRateLimits()` method (cron job)
  - [ ] **Estimated Time:** 4 hours

- [ ] **Usage Logging Repository Methods**
  - [ ] Add `logApiUsage(data)` method (async, non-blocking)
  - [ ] Add `getUsageStats(keyId, timeRange)` method
  - [ ] Add `getUsageByEndpoint(keyId)` method
  - [ ] **Estimated Time:** 3 hours

### Utilities
- [ ] **API Key Generator**
  - [ ] Create `generateApiKey(type)` function
  - [ ] Support all key types (dev, internal, live, restricted)
  - [ ] Generate secure random hex (32 chars)
  - [ ] Return both plain key and bcrypt hash
  - [ ] **Estimated Time:** 2 hours
  - **Files to create:**
    - `server/utils/apiKeyGenerator.js`

- [ ] **API Key Validator**
  - [ ] Create `validateApiKeyFormat(key)` function
  - [ ] Check prefix and length
  - [ ] Return validation errors
  - [ ] **Estimated Time:** 1 hour
  - **Files to create:**
    - `server/utils/apiKeyValidator.js`

## Phase 2: Middleware & Authentication (Week 3-4)

### Middleware Stack
- [ ] **API Key Extractor Middleware**
  - [ ] Extract from `Authorization: Bearer` header
  - [ ] Extract from `X-API-Key` header (fallback)
  - [ ] Extract from `?api_key=` query param (fallback, not recommended)
  - [ ] Store in `req.apiKey`
  - [ ] **Estimated Time:** 2 hours
  - **Files to create:**
    - `server/middlewares/apiKeyExtractor.js`

- [ ] **API Key Authenticator Middleware**
  - [ ] Query database for key hash
  - [ ] Compare with bcrypt
  - [ ] Check status (active/suspended/revoked)
  - [ ] Check expiry date
  - [ ] Check IP whitelist (if configured)
  - [ ] Check origin whitelist (if configured)
  - [ ] Load scopes and permissions
  - [ ] Store in `req.apiKeyData`
  - [ ] Return 401 if invalid
  - [ ] Return 403 if suspended/revoked
  - [ ] **Estimated Time:** 6 hours
  - **Files to create:**
    - `server/middlewares/apiKeyAuthenticator.js`

- [ ] **JWT Authenticator Update**
  - [ ] Refactor existing `authenticateToken` to be consistent
  - [ ] Extract to standalone middleware file
  - [ ] Add scope support for JWT tokens
  - [ ] **Estimated Time:** 3 hours
  - **Files to modify:**
    - `server/routes/auth.routes.js`
  - **Files to create:**
    - `server/middlewares/jwtAuthenticator.js`

- [ ] **Combined Auth Router Middleware**
  - [ ] Try JWT authentication first
  - [ ] Fall back to API key authentication
  - [ ] Fall back to anonymous (if endpoint allows)
  - [ ] Set `req.auth` object with user info and permissions
  - [ ] **Estimated Time:** 3 hours
  - **Files to create:**
    - `server/middlewares/authRouter.js`

### Authorization & Permissions
- [ ] **Permission Checker Middleware**
  - [ ] Define scope hierarchy
  - [ ] Check if user/key has required scope for endpoint
  - [ ] Support wildcard scopes (`aircraft:*`)
  - [ ] Support global scope (`internal:all`)
  - [ ] Return 403 if insufficient permissions
  - [ ] **Estimated Time:** 4 hours
  - **Files to create:**
    - `server/middlewares/permissionChecker.js`
    - `server/config/scopes.js`

- [ ] **Scope Configuration**
  - [ ] Define all endpoint → scope mappings
  - [ ] Define default scopes by key type
  - [ ] Export as configuration
  - [ ] **Estimated Time:** 2 hours

### Rate Limiting
- [ ] **Redis Setup**
  - [ ] Add Redis to docker-compose
  - [ ] Add Redis client to config
  - [ ] Add connection management
  - [ ] **Estimated Time:** 2 hours
  - **Files to modify:**
    - `docker-compose.yml`
    - `server/config/index.js`

- [ ] **Rate Limiter Middleware**
  - [ ] Implement sliding window counter algorithm
  - [ ] Check both hourly and burst limits
  - [ ] Check concurrent requests
  - [ ] Bypass for development keys
  - [ ] Store rate limit data in Redis
  - [ ] Fall back to PostgreSQL if Redis unavailable
  - [ ] Return 429 with Retry-After header
  - [ ] Add rate limit headers to all responses:
    - `X-RateLimit-Limit`
    - `X-RateLimit-Remaining`
    - `X-RateLimit-Reset`
  - [ ] **Estimated Time:** 8 hours
  - **Files to create:**
    - `server/middlewares/rateLimiter.js`
    - `server/services/RateLimitService.js`

- [ ] **Rate Limit Tiers Configuration**
  - [ ] Define all rate limit tiers
  - [ ] Make configurable via environment variables
  - [ ] **Estimated Time:** 1 hour
  - **Files to create:**
    - `server/config/rateLimits.js`

### Usage Logging
- [ ] **Usage Logger Middleware**
  - [ ] Log request metadata asynchronously
  - [ ] Don't block request/response
  - [ ] Update last_used_at for API key
  - [ ] Increment usage_count
  - [ ] Log to api_usage_logs table
  - [ ] **Estimated Time:** 3 hours
  - **Files to create:**
    - `server/middlewares/usageLogger.js`

- [ ] **Batch Usage Logger**
  - [ ] Buffer logs in memory
  - [ ] Flush to database every 5 seconds or 100 entries
  - [ ] Handle flush on server shutdown
  - [ ] **Estimated Time:** 4 hours
  - **Files to create:**
    - `server/services/UsageLoggerService.js`

## Phase 3: Admin Endpoints & Management (Week 5-6)

### Admin Routes
- [ ] **Create API Key Endpoint**
  - [ ] `POST /api/admin/keys`
  - [ ] Validate request body
  - [ ] Generate key and hash
  - [ ] Store in database
  - [ ] Return key ONCE (never again)
  - [ ] Require admin permission
  - [ ] **Estimated Time:** 3 hours
  - **Files to create:**
    - `server/routes/admin.routes.js`

- [ ] **List API Keys Endpoint**
  - [ ] `GET /api/admin/keys`
  - [ ] Support filtering (status, type, user_id)
  - [ ] Support pagination
  - [ ] Never return key_hash or full key
  - [ ] Return last 4 chars only
  - [ ] **Estimated Time:** 2 hours

- [ ] **Get API Key Details Endpoint**
  - [ ] `GET /api/admin/keys/:keyId`
  - [ ] Return key metadata
  - [ ] Return usage statistics
  - [ ] Return last used timestamp
  - [ ] **Estimated Time:** 2 hours

- [ ] **Update API Key Endpoint**
  - [ ] `PUT /api/admin/keys/:keyId`
  - [ ] Allow updating: name, description, scopes, rate_limit_tier
  - [ ] Disallow updating: key_hash, key_type
  - [ ] Audit changes
  - [ ] **Estimated Time:** 3 hours

- [ ] **Revoke API Key Endpoint**
  - [ ] `DELETE /api/admin/keys/:keyId`
  - [ ] Soft delete (set status to 'revoked')
  - [ ] Record revoked_by and revoked_reason
  - [ ] Send notification to key owner
  - [ ] **Estimated Time:** 2 hours

- [ ] **Rotate API Key Endpoint**
  - [ ] `POST /api/admin/keys/:keyId/rotate`
  - [ ] Generate new key
  - [ ] Keep old key valid for grace period (7 days)
  - [ ] Return new key
  - [ ] Send notification to key owner
  - [ ] **Estimated Time:** 4 hours

### Usage Analytics Endpoints
- [ ] **Get Usage Statistics**
  - [ ] `GET /api/admin/usage/:keyId`
  - [ ] Aggregate by day/week/month
  - [ ] Return request counts
  - [ ] Return success/error rates
  - [ ] Return top endpoints
  - [ ] **Estimated Time:** 4 hours

- [ ] **Get Detailed Usage Logs**
  - [ ] `GET /api/admin/usage/:keyId/logs`
  - [ ] Support date range filtering
  - [ ] Support endpoint filtering
  - [ ] Support pagination
  - [ ] Return detailed log entries
  - [ ] **Estimated Time:** 3 hours

### Organization Management
- [ ] **Create Organization Endpoint**
  - [ ] `POST /api/admin/organizations`
  - [ ] Validate organization data
  - [ ] Create organization
  - [ ] Set default rate limits
  - [ ] **Estimated Time:** 2 hours

- [ ] **List Organizations Endpoint**
  - [ ] `GET /api/admin/organizations`
  - [ ] Support filtering and pagination
  - [ ] Return org stats (key count, usage)
  - [ ] **Estimated Time:** 2 hours

- [ ] **Update Organization Endpoint**
  - [ ] `PUT /api/admin/organizations/:orgId`
  - [ ] Update tier, quotas, limits
  - [ ] Audit changes
  - [ ] **Estimated Time:** 2 hours

## Phase 4: OAuth 2.0 Implementation (Week 7-8)

### OAuth Server
- [ ] **OAuth Token Endpoint**
  - [ ] `POST /oauth/token`
  - [ ] Support client_credentials grant
  - [ ] Validate client_id and client_secret
  - [ ] Generate JWT access token
  - [ ] Embed scopes in JWT
  - [ ] Set expiration (1 hour)
  - [ ] **Estimated Time:** 6 hours
  - **Files to create:**
    - `server/routes/oauth.routes.js`
    - `server/services/OAuthService.js`

- [ ] **OAuth Token Refresh** (Optional)
  - [ ] Support refresh_token grant
  - [ ] Issue refresh tokens (30 days)
  - [ ] Rotate refresh tokens
  - [ ] **Estimated Time:** 4 hours

- [ ] **JWT Validation for OAuth**
  - [ ] Verify JWT signature
  - [ ] Check expiration
  - [ ] Extract scopes from token
  - [ ] Store in req.auth
  - [ ] **Estimated Time:** 3 hours

- [ ] **OAuth Client Registration**
  - [ ] Store client_id and client_secret in api_keys table
  - [ ] Link to organizations
  - [ ] **Estimated Time:** 2 hours

## Phase 5: Testing & Documentation (Week 9-10)

### Unit Tests
- [ ] **API Key Generation Tests**
  - [ ] Test all key types
  - [ ] Test format validation
  - [ ] Test uniqueness
  - [ ] **Estimated Time:** 2 hours

- [ ] **Authentication Tests**
  - [ ] Test valid API key
  - [ ] Test invalid API key
  - [ ] Test expired key
  - [ ] Test revoked key
  - [ ] Test suspended key
  - [ ] **Estimated Time:** 3 hours

- [ ] **Authorization Tests**
  - [ ] Test scope checking
  - [ ] Test wildcard scopes
  - [ ] Test insufficient permissions
  - [ ] **Estimated Time:** 3 hours

- [ ] **Rate Limiting Tests**
  - [ ] Test sliding window calculation
  - [ ] Test burst protection
  - [ ] Test dev key bypass
  - [ ] Test concurrent requests
  - [ ] **Estimated Time:** 4 hours

### Integration Tests
- [ ] **End-to-End API Key Flow**
  - [ ] Create key → Use key → Revoke key
  - [ ] Test all endpoints with API key
  - [ ] **Estimated Time:** 3 hours

- [ ] **Rate Limiting Flow**
  - [ ] Test hitting rate limit
  - [ ] Test 429 response
  - [ ] Test rate limit reset
  - [ ] **Estimated Time:** 3 hours

- [ ] **OAuth Flow**
  - [ ] Token generation → Use token → Expire token
  - [ ] **Estimated Time:** 2 hours

### Load Testing
- [ ] **Rate Limiter Performance**
  - [ ] Test with 10k req/s
  - [ ] Measure latency overhead
  - [ ] Test Redis performance
  - [ ] **Estimated Time:** 4 hours

- [ ] **Authentication Performance**
  - [ ] Test bcrypt performance
  - [ ] Test JWT verification performance
  - [ ] Identify bottlenecks
  - [ ] **Estimated Time:** 3 hours

### Security Testing
- [ ] **Penetration Testing**
  - [ ] Test brute force protection
  - [ ] Test SQL injection
  - [ ] Test XSS vulnerabilities
  - [ ] Test CSRF vulnerabilities
  - [ ] **Estimated Time:** 8 hours

- [ ] **Security Audit**
  - [ ] Code review for security issues
  - [ ] Dependency audit (npm audit)
  - [ ] OWASP Top 10 checklist
  - [ ] **Estimated Time:** 4 hours

### Documentation
- [ ] **API Documentation (OpenAPI/Swagger)**
  - [ ] Document all admin endpoints
  - [ ] Document authentication methods
  - [ ] Document rate limiting
  - [ ] Add examples
  - [ ] **Estimated Time:** 8 hours

- [ ] **Getting Started Guide**
  - [ ] How to create API key
  - [ ] How to use API key
  - [ ] Code examples (curl, JavaScript, Python)
  - [ ] **Estimated Time:** 4 hours

- [ ] **Authentication Guide**
  - [ ] API Keys vs OAuth
  - [ ] When to use each
  - [ ] Security best practices
  - [ ] **Estimated Time:** 3 hours

- [ ] **Rate Limiting Guide**
  - [ ] Understanding limits
  - [ ] Rate limit headers
  - [ ] Handling 429 responses
  - [ ] Retry strategies
  - [ ] **Estimated Time:** 3 hours

- [ ] **Migration Guide**
  - [ ] For existing users
  - [ ] Backward compatibility
  - [ ] Timeline
  - [ ] **Estimated Time:** 3 hours

## Phase 6: Deployment & Monitoring (Week 11-12)

### Deployment
- [ ] **Database Migrations**
  - [ ] Run migrations on staging
  - [ ] Verify data integrity
  - [ ] Run migrations on production
  - [ ] **Estimated Time:** 2 hours

- [ ] **Environment Configuration**
  - [ ] Set all environment variables
  - [ ] Generate dev API key
  - [ ] Configure Redis
  - [ ] **Estimated Time:** 2 hours

- [ ] **Deploy to Staging**
  - [ ] Deploy new code
  - [ ] Run smoke tests
  - [ ] Verify all endpoints
  - [ ] **Estimated Time:** 3 hours

- [ ] **Deploy to Production**
  - [ ] Blue-green deployment
  - [ ] Monitor for errors
  - [ ] Rollback plan ready
  - [ ] **Estimated Time:** 4 hours

### Monitoring
- [ ] **Metrics Collection**
  - [ ] Set up Prometheus/Grafana (or similar)
  - [ ] Define all metrics
  - [ ] Create dashboards
  - [ ] **Estimated Time:** 6 hours

- [ ] **Alerting**
  - [ ] Configure critical alerts
  - [ ] Configure warning alerts
  - [ ] Test alert delivery
  - [ ] **Estimated Time:** 4 hours

- [ ] **Logging**
  - [ ] Ensure proper log levels
  - [ ] Set up log aggregation
  - [ ] Create log queries
  - [ ] **Estimated Time:** 3 hours

### Post-Launch
- [ ] **Monitor Performance**
  - [ ] Track latency
  - [ ] Track error rates
  - [ ] Track rate limit hits
  - [ ] **Estimated Time:** Ongoing

- [ ] **Gather Feedback**
  - [ ] User feedback
  - [ ] Bug reports
  - [ ] Feature requests
  - [ ] **Estimated Time:** Ongoing

- [ ] **Iterate**
  - [ ] Fix bugs
  - [ ] Optimize performance
  - [ ] Add features
  - [ ] **Estimated Time:** Ongoing

## Total Estimated Time

- **Phase 1:** 28 hours (2 weeks)
- **Phase 2:** 44 hours (2 weeks)
- **Phase 3:** 35 hours (2 weeks)
- **Phase 4:** 15 hours (1 week)
- **Phase 5:** 47 hours (2 weeks)
- **Phase 6:** 24 hours (1 week)

**Total:** ~193 hours (~1.5 engineer-months)

## Team Assignments (Example)

### Backend Engineer 1 (Lead)
- Database schema and migrations
- Repository layer
- Middleware stack
- Rate limiting

### Backend Engineer 2
- Admin endpoints
- OAuth implementation
- Usage analytics

### DevOps Engineer
- Redis setup
- Deployment
- Monitoring and alerting

### QA Engineer
- All testing phases
- Load testing
- Security testing

### Technical Writer
- All documentation
- API examples
- Migration guide

## Risk Mitigation

### Risk 1: Performance Impact
**Mitigation:**
- Cache API key lookups
- Use Redis for rate limiting
- Optimize bcrypt rounds (10 is recommended)
- Monitor latency overhead

### Risk 2: Breaking Existing Users
**Mitigation:**
- Gradual rollout (see migration plan)
- Backward compatibility period
- Clear communication
- Documentation

### Risk 3: Redis Failure
**Mitigation:**
- Fallback to PostgreSQL
- Graceful degradation
- Redis clustering for HA

### Risk 4: Rate Limit Accuracy
**Mitigation:**
- Use sliding window (more accurate than fixed)
- Load test thoroughly
- Monitor false positives

## Success Metrics

- [ ] **Performance:** Auth latency < 5ms (p95)
- [ ] **Reliability:** 99.99% uptime for auth service
- [ ] **Accuracy:** < 0.1% false positive rate limits
- [ ] **Coverage:** 100% API endpoint coverage
- [ ] **Security:** Zero critical vulnerabilities in audit
- [ ] **Adoption:** 80% of traffic using API keys within 3 months
- [ ] **Support:** < 1% support tickets related to auth

---

**Last Updated:** 2025-11-08  
**Status:** Ready for Implementation

