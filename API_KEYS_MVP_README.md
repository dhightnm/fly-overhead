# API Key Authentication MVP - Implementation Guide

## Overview

This MVP implements a simple, production-ready API key authentication system for the Fly Overhead platform. It follows the "Month 1 Soft Launch" strategy where:

- ✅ API key authentication is implemented
- ✅ Authentication is **optional** (doesn't break existing users)
- ✅ Supports dev keys (for testing) and production keys
- ❌ Rate limiting is NOT implemented (comes later)
- ❌ Complex permissions are NOT implemented (just read/write for MVP)

## What's Included

### Database Schema
- `api_keys` table with proper indexes
- Bcrypt hash storage (never store plain keys)
- Automatic timestamp triggers
- Support for dev and production keys

### Utilities
- `apiKeyGenerator.js` - Generate, validate, and mask API keys
- Secure random hex generation
- Format validation

### Repository Methods
- `createApiKey()` - Create new API key
- `validateApiKey()` - Authenticate with API key
- `getApiKeyById()` - Get key details
- `listApiKeys()` - List user's keys
- `updateApiKey()` - Update key metadata
- `revokeApiKey()` - Revoke a key
- `updateApiKeyLastUsed()` - Track usage

### Middleware
- `optionalApiKeyAuth` - Validates key if provided, passes through if not
- `requireApiKeyAuth` - Requires valid API key
- Extracts keys from:
  - `Authorization: Bearer sk_live_...` (preferred)
  - `X-API-Key: sk_live_...` (fallback)
  - `?api_key=sk_live_...` (not recommended, for testing only)

### API Endpoints
All endpoints require JWT authentication:

```
POST   /api/admin/keys          - Create new API key
GET    /api/admin/keys          - List user's API keys
GET    /api/admin/keys/:keyId   - Get specific key details
PUT    /api/admin/keys/:keyId   - Update key (name, description, scopes)
DELETE /api/admin/keys/:keyId   - Revoke key
```

## Installation Steps

### 1. Run Database Migration

```bash
# Make script executable (if not already)
chmod +x migrate-api-keys.sh

# Run migration
./migrate-api-keys.sh
```

This will:
- Create a backup of your database
- Run the migration SQL
- Verify the table was created

**Manual Migration** (if script doesn't work):
```bash
psql $POSTGRES_URL -f server/migrations/001_create_api_keys_mvp.sql
```

### 2. Install Dependencies

The system uses `bcryptjs` which should already be installed. Verify:

```bash
cd server
npm list bcryptjs
```

If not installed:
```bash
npm install bcryptjs
```

### 3. Restart Server

```bash
# From project root
npm start

# Or if using PM2
pm2 restart all
```

### 4. Verify Installation

Check server logs for:
```
API keys table created or already exists
✓ Database connection established
```

## Usage Examples

### 1. Create a Dev API Key (via API)

First, login to get a JWT token:

```bash
curl -X POST http://localhost:3005/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "yourpassword"
  }'
```

Then create a dev key:

```bash
curl -X POST http://localhost:3005/api/admin/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Development Key",
    "description": "For local testing",
    "type": "development",
    "scopes": ["read", "write"]
  }'
```

Response:
```json
{
  "key": "sk_dev_7f83b1657ff1fc53b92dc18148a1d65d",
  "keyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Development Key",
  "prefix": "sk_dev_",
  "type": "development",
  "scopes": ["read", "write"],
  "createdAt": "2025-11-08T12:00:00Z",
  "warning": "Save this key now! It will not be shown again."
}
```

**⚠️ IMPORTANT:** Save the `key` value - it's only shown once!

### 2. Create a Production API Key

```bash
curl -X POST http://localhost:3005/api/admin/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Production App Key",
    "description": "For my mobile app",
    "type": "production",
    "scopes": ["read"]
  }'
```

### 3. Use an API Key

Now you can use the API key to access endpoints:

```bash
# Method 1: Authorization header (preferred)
curl http://localhost:3005/api/area/all \
  -H "Authorization: Bearer sk_dev_7f83b1657ff1fc53b92dc18148a1d65d"

# Method 2: X-API-Key header
curl http://localhost:3005/api/area/all \
  -H "X-API-Key: sk_dev_7f83b1657ff1fc53b92dc18148a1d65d"

# Method 3: Query parameter (not recommended)
curl "http://localhost:3005/api/area/all?api_key=sk_dev_7f83b1657ff1fc53b92dc18148a1d65d"
```

### 4. List Your API Keys

```bash
curl http://localhost:3005/api/admin/keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. Revoke an API Key

```bash
curl -X DELETE http://localhost:3005/api/admin/keys/YOUR_KEY_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "No longer needed"
  }'
```

## Testing

### Test Valid API Key

```bash
# Should return aircraft data
curl http://localhost:3005/api/area/all \
  -H "Authorization: Bearer sk_dev_YOUR_KEY_HERE"
```

### Test Invalid API Key

```bash
# Should return 401 error
curl http://localhost:3005/api/area/all \
  -H "Authorization: Bearer sk_dev_invalid_key_12345"
```

Expected response:
```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid or has been revoked.",
    "status": 401
  }
}
```

### Test No API Key (Should Still Work - Optional Auth)

```bash
# Should still work (authentication is optional in MVP)
curl http://localhost:3005/api/area/all
```

## API Key Types

### Development Keys (`sk_dev_`)

**Purpose:** Testing and development

**Characteristics:**
- Prefix: `sk_dev_`
- Length: 39 characters (7 + 32)
- Example: `sk_dev_7f83b1657ff1fc53b92dc18148a1d65d`
- No rate limiting (for MVP; will have higher limits later)
- Full API access
- Should be IP-restricted in production

**When to use:**
- Local development
- Testing
- CI/CD pipelines
- Staging environments

### Production Keys (`sk_live_`)

**Purpose:** Production applications

**Characteristics:**
- Prefix: `sk_live_`
- Length: 40 characters (8 + 32)
- Example: `sk_live_9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a`
- Standard rate limiting (when implemented)
- Scoped permissions
- Full audit logging

**When to use:**
- Production applications
- Customer-facing services
- Public APIs

## Security Best Practices

### ✅ DO:

1. **Store keys securely**
   - Use environment variables
   - Never commit keys to git
   - Use secrets management in production

2. **Rotate keys regularly**
   - Every 90 days for production
   - When team members leave
   - If compromised

3. **Use HTTPS**
   - Always use HTTPS in production
   - Keys in HTTP headers are visible

4. **Restrict by IP** (when available)
   - Add IP whitelist for production keys
   - Limit dev keys to VPN/office IPs

5. **Monitor usage**
   - Check `last_used_at` regularly
   - Revoke unused keys
   - Watch for unusual patterns

### ❌ DON'T:

1. **Never commit keys to git**
   ```bash
   # Add to .gitignore
   echo ".env" >> .gitignore
   echo "*.key" >> .gitignore
   ```

2. **Never share keys via email/Slack**
   - Use secure sharing tools
   - Rotate after sharing

3. **Never log full keys**
   - Use `maskApiKey()` utility
   - Only log last 4 characters

4. **Never use query parameters in production**
   - URLs are logged everywhere
   - Use Authorization header

5. **Never give overly broad permissions**
   - Follow principle of least privilege
   - Use scopes appropriately

## Troubleshooting

### Error: "table api_keys does not exist"

**Solution:**
```bash
./migrate-api-keys.sh
```

### Error: "Invalid API key format"

**Cause:** Key doesn't start with `sk_dev_` or `sk_live_`

**Solution:** Regenerate key via API

### Error: "ECONNREFUSED" connecting to database

**Cause:** Database not running or wrong POSTGRES_URL

**Solution:**
```bash
# Check database
docker ps | grep postgres

