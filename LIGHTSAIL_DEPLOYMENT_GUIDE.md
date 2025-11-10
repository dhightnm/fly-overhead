# AWS Lightsail Deployment Guide

Complete step-by-step guide for deploying Fly Overhead to AWS Lightsail Container Service with database migration.

---

## Prerequisites

- AWS account with Lightsail access
- AWS CLI installed and configured (optional, but helpful)
- Docker installed locally (for building/testing)
- Access to your current database (192.168.58.15:5433)
- Your current `.env` file with all credentials

---

## Part 1: Create Database Backup

### Step 1.1: Create a Complete Database Backup

Run the backup script from your local machine:

```bash
cd /Users/devin/coding/fly-overhead
./db-manager.sh backup lightsail
```

This will create a compressed backup file in `./backups/` directory with a timestamp like:
- `fly_overhead_COMPLETE_YYYYMMDD_HHMMSS.sql.gz`

**Note:** The backup may take 10-15 minutes if you have 53M+ rows in the history table.

### Step 1.2: Verify Backup Integrity

```bash
# List backups
ls -lh ./backups/fly_overhead_COMPLETE_*.sql.gz

# Verify the latest backup
gunzip -t ./backups/fly_overhead_COMPLETE_*.sql.gz | tail -1
```

### Step 1.3: Download Backup to Your Local Machine

Make sure you have the backup file saved locally. You'll need to upload it to Lightsail later.

---

## Part 2: Set Up AWS Lightsail Container Service

### Step 2.1: Create Lightsail Container Service

1. **Log in to AWS Lightsail Console**
   - Go to https://lightsail.aws.amazon.com
   - Sign in to your AWS account

2. **Create Container Service**
   - Click **"Containers"** in the left sidebar
   - Click **"Create container service"**
   - Choose configuration:
     - **Power**: `Nano` (0.25 vCPU, 0.5 GB RAM) - for testing
     - **Power**: `Micro` (0.5 vCPU, 1 GB RAM) - minimum recommended
     - **Power**: `Small` (1 vCPU, 2 GB RAM) - recommended for production
     - **Scale**: `1` container (start with 1, scale up later)
     - **Name**: `fly-overhead-service`
     - **Deployment region**: Choose closest to your users

3. **Click "Create container service"**

### Step 2.2: Set Up Database Container (PostgreSQL with PostGIS)

You have two options:

#### Option A: Use Lightsail Database (Recommended for Production)

1. **Create Lightsail Database**
   - Go to **"Databases"** in Lightsail
   - Click **"Create database"**
   - Configuration:
     - **Database engine**: PostgreSQL 15
     - **Plan**: Choose based on your needs (start with `db.t3.micro`)
     - **Master database name**: `fly_overhead`
     - **Master username**: `postgres` (or your preferred username)
     - **Master password**: **Generate a strong password** (save this!)
     - **Availability zone**: Same region as your container service
   - Click **"Create database"**

2. **Note the Connection Details**
   - After creation, note the **endpoint** (e.g., `fly-overhead-db.xxxxx.us-east-1.rds.amazonaws.com`)
   - Note the **port** (usually `5432`)
   - Note the **username** and **password** you set

#### Option B: Run PostgreSQL in a Separate Container (For Development)

If you prefer to run PostgreSQL in a container:

1. Create a second container service for the database
2. Use the `postgis/postgis:15-3.3` image
3. Configure persistent storage (Lightsail volumes)

**Note:** Option A (Lightsail Database) is recommended as it provides automatic backups, monitoring, and easier management.

---

## Part 3: Prepare Your Application for Deployment

### Step 3.1: Build Docker Image Locally (Test First)

```bash
cd /Users/devin/coding/fly-overhead

# Build the image
docker build -t fly-overhead:latest .

# Test the build
docker run -p 3005:3005 \
  -e POSTGRES_URL=postgresql://postgres:postgres@192.168.58.15:5433/fly_overhead \
  -e OPENSKY_USER=YOUR_OPENSKY_USERNAME \
  -e OPENSKY_PASS=YOUR_OPENSKY_PASSWORD \
  -e JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-7309 \
  -e GOOGLE_CLIENT_ID=690273174931-b4g9ipgkvmbk2as7fmj92p5o6svvnvc0.apps.googleusercontent.com \
  -e GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET \
  fly-overhead:latest
```

