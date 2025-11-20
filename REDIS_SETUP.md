# Redis Setup for Lightsail

## Redis Instance Created
- **Instance Name**: `redis-cache`
- **Public IP**: `3.145.170.192`
- **Private IP**: `172.26.7.37`
- **State**: Running

## Setup Instructions

### 1. Connect to Redis Instance
```bash
# Get SSH key for the instance
aws lightsail download-default-key-pair --region us-east-2

# Connect via SSH (replace with your key path)
ssh -i ~/.ssh/lightsail-default-key ubuntu@3.145.170.192
```

### 2. Install Redis
```bash
# Update package list
sudo apt-get update

# Install Redis
sudo apt-get install -y redis-server

# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### 3. Configure Redis for Network Access
```bash
# Edit Redis config
sudo nano /etc/redis/redis.conf

# Change these settings:
# bind 127.0.0.1 -> bind 0.0.0.0 (or bind to private IP: 172.26.7.37)
# protected-mode yes -> protected-mode no (or set a password)

# Restart Redis
sudo systemctl restart redis-server
```

### 4. Configure Firewall
```bash
# Allow Redis port (6379) from container service
# In Lightsail console: Networking > Firewall > Add rule
# - Application: Custom
# - Protocol: TCP
# - Port: 6379
# - Source: Container Service (container-service-1)
```

### 5. Update Container Environment
Add to container-service-1 environment variables:
```
REDIS_URL=redis://172.26.7.37:6379
```

Or if using password:
```
REDIS_URL=redis://:password@172.26.7.37:6379
```

### 6. Test Connection
From your local machine or container:
```bash
redis-cli -h 172.26.7.37 -p 6379 ping
# Should return: PONG
```

## Security Recommendations
1. **Set a Redis password** (recommended for production)
2. **Use private IP** (172.26.7.37) instead of public IP
3. **Restrict firewall** to only allow connections from container-service-1
4. **Enable Redis AUTH** in redis.conf

## Alternative: Use ElastiCache
For production, consider using AWS ElastiCache for Redis:
- Managed service (no maintenance)
- Automatic backups
- Better performance
- Requires VPC peering between Lightsail and ElastiCache VPC

