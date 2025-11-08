# API Keys MVP - Quick Reference Card

## 🚀 Deploy in 3 Steps

```bash
# 1. Migrate database
./migrate-api-keys.sh

# 2. Restart server
npm start

# 3. Test it
./test-api-keys.sh
```

## 📝 Create Your First Key

```bash
# Login
curl -X POST http://localhost:3005/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"password"}'

# Create dev key
curl -X POST http://localhost:3005/api/admin/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Dev Key",
    "type": "development"
  }'

# Save the "key" from response - shown only once!
```

## 🔑 Use Your Key

```bash
# Method 1 (recommended)
curl http://localhost:3005/api/area/all \
  -H "Authorization: Bearer sk_dev_YOUR_KEY"

# Method 2 (alternative)
curl http://localhost:3005/api/area/all \
  -H "X-API-Key: sk_dev_YOUR_KEY"
```

## 📚 Common Commands

```bash
# List all your keys
curl http://localhost:3005/api/admin/keys \
  -H "Authorization: Bearer JWT_TOKEN"

# Get key details
curl http://localhost:3005/api/admin/keys/KEY_ID \
  -H "Authorization: Bearer JWT_TOKEN"

# Update key
curl -X PUT http://localhost:3005/api/admin/keys/KEY_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -d '{"name":"New Name"}'

# Revoke key
curl -X DELETE http://localhost:3005/api/admin/keys/KEY_ID \
  -H "Authorization: Bearer JWT_TOKEN"
```

## 🎯 Key Types

| Type | Prefix | Length | Use Case |
|------|--------|--------|----------|
| Dev | `sk_dev_` | 39 chars | Testing, development |
| Production | `sk_live_` | 40 chars | Production apps |

## 🔒 Security Checklist

- [ ] Keys stored securely (env vars)
- [ ] Never commit keys to git
- [ ] Use HTTPS in production
- [ ] Rotate keys every 90 days
- [ ] Revoke unused keys
- [ ] Monitor last_used_at

## 🐛 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Table doesn't exist | Run `./migrate-api-keys.sh` |
| Invalid key format | Must start with `sk_dev_` or `sk_live_` |
| 401 error | Check key is active, not expired/revoked |
| Connection error | Check `POSTGRES_URL` in .env |

## 📁 Important Files

```
server/
├── migrations/001_create_api_keys_mvp.sql
├── middlewares/apiKeyAuth.js
├── routes/admin.routes.js
├── utils/apiKeyGenerator.js
└── repositories/PostgresRepository.js

Scripts:
├── migrate-api-keys.sh
├── test-api-keys.sh
└── API_KEYS_MVP_README.md (full guide)
```

## ⚡ Features

✅ Dev & Production keys  
✅ Secure bcrypt storage  
✅ Optional auth (no breaking changes)  
✅ Usage tracking  
✅ Key management API  
✅ Comprehensive tests  
✅ Full documentation  

❌ Rate limiting (Phase 2)  
❌ OAuth (Phase 3)  
❌ Organizations (Phase 3)  

## 📖 Full Docs

- `API_KEYS_MVP_README.md` - Complete guide
- `API_KEYS_MVP_SUMMARY.md` - Full summary
- `ARCHITECTURE_API_SECURITY.md` - Architecture
- `docs/API_SECURITY_*.md` - Detailed docs

## 🎉 Success Indicators

After deployment:
- [ ] Migration completes successfully
- [ ] Server starts without errors
- [ ] Can create API keys
- [ ] Can authenticate with keys
- [ ] Existing API calls still work
- [ ] All tests pass

---

**Need Help?** Check `API_KEYS_MVP_README.md` or server logs

