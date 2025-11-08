#!/bin/bash

# API Key Authentication MVP Migration Script
# This script runs the database migrations for the API key system

set -e  # Exit on error

echo "=========================================="
echo "  API Key System - Database Migration"
echo "=========================================="
echo ""

# Load POSTGRES_URL from .env file if not already set
if [ -z "$POSTGRES_URL" ] && [ -f .env ]; then
    echo "✓ Loading POSTGRES_URL from .env"
    # Extract POSTGRES_URL from .env file (handles comments and empty lines)
    POSTGRES_URL=$(grep -E '^POSTGRES_URL=' .env | head -1 | cut -d '=' -f2- | sed 's/^["'\'']//;s/["'\'']$//')
    export POSTGRES_URL
elif [ -f .env ]; then
    echo "✓ POSTGRES_URL already set, using existing value"
elif [ -z "$POSTGRES_URL" ]; then
    echo "⚠ Warning: .env file not found and POSTGRES_URL not set"
fi

# Check if POSTGRES_URL is set
if [ -z "$POSTGRES_URL" ]; then
    echo "✗ POSTGRES_URL environment variable is not set"
    echo ""
    echo "Please set POSTGRES_URL in your .env file or export it:"
    echo "  export POSTGRES_URL='postgresql://user:pass@host:port/database'"
    exit 1
fi

# Check if PostgreSQL connection is available
echo "Testing database connection..."
psql "$POSTGRES_URL" -c "SELECT 1;" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Database connection successful"
else
    echo "✗ Database connection failed"
    echo ""
    echo "Please check:"
    echo "  1. POSTGRES_URL is correct in .env file"
    echo "  2. PostgreSQL server is running"
    echo "  3. Database credentials are correct"
    echo ""
    echo "Current POSTGRES_URL: ${POSTGRES_URL:0:20}..." # Show first 20 chars only
    exit 1
fi

# Create backup before migration using Docker container's pg_dump
echo ""
echo "Creating database backup..."
BACKUP_FILE="backups/pre_api_keys_migration_$(date +%Y%m%d_%H%M%S).sql"
mkdir -p backups

# Check if Docker container is running
if docker ps --format '{{.Names}}' | grep -q '^fly-overhead-postgres$'; then
    echo "  Using pg_dump from Docker container (fly-overhead-postgres)..."
    docker exec fly-overhead-postgres pg_dump -U postgres fly_overhead > "$BACKUP_FILE" 2>&1
    if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
        echo "✓ Backup created: $BACKUP_FILE"
    else
        echo "⚠ Backup failed"
        echo "  This is not critical - continuing with migration..."
        rm -f "$BACKUP_FILE" 2>/dev/null
    fi
else
    echo "⚠ Docker container 'fly-overhead-postgres' not found or not running"
    echo "  Skipping backup (migration will continue)"
    echo "  Note: You can manually backup if needed:"
    echo "    docker exec fly-overhead-postgres pg_dump -U postgres fly_overhead > backup.sql"
fi

# Run migration
echo ""
echo "Running migration: 001_create_api_keys_mvp.sql"
psql "$POSTGRES_URL" -f server/migrations/001_create_api_keys_mvp.sql

if [ $? -eq 0 ]; then
    echo "✓ Migration completed successfully"
else
    echo "✗ Migration failed"
    exit 1
fi

# Verify table creation
echo ""
echo "Verifying api_keys table..."
psql "$POSTGRES_URL" -c "\d api_keys" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ api_keys table exists"
else
    echo "✗ api_keys table not found"
    exit 1
fi

echo ""
echo "=========================================="
echo "  ✓ Migration Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart your server: npm start"
echo "2. Create a dev API key for testing"
echo "3. Test the API key endpoints"
echo ""

