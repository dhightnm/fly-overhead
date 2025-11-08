# API Security Migration Plan

## Executive Summary

This document outlines the migration strategy for implementing API security without disrupting existing users. The migration follows a gradual, phased approach over 6 months with clear communication and support.

## Current State

### Authentication Status
- **Web Users:** JWT-based authentication (login/register/Google OAuth) ✅
- **Feeders:** API key authentication (`sk_live_*` format) ✅
- **API Endpoints:** Mostly public, no authentication required ❌
- **Rate Limiting:** Global rate limiting via `RateLimitManager` for external APIs (OpenSky) ❌
- **Per-User Rate Limiting:** None ❌

### Affected Endpoints

**Currently Public (No Auth Required):**
```
GET  /api/area/*                    - Aircraft in bounding box
GET  /api/planes/:identifier        - Get specific aircraft
GET  /api/route/:identifier         - Get flight route
GET  /api/history/*                 - Historical flight data
GET  /api/spatial/*                 - Spatial queries
GET  /api/airports/*                - Airport data
GET  /api/navaids/*                 - Navaid data
GET  /api/flightplan/*              - Flight plan data
POST /api/area/fetch/*              - Trigger aircraft fetch
```

**Already Protected:**
```
GET  /api/auth/me                   - Get current user (JWT)
POST /api/feeder/aircraft           - Submit aircraft data (Feeder API key)
POST /api/feeder/*                  - Feeder management (Feeder API key)
```

**Public (Will Remain Public):**
```
GET  /api/health                    - Health check
GET  /api/ready                     - Readiness check
GET  /api/opensky-status            - Status endpoint
```

## Migration Strategy

### Timeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    6-MONTH MIGRATION TIMELINE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Month 1-2: Phase 1 - Soft Launch (No Breaking Changes)        │
│  ├─ Deploy API key system                                       │
│  ├─ All endpoints remain public                                 │
│  ├─ Optional API key support                                    │
│  └─ Monitor adoption                                             │
│                                                                  │
│  Month 3-4: Phase 2 - Incentivize Adoption                     │
│  ├─ Add rate limits to anonymous access (generous)             │
│  ├─ Higher limits for API key users                            │
│  ├─ Email campaigns to existing users                          │
│  └─ Documentation and tutorials                                 │
│                                                                  │
│  Month 5: Phase 3 - Transition Period                          │
│  ├─ Require API keys for high-volume endpoints                 │
│  ├─ Keep basic endpoints public with strict limits             │
│  ├─ Grace period for migrations                                │
│  └─ Support for stragglers                                      │
│                                                                  │
│  Month 6: Phase 4 - Full Enforcement                           │
│  ├─ All data endpoints require API key or JWT                  │
│  ├─ Public access limited to health checks                     │
│  ├─ Legacy support deprecated                                  │
│  └─ New features only for authenticated users                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Phase 1: Soft Launch (Month 1-2)

### Goal
Deploy the API key system without breaking any existing functionality. Make API keys optional and start building awareness.

### Actions

#### Week 1-2: Backend Infrastructure
1. **Deploy Database Schema**
   - Run migrations on staging
   - Test thoroughly
   - Run migrations on production during low-traffic window
   - Backup database before migration

2. **Deploy Middleware Stack**
   - Deploy API key extraction middleware
   - Deploy authentication middleware
   - **Make authentication optional** (pass through if no key)
   - Monitor for errors

3. **Deploy Admin Endpoints**
   - `/api/admin/keys/*` (for key management)
   - Restrict to admin users only
   - Test key creation flow

#### Week 3-4: Frontend & Communication
4. **Add API Key Management UI**
   - Create "API Keys" section in user dashboard
   - Allow users to create/view/revoke keys
   - Show "last used" timestamp
   - Provide code examples

5. **Documentation**
   - Publish API key guide
   - Add authentication examples
   - Update API docs with optional authentication

6. **Communication**
   - Blog post: "Introducing API Keys"
   - Email to power users: "Get ready for API keys"
   - In-app banner: "Try our new API keys"

### Rate Limits (Phase 1)

**Anonymous (No API Key):**
- No limits yet (same as current)
- Just tracking and monitoring

