# AWS Deployment Quick Reference

## Architecture (Option 2)

- **EC2 Instance**: t3.large (web server + worker via PM2)
- **RDS PostgreSQL**: db.t3.small (managed database)
- **Application Load Balancer**: Routes traffic to EC2

## Quick Start Commands

### PM2 Management
```bash
# Start both processes
pm2 start ecosystem.config.js

# View status
pm2 list

# View logs
pm2 logs

# Restart all
pm2 restart all

# Stop all
pm2 stop all

# Setup auto-start on boot
pm2 save
pm2 startup
```

### Health Checks
- Web server: `http://your-ec2-ip:3005/api/health`
- Readiness: `http://your-ec2-ip:3005/api/ready`

### Environment Variables
Set these on EC2 (`.env` file):
```
ENABLE_WORKER=false          # Worker runs separately via PM2
POSTGRES_URL=<rds-endpoint> # RDS connection string
NODE_ENV=production
```

## Process Separation

**Web Server** (`server/index.js`):
- Handles HTTP requests
- Serves React static files
- API endpoints
- Does NOT fetch aircraft data (when ENABLE_WORKER=false)

**Worker Process** (`server/worker.js`):
- Fetches aircraft data from OpenSky every 2 minutes
- Runs background route backfills
- Updates database
- Separate process prevents EC2 lockups

## Troubleshooting

### Worker Not Running
```bash
pm2 logs fly-overhead-worker
pm2 restart fly-overhead-worker
```

### Database Connection Issues
```bash
# Test connection
psql $POSTGRES_URL

# Check security groups allow EC2 → RDS
```

### High CPU/Memory
```bash
pm2 monit  # Monitor in real-time
free -h    # Check memory
top        # Check CPU usage
```

See `DEPLOY_AWS_OPTION2.md` for full deployment guide.

