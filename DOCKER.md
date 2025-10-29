# Docker Setup for Fly Overhead

This guide explains how to run Fly Overhead in Docker for local development and production deployment.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose v2 (included with Docker Desktop)

## Quick Start (Local Development)

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file** with your credentials:
   - OpenSky Network username and password
   - AWS credentials (if using DynamoDB)
   - N2YO API key

3. **Build and start services:**
   ```bash
   docker-compose up --build
   ```

4. **Access the application:**
   - Frontend & Backend: http://localhost:3005
   - PostgreSQL: localhost:5432

## Docker Services

### 1. PostgreSQL Database (`db`)
- Container: `fly-overhead-postgres`
- Port: 5432
- Data: Persistent volume `db-data`
- Health check enabled

### 2. Backend Server (`server`)
- Container: `fly-overhead-server`
- Port: 3005
- Multi-stage build:
  - Stage 1: Builds React frontend
  - Stage 2: Runs Node.js server serving both API and frontend
- Restarts automatically on failure

## Architecture

```
┌─────────────────────────────────────────┐
│         Docker Container (3005)         │
│  ┌────────────────────────────────────┐ │
│  │      Express Server (Backend)      │ │
│  │  - API Routes (/api/*)             │ │
│  │  - Static Files (React Build)      │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│     PostgreSQL Database (5432)          │
│  - aircraft_states                      │
│  - aircraft_states_history              │
└─────────────────────────────────────────┘
```

## Production Deployment on AWS

### Option 1: AWS Fargate (Recommended)

1. **Build and push Docker image to Amazon ECR:**
   ```bash
   # Login to ECR
   aws ecr get-login-password --region us-west-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-1.amazonaws.com
   
   # Build image
   docker build -t fly-overhead .
   
   # Tag image
   docker tag fly-overhead:latest <account-id>.dkr.ecr.us-west-1.amazonaws.com/fly-overhead:latest
   
   # Push to ECR
   docker push <account-id>.dkr.ecr.us-west-1.amazonaws.com/fly-overhead:latest
   ```

2. **Create Fargate Service:**
   - Use the uploaded image from ECR
   - Set environment variables using AWS Secrets Manager or Parameter Store
   - Connect to RDS PostgreSQL instance
   - Use Application Load Balancer for HTTPS

3. **Database:**
   - Use Amazon RDS PostgreSQL instead of containerized database
   - Update `POSTGRES_URL` in environment variables

### Option 2 Known: AWS ECS with EC2

1. **Create ECS Cluster with EC2 instances**
2. **Use the same Docker image** from ECR
3. **Configure Task Definition** with:
   - Memory: 512 MB minimum
   - CPU: 256 units minimum
   - Environment variables
   - Health checks

### Option 3: AWS Elastic Beanstalk

Create a `Dockerrun.aws.json` file:
```json
{
  "AWSEBDockerrunVersion": "single",
  "Image": {
    "Name": "<account-id>.dkr.ecr.us-west-1.amazonaws.com/fly-overhead:latest"
  },
  "Ports": [
    {
      "ContainerPort": "3005"
    }
  ],
  "Environment": [
    {
      "Name": "POSTGRES_URL",
      "Value": "your-rds-connection-string"
    }
  ]
}
```

## Managing Services

### View logs:
```bash
docker-compose logs -f server
docker-compose logs -f db
```

### Stop services:
```bash
docker-compose down
```

### Stop and remove volumes:
```bash
docker-compose down -v
```

### Rebuild after code changes:
```bash
docker-compose up --build
```

### Execute commands in containers:
```bash
# Access server container
docker-compose exec server sh

# Access database
docker-compose exec db psql -U example -d fly_overhead
```

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENSKY_USER` | OpenSky Network username | your-username |
| `OPENSKY_PASS` | OpenSky Network password | your-password |
| `PORT` | Server port | 3005 |
| `POSTGRES_URL` | PostgreSQL connection string | postgresql://user:pass@host:5432/db |
| `AWS_REGION` | AWS region | us-west-1 |
| `AWS_ACCESS_KEY_ID` | AWS access key | AKIA... |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | secret |
| `N2YO_API_KEY` | N2YO API key | api-key |
| `REACT_APP_API_URL` | Frontend API URL | https://api.example.com |

## Troubleshooting

### Database connection failed:
- Check if PostgreSQL container is running: `docker-compose ps`
- Verify credentials in `.env` file
- Check network connectivity: `docker-compose exec server ping db`

### Build fails:
- Clear Docker cache: `docker system prune -a`
- Check for correct Node version (16.x)
- Verify package.json files exist

### Port already in use:
- Change port in `docker-compose.yml` and `.env`
- Or stop conflicting services

### Frontend not loading:
- Check if build completed successfully
- Verify static files in `server/client/build`
- Check browser console for errors

## Security Considerations for Production

1. **Never commit `.env` file** to version control
2. **Use AWS Secrets Manager** or Parameter Store for credentials
3. **Enable HTTPS** with Application Load Balancer
4. **Use RDS PostgreSQL** instead of containerized database
5. **Configure CORS** properly for production domain
6. **Set up CloudWatch** for logging and monitoring
7. **Enable VPC** and security groups properly
8. **Use AWS WAF** for additional security layer

## Performance Optimization

1. **Enable multi-stage builds** for smaller images
2. **Use `.dockerignore`** to exclude unnecessary files
3. **Cache dependencies** using Docker layer caching
4. **Use Alpine-based images** for smaller size
5. **Enable connection pooling** for PostgreSQL
6. **Configure autoscaling** based on CPU/memory

## Health Checks

The server includes a health endpoint:
```bash
curl http://localhost:3005/api/health
```

Configure health checks in your deployment platform (ECS, Fargate, etc.).