**With API Key:**
- 2,000 req/hour (2× what we'll enforce later)
- Showcase the benefit of using API keys

### Metrics to Track
- Number of API keys created
- Number of requests with API keys
- Number of requests without API keys
- Errors in authentication middleware

### Success Criteria
- Zero downtime during deployment
- Zero increase in error rates
- At least 100 API keys created
- At least 10% of requests using API keys

## Phase 2: Incentivize Adoption (Month 3-4)

### Goal
Encourage users to adopt API keys by introducing rate limits for anonymous access while keeping them generous enough not to break anyone.

### Actions

#### Week 5-6: Rate Limiting Rollout
1. **Deploy Rate Limiting Middleware**
   - Start with Redis caching
   - Add rate limit headers to all responses
   - Log rate limit hits (don't block yet)

2. **Add Monitoring**
   - Dashboard for rate limit metrics
   - Alert on unusual patterns
   - Track per-IP and per-key usage

#### Week 7-8: Anonymous Rate Limits
3. **Enable Generous Anonymous Limits**
   - 100 requests/hour per IP (generous starter)
   - 500 requests/day per IP
   - Return 429 with helpful message

4. **Update Frontend**
   - Show rate limit remaining in dashboard
   - Show upgrade path (create API key)
   - Progress bar for daily quota

### Rate Limits (Phase 2)

**Anonymous (No API Key):**
```
Hourly:  100 requests (per IP)
Daily:   500 requests (per IP)
Burst:   10 requests per 10 seconds
Message: "You're using anonymous access. Create a free API key for higher limits!"
```

**With API Key (Free Tier):**
```
Hourly:  1,000 requests
Daily:   20,000 requests
Burst:   20 requests per 10 seconds
Message: "Upgrade to Pro for even higher limits!"
```

### Communication (Phase 2)

1. **Week 5 Email Campaign:**
   ```
   Subject: Important: Rate Limits Coming Soon

   Hi there,

   To ensure fair usage and maintain high quality service, we're
   introducing rate limits for our API starting next month.

   Good news: Creating a free API key gives you 10x higher limits!

   Create your API key now: [Link to dashboard]

   Current usage: XX requests/day
   New limits (no key): 500 requests/day
   New limits (with key): 20,000 requests/day

   Questions? Reply to this email.

   Best,
   The Fly Overhead Team
   ```

2. **Week 7 In-App Notifications:**
   - Banner: "You're close to the rate limit! Create a free API key"
   - Toast on 429 response: "Rate limit reached. Get 20x more with an API key"

### Metrics to Track
- Adoption rate (% of requests with API keys)
- Rate limit hit rate
- Support ticket volume
- User feedback

### Success Criteria
- 50% of requests using API keys
- < 5% rate limit violations
- < 10 support tickets per week
- Positive user feedback

## Phase 3: Transition Period (Month 5)

### Goal
Require API keys for high-volume endpoints while maintaining basic access for casual users.

### Actions

#### Week 9-10: High-Volume Endpoints
1. **Require API Keys for High-Volume Endpoints**
   - `/api/area/*` - Requires API key
   - `/api/spatial/*` - Requires API key
   - `/api/history/*` - Requires API key
   - Keep basic endpoints public (with limits)

2. **Basic Endpoints Stay Public**
   - `/api/planes/:id` - Public (low limits)
   - `/api/airports/:code` - Public (low limits)
   - `/api/route/:id` - Public (low limits)

#### Week 11-12: Grace Period
3. **Grace Period for Stragglers**
   - Monitor 401 errors
   - Reach out proactively to affected users
   - Offer migration support
   - Extend grace period if needed

### Rate Limits (Phase 3)

**Anonymous (No API Key) - Basic Endpoints Only:**
```
Hourly:  20 requests (per IP)
Daily:   100 requests (per IP)
Endpoints: /api/planes/:id, /api/airports/:code, /api/route/:id
Message: "Anonymous access is limited. Create a free API key for full access."
```

**High-Volume Endpoints:**
```
Anonymous: 403 Forbidden
Message: "This endpoint requires an API key. Create one for free at [link]"
```

**With API Key:**
```
Hourly:  1,000 requests (unchanged)
Daily:   20,000 requests (unchanged)
All endpoints: Full access
```

### Communication (Phase 3)

1. **Week 9 Email to Remaining Users:**
   ```
   Subject: Action Required: Create Your API Key

   Hi there,

   In 2 weeks, some endpoints will require an API key.

   Affected endpoints:
   - /api/area/* (aircraft searches)
   - /api/spatial/* (spatial queries)
   - /api/history/* (historical data)

   Don't worry - creating an API key is free and takes 30 seconds:
   [Link to dashboard]

   Need help? We're here: support@flyoverhead.com

   Best,
   The Fly Overhead Team
   ```

2. **Week 11 Final Warning:**
   - Email to users still not using API keys
   - Highlight impacted endpoints
   - Offer 1-on-1 support

### Metrics to Track
- 401/403 error rates
- Support ticket volume
- Migration completion rate
- User complaints

### Success Criteria
- > 90% of traffic using API keys
- < 1% 401/403 errors
- < 20 support tickets per week
- Successful migrations

## Phase 4: Full Enforcement (Month 6)

### Goal
Complete the migration. All data endpoints require authentication. Focus on new features for authenticated users.

### Actions

#### Week 13-14: Full Enforcement
1. **Require Authentication Everywhere**
   - All `/api/*` endpoints require API key or JWT
   - Except health checks: `/api/health`, `/api/ready`
   - Return 401 for unauthenticated requests

2. **Deprecate Legacy Support**
   - Remove backward compatibility code
   - Clean up old rate limiting logic
   - Archive migration documentation

#### Week 15-16: New Features
3. **Authenticated-Only Features**
   - Personal dashboards
   - Saved searches
   - Custom alerts
   - Enhanced data access

### Rate Limits (Phase 4)

**No More Anonymous Access** (except health checks)

**API Key Tiers:**

```
Free Tier:
  Hourly:  1,000 requests
  Daily:   20,000 requests
  All endpoints: Full access

Basic Tier ($19/month):
  Hourly:  2,000 requests
  Daily:   40,000 requests
  Premium features

Pro Tier ($49/month):
  Hourly:  5,000 requests
  Daily:   100,000 requests
  Premium features + Support

Enterprise (Custom):
  Custom limits
  SLA guarantees
  Dedicated support
```

### Communication (Phase 4)

1. **Week 13 Announcement:**
   ```
   Subject: Migration Complete! What's Next?

   Hi there,

   We've successfully migrated to API key authentication!

   ✅ 10,000+ API keys created
   ✅ 95% of traffic authenticated
   ✅ Improved security and reliability

   What's next?
   - Personal dashboards (coming soon)
   - Custom alerts
   - Premium tiers with higher limits

   Thank you for your support!

   Best,
   The Fly Overhead Team
   ```

2. **Blog Post: "Migration Complete"**
   - Thank users
   - Share statistics
   - Announce new features
   - Roadmap for next quarter

### Metrics to Track
- 100% API key adoption
- Zero 401 errors from legitimate users
- User satisfaction scores
- Revenue from premium tiers

### Success Criteria
- 100% of traffic authenticated
- < 5 support tickets per week
- Positive user feedback
- Revenue growth from tiers

## Developer Experience (API Key)

### Key Creation Flow

```
┌──────────────────────────────────────────────────────────┐
│  Step 1: Navigate to Dashboard                           │
│  https://flyoverhead.com/dashboard/api-keys             │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────────┐
│  Step 2: Click "Create API Key"                          │
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Name: My App                                    │   │
│  │  Description: Production API key for my app     │   │
│  │  Permissions: ☑ Aircraft Data                   │   │
│  │               ☑ Historical Data                 │   │
│  │               ☑ Airport Data                    │   │
│  │                                                   │   │
│  │  [Create Key]                                    │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────────┐
│  Step 3: Copy Your API Key (shown only once!)            │
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ⚠️  Save this key now! You won't see it again. │   │
│  │                                                   │   │
│  │  sk_live_9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a      │   │
│  │                                                   │   │
│  │  [Copy to Clipboard] ✅ Copied!                  │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────────┐
│  Step 4: Use in Your App                                 │
│                                                           │
│  curl https://api.flyoverhead.com/api/aircraft \        │
│    -H "Authorization: Bearer sk_live_9d0e1f2a..."       │
│                                                           │
│  Or in JavaScript:                                       │
│  fetch('https://api.flyoverhead.com/api/aircraft', {    │
│    headers: {                                            │
│      'Authorization': 'Bearer sk_live_9d0e1f2a...'      │
│    }                                                     │
│  })                                                      │
└──────────────────────────────────────────────────────────┘
```

### Error Messages (User-Friendly)

#### Missing API Key
```json
{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "This endpoint requires an API key.",
    "status": 401,
    "help": {
      "title": "How to get an API key",
      "steps": [
        "Go to https://flyoverhead.com/dashboard/api-keys",
        "Click 'Create API Key'",
        "Copy your key and add it to your requests"
      ],
      "example": "Authorization: Bearer sk_live_YOUR_KEY_HERE"
    },
    "documentation": "https://docs.flyoverhead.com/authentication"
  }
}
```

#### Rate Limit Exceeded
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "You've exceeded your rate limit. Create a free API key for 10x higher limits!",
    "status": 429,
    "details": {
      "limit": 100,
      "remaining": 0,
      "reset": 1735689600,
      "resetIn": "45 minutes"
    },
    "help": {
      "title": "How to get higher limits",
      "action": "Create a free API key at https://flyoverhead.com/dashboard/api-keys",
      "benefit": "Free API keys get 1,000 requests/hour (10x more!)"
    }
  }
}
```

## Communication Templates

### Email Templates

#### Template 1: Introduction (Phase 1)
```
Subject: Introducing API Keys for Fly Overhead