### Step 3.2: Push Image to Container Registry

You need to push your Docker image to a registry that Lightsail can access.

#### Option A: Use AWS ECR (Recommended)

```bash
# Install AWS CLI if not already installed
# brew install awscli (on macOS)

# Configure AWS credentials
aws configure

# Create ECR repository
aws ecr create-repository --repository-name fly-overhead --region us-east-1

# Get login token
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Tag your image
docker tag fly-overhead:latest <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/fly-overhead:latest

# Push to ECR
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/fly-overhead:latest
```

#### Option B: Use Docker Hub

```bash
# Login to Docker Hub
docker login

# Tag your image
docker tag fly-overhead:latest <YOUR_DOCKERHUB_USERNAME>/fly-overhead:latest

# Push to Docker Hub
docker push <YOUR_DOCKERHUB_USERNAME>/fly-overhead:latest
```

**Note:** Replace `<YOUR_ACCOUNT_ID>` with your AWS account ID and `<YOUR_DOCKERHUB_USERNAME>` with your Docker Hub username.

---

## Part 4: Configure Environment Variables

### Step 4.1: Required Environment Variables

Create a list of all environment variables you'll need in Lightsail:

```bash
# Server Configuration
PORT=3005
NODE_ENV=production
HOST=0.0.0.0

# Database Connection (Lightsail Database)
POSTGRES_URL=postgresql://postgres:YOUR_DB_PASSWORD@YOUR_DB_ENDPOINT:5432/fly_overhead

# OpenSky Network API
OPENSKY_USER=YOUR_OPENSKY_USERNAME
OPENSKY_PASS=YOUR_OPENSKY_PASSWORD

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Google OAuth
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=postmessage

# FlightAware API (if used)
FLIGHTAWARE_API_KEY=YOUR_FLIGHTAWARE_API_KEY

# N2YO API (if used)
N2YO_API_KEY=YOUR_N2YO_API_KEY

# AWS Configuration (if used)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# Frontend API URL (for React app)
REACT_APP_API_URL=https://your-lightsail-domain.com
```

### Step 4.2: Update Google OAuth Redirect URIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** > **Credentials**
3. Find your OAuth 2.0 Client ID
4. Add your Lightsail domain to **Authorized JavaScript origins**:
   - `https://your-lightsail-domain.com`
   - `http://your-lightsail-ip` (if using IP)
5. Add to **Authorized redirect URIs**:
   - `https://your-lightsail-domain.com/api/auth/google/callback`

---

## Part 5: Deploy Container to Lightsail

### Step 5.1: Create Container Deployment

1. **In Lightsail Console**, go to your container service
2. Click **"Create deployment"**
3. Configure the deployment:

   **Container 1:**
   - **Container name**: `fly-overhead-app`
   - **Image**: 
     - If using ECR: `<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/fly-overhead:latest`
     - If using Docker Hub: `<YOUR_DOCKERHUB_USERNAME>/fly-overhead:latest`
   - **Port mapping**: 
     - **Container port**: `3005`
     - **Protocol**: `HTTP`
   - **Environment variables**: Add all variables from Step 4.1
     - Click **"Add environment variable"** for each one
     - **Important**: Update `POSTGRES_URL` with your Lightsail database endpoint
     - **Important**: Update `REACT_APP_API_URL` with your Lightsail domain/IP

4. **Public endpoint**: 
   - Enable **"Public endpoint"**
   - This will give you a URL like: `fly-overhead-service.xxxxx.us-east-1.cs.amazonlightsail.com`

5. Click **"Save and deploy"**

### Step 5.2: Wait for Deployment

- Deployment typically takes 5-10 minutes
- Monitor the deployment status in the Lightsail console
- Check logs if deployment fails

---

## Part 6: Migrate Database to Lightsail

### Step 6.1: Enable PostGIS Extension on Lightsail Database

