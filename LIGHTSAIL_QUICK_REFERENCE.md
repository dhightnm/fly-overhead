# Lightsail Deployment Quick Reference

## 🚀 Quick Start Checklist

### 1. Create Database Backup
```bash
./lightsail-backup-and-migrate.sh
```
OR
```bash
./quick-backup.sh
```

### 2. Set Up Lightsail Services

**Container Service:**
- Power: Small (1 vCPU, 2 GB RAM) recommended
- Scale: 1 container
- Port: 3005 (HTTP)

**Database:**
- Engine: PostgreSQL 15
- Plan: db.t3.micro (minimum) or db.t3.small (recommended)
- Enable PostGIS extension after creation

### 3. Push Docker Image

**Using ECR (Recommended):**
```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

docker tag fly-overhead:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/fly-overhead:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/fly-overhead:latest
```

**Using Docker Hub:**
```bash
docker tag fly-overhead:latest <USERNAME>/fly-overhead:latest
docker push <USERNAME>/fly-overhead:latest
```

### 4. Required Environment Variables

Add these in Lightsail container service configuration:

```
PORT=3005
NODE_ENV=production
HOST=0.0.0.0
POSTGRES_URL=postgresql://postgres:PASSWORD@ENDPOINT:5432/fly_overhead
OPENSKY_USER=dhight
OPENSKY_PASS=YOUR_OPENSKY_PASSWORD
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-7309
GOOGLE_CLIENT_ID=690273174931-b4g9ipgkvmbk2as7fmj92p5o6svvnvc0.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=postmessage
FLIGHTAWARE_API_KEY=YOUR_FLIGHTAWARE_API_KEY
N2YO_API_KEY=YOUR_N2YO_API_KEY
AWS_REGION=us-east-1
REACT_APP_API_URL=https://your-domain.com
```

**⚠️ Important:** Replace:
- `PASSWORD` with your Lightsail database password
- `ENDPOINT` with your Lightsail database endpoint
- `your-domain.com` with your actual domain

### 5. Enable PostGIS on Database

```bash
psql -h YOUR_DB_ENDPOINT -U postgres -d fly_overhead
CREATE EXTENSION IF NOT EXISTS postgis;
\q
```

### 6. Restore Database Backup

**From local machine (if database is accessible):**
```bash
gunzip -c ./backups/fly_overhead_LIGHTSAIL_MIGRATION_*.sql.gz | \
  psql -h YOUR_DB_ENDPOINT -U postgres -d fly_overhead -v ON_ERROR_STOP=1
```

**From Lightsail instance:**
1. Create temporary Lightsail instance
2. Upload backup file via SCP
3. Install PostgreSQL client: `sudo apt-get install postgresql-client-15`
4. Run restore command above

### 7. Deploy Container

1. In Lightsail console → Container service
2. Create deployment
3. Add container:
   - Image: Your ECR/Docker Hub image
   - Port: 3005
   - Environment variables: All from step 4
4. Enable public endpoint
5. Save and deploy

### 8. Update Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. APIs & Services → Credentials
3. Add to **Authorized JavaScript origins**:
   - `https://your-domain.com`
4. Add to **Authorized redirect URIs**:
   - `https://your-domain.com/api/auth/google/callback`

### 9. Verify Deployment

```bash
# Health check
curl https://your-domain.com/api/health

# Readiness check
curl https://your-domain.com/api/ready
```

---

## 📋 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3005` |
| `NODE_ENV` | Environment | `production` |
| `HOST` | Server host | `0.0.0.0` |
| `POSTGRES_URL` | Database connection string | `postgresql://user:pass@host:5432/db` |
| `OPENSKY_USER` | OpenSky username | `dhight` |
| `OPENSKY_PASS` | OpenSky password | `YOUR_OPENSKY_PASSWORD` |
| `JWT_SECRET` | JWT signing secret | (generate strong secret) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | (from Google Console) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | (from Google Console) |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | `postmessage` |
| `FLIGHTAWARE_API_KEY` | FlightAware API key | (your key) |
| `N2YO_API_KEY` | N2YO API key | (your key) |
| `AWS_REGION` | AWS region | `us-east-1` |
| `REACT_APP_API_URL` | Frontend API URL | `https://your-domain.com` |

---

## 🔧 Troubleshooting

### Container won't start
- Check logs in Lightsail console
- Verify all environment variables are set
- Check database connection string

### Database connection fails
- Verify database endpoint and credentials
- Check firewall/security group rules
- Ensure PostGIS extension is enabled

### Application errors
- Check container logs
- Verify environment variables
- Test database connection manually

---

## 💰 Estimated Costs

- **Container Service (Small)**: ~$20/month
- **Database (db.t3.small)**: ~$30/month
- **Total**: ~$50/month

---

## 📚 Full Documentation

See `LIGHTSAIL_DEPLOYMENT_GUIDE.md` for complete step-by-step instructions.


