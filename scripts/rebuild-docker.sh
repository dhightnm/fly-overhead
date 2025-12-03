#!/bin/bash
# Bash script to rebuild Docker containers with no cache
# Usage: ./rebuild-docker.sh [dev|prod]

MODE=${1:-prod}

echo "Rebuilding Docker containers in $MODE mode..."

if [ "$MODE" = "dev" ]; then
    echo "Stopping dev containers..."
    docker compose -f docker-compose.dev.yml stop
    
    echo "Rebuilding dev containers (no cache)..."
    docker compose -f docker-compose.dev.yml build --no-cache server
    
    echo "Starting dev containers..."
    docker compose -f docker-compose.dev.yml up -d
    
    if [ -x ./scripts/db-manager.sh ]; then
        echo "Running database migrations..."
        ./scripts/db-manager.sh migrate
    fi
    
    echo "✅ Dev containers rebuilt and started!"
else
    echo "Stopping production containers..."
    docker compose stop
    
    echo "Rebuilding production containers (no cache)..."
    docker compose build --no-cache --pull server
    
    echo "Starting production containers..."
    docker compose up -d
    
    if [ -x ./scripts/db-manager.sh ]; then
        echo "Running database migrations..."
        ./scripts/db-manager.sh migrate
    fi
    
    echo "✅ Production containers rebuilt and started!"
fi

echo ""
echo "Container status:"
docker compose ps