Connect to your Lightsail database and enable PostGIS:

```bash
# Install PostgreSQL client if needed
# macOS: brew install postgresql
# Linux: sudo apt-get install postgresql-client

# Connect to Lightsail database
psql -h YOUR_DB_ENDPOINT -U postgres -d fly_overhead

# In psql prompt, run:
CREATE EXTENSION IF NOT EXISTS postgis;
\q
```

### Step 6.2: Upload Backup to Lightsail Instance (Temporary)

You need to get your backup file to a place where you can restore it to the Lightsail database.

**Option A: Use Lightsail Instance (Recommended)**

1. **Create a Lightsail Instance** (temporary, for database migration):
   - Go to **"Instances"** in Lightsail
   - Click **"Create instance"**
   - Choose:
     - **Platform**: Linux/Unix
     - **Blueprint**: Ubuntu
     - **Instance plan**: Nano ($3.50/month) - you can delete after migration
   - Click **"Create instance"**

2. **Connect to Instance via SSH**:
   ```bash
   # Lightsail will provide SSH command, or use:
   ssh -i ~/.ssh/lightsail-key.pem ubuntu@YOUR_INSTANCE_IP
   ```

3. **Upload Backup File**:
   ```bash
   # From your local machine, use SCP:
   scp -i ~/.ssh/lightsail-key.pem \
     ./backups/fly_overhead_COMPLETE_YYYYMMDD_HHMMSS.sql.gz \
     ubuntu@YOUR_INSTANCE_IP:~/
   ```

4. **Install PostgreSQL Client on Instance**:
   ```bash
   # SSH into the instance
   sudo apt-get update
   sudo apt-get install -y postgresql-client-15
   ```

5. **Restore Database**:
   ```bash
   # Decompress and restore
   gunzip -c fly_overhead_COMPLETE_YYYYMMDD_HHMMSS.sql.gz | \
     psql -h YOUR_DB_ENDPOINT \
          -U postgres \
          -d fly_overhead \
          -v ON_ERROR_STOP=1
   ```

**Option B: Restore Directly from Local Machine**

If your local machine can reach the Lightsail database (it should be publicly accessible):

```bash
# From your local machine
cd /Users/devin/coding/fly-overhead

# Restore directly
gunzip -c ./backups/fly_overhead_COMPLETE_YYYYMMDD_HHMMSS.sql.gz | \
  psql -h YOUR_DB_ENDPOINT \
       -U postgres \
       -d fly_overhead \
       -v ON_ERROR_STOP=1
```

**Note:** You may need to add your IP to the Lightsail database's allowed IPs in the firewall settings.

### Step 6.3: Verify Database Migration

```bash
# Connect to database
psql -h YOUR_DB_ENDPOINT -U postgres -d fly_overhead

# Check table counts
SELECT 
  'aircraft_states' as table_name, COUNT(*) as row_count 
FROM aircraft_states
UNION ALL
SELECT 
  'aircraft_states_history' as table_name, COUNT(*) as row_count 
FROM aircraft_states_history
UNION ALL
SELECT 
  'flight_routes_cache' as table_name, COUNT(*) as row_count 
FROM flight_routes_cache
UNION ALL
SELECT 
  'flight_routes_history' as table_name, COUNT(*) as row_count 
FROM flight_routes_history
UNION ALL
SELECT 
  'feeders' as table_name, COUNT(*) as row_count 
FROM feeders
UNION ALL
SELECT 
  'users' as table_name, COUNT(*) as row_count 
FROM users;

\q
```

### Step 6.4: Clean Up Temporary Instance (If Created)

After successful migration:

1. Go to Lightsail **"Instances"**
2. Select your temporary instance
3. Click **"Delete"** to stop charges

---

## Part 7: Configure Domain and SSL (Optional)

### Step 7.1: Point Domain to Lightsail

1. **Get your Lightsail container service endpoint**
   - In Lightsail console, go to your container service
   - Note the public endpoint URL

