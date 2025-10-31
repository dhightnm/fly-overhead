# AWS Deployment Guide - Option 2 (EC2 + RDS)

## Overview
Budget-friendly deployment with EC2 for compute and RDS for database. Worker process runs separately to prevent lockups.

## Prerequisites
1. AWS Account
2. EC2 instance (t3.large recommended)
3. RDS PostgreSQL instance (db.t3.small minimum)
4. Domain: flyoverhead.com (in Route53 or elsewhere)

## Step 1: Set Up RDS PostgreSQL

### Create RDS Instance
```bash
# Via AWS Console or CLI
aws rds create-db-instance \
  --db-instance-identifier fly-overhead-db \
  --db-instance-class db.t3.small \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password YOUR_SECURE_PASSWORD \
  --allocated-storage 20 \
  --storage-type gp3 \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name default \
  --backup-retention-period 7 \
  --storage-encrypted
```

### Enable PostGIS Extension
```bash
# Connect to RDS
psql -h fly-overhead-db.xxxxx.us-east-1.rds.amazonaws.com -U postgres -d postgres

# Create database
CREATE DATABASE fly_overhead;

# Connect to new database
\c fly_overhead

# Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
```

### Import Backup
```bash
# On your local machine or EC2
pg_restore -h fly-overhead-db.xxxxx.us-east-1.rds.amazonaws.com \
  -U postgres \
  -d fly_overhead \
  --clean \
  fly_overhead_backup_20251030_171040.sql
```

## Step 2: Set Up EC2 Instance

### Launch EC2
- **Instance Type**: t3.large (2 vCPU, 8GB RAM) - recommended
- **OS**: Ubuntu 22.04 LTS or Amazon Linux 2023
- **Storage**: 20GB+ GP3 SSD
- **Security Group**: 
  - Port 22 (SSH)
  - Port 3005 (HTTP - temporary, use ALB in production)
  - Port 443/80 (HTTPS/HTTP - if direct access)

### Install Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 16
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Git
sudo apt install -y git

# Install Docker (optional, if using containers)
# sudo apt install -y docker.io docker-compose
```

### Clone and Setup
```bash
# Clone repository
git clone https://github.com/yourusername/fly-overhead.git
cd fly-overhead

# Install dependencies
cd server && npm install --production
cd ../client && npm install && npm run build

# Create logs directory
mkdir -p logs
```

## Step 3: Configure Environment Variables

Create `.env` file on EC2:
```bash
# Database (RDS)
POSTGRES_URL=postgresql://postgres:YOUR_PASSWORD@fly-overhead-db.xxxxx.us-east-1.rds.amazonaws.com:5432/fly_overhead

# Server
NODE_ENV=production
PORT=3005
HOST=0.0.0.0
ENABLE_WORKER=false  # Worker runs separately via PM2

# OpenSky
OPENSKY_USER=your_opensky_username
OPENSKY_PASS=your_opensky_password

# FlightAware
FLIGHTAWARE_API_KEY=your_flightaware_key

# AviationStack
AVIATION_EDGE_API_KEY=your_aviationstack_key

# AWS (if using)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

## Step 4: Start with PM2

```bash
# Start both processes
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions it outputs

# Check status
pm2 list
pm2 logs
pm2 monit
```

### PM2 Commands
```bash
pm2 restart all          # Restart both processes
pm2 restart fly-overhead-web    # Restart just web server
pm2 restart fly-overhead-worker # Restart just worker
pm2 stop all             # Stop all
pm2 delete all           # Remove from PM2
pm2 logs                 # View logs
pm2 logs fly-overhead-web    # View web logs only
pm2 logs fly-overhead-worker # View worker logs only
```

## Step 5: Set Up Application Load Balancer (Recommended)

### Create ALB
1. Go to EC2 → Load Balancers
2. Create Application Load Balancer
3. Configure:
   - Internet-facing
   - Listeners: HTTP (80), HTTPS (443)
   - Target Group: Port 3005
   - Health Check: `/api/health` (you may need to add this endpoint)

### Configure SSL Certificate
1. Request certificate in ACM (Certificate Manager)
2. Domain: `flyoverhead.com` and `*.flyoverhead.com`
3. Validate via DNS (if Route53) or email
4. Attach to ALB listener (443)

### Update Route53 DNS
```
Type: A (Alias)
Name: flyoverhead.com
Alias Target: [ALB DNS name]
```

## Step 6: Monitoring & Alerts

### CloudWatch Metrics
- EC2 CPU utilization
- EC2 Memory usage
- RDS connection count
- RDS CPU utilization
- Application logs

### Set Up Alerts
```bash
# Via AWS Console or CLI
# Alert if CPU > 80% for 5 minutes
# Alert if memory > 85%
# Alert if RDS connections > 80% of max
```

### PM2 Monitoring
```bash
pm2 monit  # Real-time monitoring
pm2 list   # Process status
```

## Step 7: Auto-scaling (Optional, Future)

### EC2 Auto Scaling Group
- Min: 1, Max: 3 instances
- Scale based on CPU/Memory
- Use ALB as target

### RDS Auto Scaling
- Enable in RDS console
- Auto-scales storage based on usage

## Troubleshooting

### Worker Process Crashes
```bash
# Check logs
pm2 logs fly-overhead-worker --lines 100

# Restart worker
pm2 restart fly-overhead-worker

# Check if it's memory issue
free -h  # Check available memory
```

### Database Connection Issues
```bash
# Test connection
psql -h fly-overhead-db.xxxxx.rds.amazonaws.com -U postgres -d fly_overhead

# Check security groups allow EC2 → RDS traffic
# Check RDS is in same VPC/subnet
```

### High CPU Usage
```bash
# Check what's using CPU
top
htop  # If installed

# Check PM2 processes
pm2 list
pm2 monit

# May need larger instance or optimize batch sizes
```

### Port Already in Use
```bash
# Find what's using port 3005
sudo lsof -i :3005

# Kill process if needed
sudo kill -9 <PID>
```

## Security Best Practices

1. **RDS Security Group**: Only allow connections from EC2 security group
2. **EC2 Security Group**: Restrict SSH (port 22) to your IP only
3. **Secrets**: Use AWS Secrets Manager or Parameter Store (not .env in git)
4. **HTTPS**: Always use ALB with SSL certificate
5. **Backups**: RDS automated backups + manual snapshots

## Cost Optimization

- **Reserved Instances**: Save 30-40% on EC2 and RDS for 1-year term
- **Spot Instances**: Not recommended for production (but 70% cheaper if risk acceptable)
- **Right-sizing**: Monitor and adjust instance sizes
- **RDS Storage**: Start small, auto-scale as needed

## Next Steps After Deployment

1. ✅ Test all endpoints
2. ✅ Monitor for 24-48 hours
3. ✅ Set up CloudWatch dashboards
4. ✅ Configure backup strategy
5. ✅ Plan migration to Option 1 (ECS) if traffic grows

---
**Estimated Monthly Cost**: $85-100 (t3.large EC2 + db.t3.small RDS)