# Check .env file
cat .env | grep POSTGRES_URL

# Test connection
psql $POSTGRES_URL -c "SELECT 1;"
```

### Keys not being validated

**Cause:** Bcrypt comparison failing

**Solution:**
```bash
# Check bcryptjs is installed
cd server && npm list bcryptjs

# Restart server
npm start
```

### Migration fails with "already exists"

**Cause:** Table already created

**Solution:** This is OK - table already exists

To rollback and recreate:
```bash
psql $POSTGRES_URL -f server/migrations/001_rollback_api_keys_mvp.sql
./migrate-api-keys.sh
```

## Rollback

If you need to rollback the migration:

```bash
psql $POSTGRES_URL -f server/migrations/001_rollback_api_keys_mvp.sql
```

This will:
- Drop the `api_keys` table
- Drop all indexes
- Drop the trigger and function

## Next Steps (Future Phases)

### Phase 2: Rate Limiting
- Redis-backed rate limiter
- Sliding window algorithm
- Dev key bypass
- Rate limit headers

### Phase 3: OAuth 2.0
- Client credentials grant
- JWT access tokens
- Refresh tokens

### Phase 4: Advanced Features
- Organizations/teams
- Detailed usage analytics
- Webhook support
- Custom rate limits per key

## Support

### Documentation
- Architecture: `ARCHITECTURE_API_SECURITY.md`
- Diagrams: `docs/API_SECURITY_DIAGRAMS.md`
- Full Checklist: `docs/API_SECURITY_CHECKLIST.md`
- Migration Plan: `docs/API_SECURITY_MIGRATION.md`

### Logs
Check server logs for authentication events:
```bash
# PM2
pm2 logs

# Docker
docker logs fly-overhead-server

# Direct
tail -f logs/combined.log
```

### Common Log Messages

**Success:**
```
API key authenticated { keyId: '...', name: 'Dev Key', type: 'development' }
API key created { keyId: '...', name: 'My Key' }
```

**Errors:**
```
Invalid API key { masked: 'sk_dev_****abcd', path: '/api/area/all' }
API key authentication error { error: 'bcrypt compare failed' }
```

## Questions?

- Check the logs first
- Review the architecture docs
- Test with curl examples
- Check database: `psql $POSTGRES_URL -c "SELECT * FROM api_keys;"`

---

**Version:** MVP 1.0  
**Last Updated:** 2025-11-08  
**Status:** Ready for Testing