2. **Update DNS Records**
   - Go to your domain registrar (e.g., Route 53, GoDaddy)
   - Create a CNAME record:
     - **Name**: `@` or `www` (depending on your preference)
     - **Value**: `fly-overhead-service.xxxxx.us-east-1.cs.amazonlightsail.com`

### Step 7.2: Enable HTTPS (SSL Certificate)

1. **In Lightsail Container Service**:
   - Go to **"Custom domains"** tab
   - Click **"Create certificate"**
   - Enter your domain name
   - Follow the DNS validation steps
   - Once validated, attach the certificate to your container service

2. **Update Environment Variables**:
   - Update `REACT_APP_API_URL` to use `https://your-domain.com`

---

## Part 8: Verify Deployment

### Step 8.1: Test Health Endpoints

```bash
# Test health endpoint
curl https://your-lightsail-domain.com/api/health

# Test readiness endpoint
curl https://your-lightsail-domain.com/api/ready
```

### Step 8.2: Check Application Logs

1. In Lightsail console, go to your container service
2. Click on **"Logs"** tab
3. Check for any errors or warnings

### Step 8.3: Test Frontend

1. Open your browser and navigate to your Lightsail domain
2. Verify the React app loads correctly
3. Test authentication (Google OAuth)
4. Test API endpoints

---

## Part 9: Post-Deployment Checklist

- [ ] Database backup created and verified
- [ ] Lightsail container service created
- [ ] Lightsail database created with PostGIS extension
- [ ] Docker image built and pushed to registry
- [ ] Environment variables configured in Lightsail
- [ ] Google OAuth redirect URIs updated
- [ ] Database migrated successfully
- [ ] Container deployed and running
- [ ] Health endpoints responding
- [ ] Frontend accessible
- [ ] Authentication working
- [ ] Domain configured (if applicable)
- [ ] SSL certificate installed (if applicable)
- [ ] Monitoring set up (optional)

---

## Troubleshooting

### Container Won't Start

1. **Check logs** in Lightsail console
2. **Verify environment variables** are set correctly
3. **Check database connection** - ensure `POSTGRES_URL` is correct
4. **Verify image** is accessible from Lightsail

### Database Connection Issues

1. **Check firewall rules** - ensure your container can access the database
2. **Verify credentials** in `POSTGRES_URL`
3. **Test connection** from a temporary instance:
   ```bash
   psql -h YOUR_DB_ENDPOINT -U postgres -d fly_overhead
   ```

### Application Errors

1. **Check container logs** in Lightsail
2. **Verify all environment variables** are set
3. **Check database** - ensure all tables exist
4. **Test API endpoints** individually

### High Memory/CPU Usage

1. **Scale up** your container service power
2. **Check for memory leaks** in application logs
3. **Optimize database queries** if needed

---

## Cost Estimation

**Lightsail Container Service:**
- Nano (0.25 vCPU, 0.5 GB): ~$7/month
- Micro (0.5 vCPU, 1 GB): ~$10/month
- Small (1 vCPU, 2 GB): ~$20/month

**Lightsail Database:**
- db.t3.micro: ~$15/month
- db.t3.small: ~$30/month

**Total Estimated Cost:** $25-50/month for small-scale deployment

---

## Next Steps

1. **Set up automated backups** for your Lightsail database
2. **Configure monitoring** and alerts
3. **Set up CI/CD** for automated deployments
4. **Scale resources** as needed based on usage
5. **Set up log aggregation** (CloudWatch, etc.)

---

## Quick Reference: Environment Variables Template

Save this as a reference when configuring Lightsail:

```env
PORT=3005
NODE_ENV=production
HOST=0.0.0.0
POSTGRES_URL=postgresql://postgres:PASSWORD@ENDPOINT:5432/fly_overhead
OPENSKY_USER=YOUR_OPENSKY_USERNAME
OPENSKY_PASS=YOUR_OPENSKY_PASSWORD
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=postmessage
FLIGHTAWARE_API_KEY=YOUR_FLIGHTAWARE_API_KEY
N2YO_API_KEY=YOUR_N2YO_API_KEY
AWS_REGION=us-east-1
REACT_APP_API_URL=https://your-domain.com
```

---

**Good luck with your deployment!** 🚀


