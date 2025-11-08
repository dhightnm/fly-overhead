#!/bin/bash

# Quick database backup with progress monitoring
DB_HOST="192.168.58.15"
DB_PORT="5433"
DB_NAME="fly_overhead"
DB_USER="postgres"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/fly_overhead_COMPLETE_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "=========================================="
echo "Creating COMPLETE Database Backup"
echo "=========================================="
echo ""
echo "Database: $DB_NAME @ $DB_HOST:$DB_PORT"
echo "Output: $BACKUP_FILE"
echo ""
echo "⚠️  This may take 10-15 minutes for 53M+ rows in history table"
echo ""

# Use Docker with PostgreSQL 15 and pipe directly to gzip
echo "Starting backup (with compression)..."
docker run --rm \
    -e PGPASSWORD="postgres" \
    postgres:15-alpine \
    pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --format=plain \
    --no-owner \
    --no-privileges | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ]; then
    echo ""
    echo "✅ Backup COMPLETE!"
    echo ""
    ls -lh "$BACKUP_FILE"
    echo ""
    
    # Verify backup
    echo "Verifying backup integrity..."
    gunzip -t "$BACKUP_FILE" 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ Backup file integrity verified"
    else
        echo "❌ Backup file may be corrupted"
    fi
else
    echo "❌ Backup failed"
    exit 1
fi