Hi [Name],

Great news! We're introducing API keys to give you more control and
better performance when using Fly Overhead.

What are API keys?
API keys are unique identifiers that let us provide you with:
✓ Higher rate limits (10x more requests)
✓ Better performance
✓ Usage analytics
✓ Priority support

How do I get one?
It's free and takes 30 seconds:
1. Go to https://flyoverhead.com/dashboard/api-keys
2. Click "Create API Key"
3. Copy and use in your app

Nothing changes right now - this is completely optional.

Questions? Just hit reply!

Best,
[Your Name]
The Fly Overhead Team
```

#### Template 2: Incentive (Phase 2)
```
Subject: Your API Usage - Action Recommended

Hi [Name],

We noticed you're making [XX] requests per day to our API.

Good news: You can make 20,000 requests per day with a free API key!

Your current usage: [XX] requests/day
Without API key: 500 requests/day (new limit)
With free API key: 20,000 requests/day

This takes 30 seconds:
https://flyoverhead.com/dashboard/api-keys

The new limits take effect in 2 weeks (Date).

Questions? We're here to help!

Best,
[Your Name]
The Fly Overhead Team
```

#### Template 3: Requirement (Phase 3)
```
Subject: Action Required: API Key Needed for [Endpoints]

Hi [Name],

In 1 week (Date), these endpoints will require an API key:
• /api/area/* (aircraft searches)
• /api/spatial/* (spatial queries)  
• /api/history/* (historical data)

Don't worry - it's free and easy:
https://flyoverhead.com/dashboard/api-keys

Need help? Book a 15-min call with us:
[Calendly link]

Or reply to this email.

Best,
[Your Name]
The Fly Overhead Team
```

## Rollback Plan

### When to Rollback
- Error rate > 5% after deployment
- User complaints > 50 in first hour
- Critical bug discovered
- Database issues

### How to Rollback

1. **Immediate Rollback (< 1 hour)**
   ```bash
   # Revert database migrations
   cd server
   npm run db:rollback
   
   # Revert code deployment
   git revert HEAD
   git push origin master
   
   # Or rollback via deployment platform
   # (Kubernetes, Heroku, AWS, etc.)
   ```

2. **Disable Enforcement (< 5 minutes)**
   ```bash
   # Set environment variable to disable auth
   export API_AUTH_REQUIRED=false
   
   # Restart server
   pm2 restart all
   ```

3. **Gradual Rollback**
   - Keep database schema (don't lose created keys)
   - Disable authentication requirements
   - Keep API key creation functional
   - Fix issues and redeploy

## Support Plan

### Support Resources

1. **Documentation**
   - Getting Started Guide
   - API Key Guide
   - Migration FAQ
   - Code Examples

2. **Support Channels**
   - Email: support@flyoverhead.com
   - Discord: #api-keys channel
   - GitHub Issues: for bugs
   - 1-on-1 calls: for enterprise users

3. **Self-Service**
   - Dashboard with usage metrics
   - API key management UI
   - Rate limit visibility
   - Error messages with help

### Support Team Preparation

- **Train support team** on API key system
- **Create response templates** for common questions
- **Set up monitoring** for support volume
- **Assign dedicated engineer** during migration

## Success Metrics

### Quantitative
- [ ] 95% API key adoption by end of Phase 4
- [ ] < 1% error rate during migration
- [ ] < 50 support tickets per phase
- [ ] Zero data loss
- [ ] < 5ms auth latency overhead

### Qualitative
- [ ] Positive user feedback
- [ ] No major complaints on social media
- [ ] Successful migrations
- [ ] Improved developer experience

## Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Users don't adopt API keys | High | Medium | Clear communication, generous grace period |
| Performance degradation | High | Low | Load testing, caching, monitoring |
| Breaking existing integrations | Critical | Medium | Gradual rollout, backward compatibility |
| Support overwhelm | Medium | Medium | Good documentation, self-service tools |
| Security vulnerabilities | Critical | Low | Security audit, penetration testing |
| Database migration issues | High | Low | Thorough testing, rollback plan |

---

**Last Updated:** 2025-11-08  
**Status:** Ready for Implementation  
**Owner:** Engineering Team

