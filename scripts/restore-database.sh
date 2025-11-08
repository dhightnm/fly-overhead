#!/bin/bash

# Database restore script for fly-overhead
# Restores a PostgreSQL database backup

# Check if backup file was provided
if [ -z "$1" ]; then
    echo "Usage: ./restore-database.sh <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh ./backups/fly_overhead_backup_*.sql.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Database connection details
DB_HOST="192.168.58.15"
DB_PORT="5433"
DB_NAME="fly_overhead"
DB_USER="postgres"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}============================================${NC}"
echo -e "${RED}⚠️  DATABASE RESTORE - DESTRUCTIVE ⚠️${NC}"
echo -e "${RED}============================================${NC}"
echo ""
echo -e "${YELLOW}This will:${NC}"
echo "  1. DROP all existing tables in the database"
echo "  2. Restore data from: $BACKUP_FILE"
echo ""
echo "Database:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo ""
echo -e "${RED}ALL CURRENT DATA WILL BE LOST!${NC}"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Starting restore...${NC}"

# Export password
export PGPASSWORD="postgres"

# Check if file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo -e "${YELLOW}Decompressing backup file...${NC}"
    TEMP_FILE="/tmp/fly_overhead_restore_$$.sql"
    gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"
    RESTORE_FILE="$TEMP_FILE"
else
    RESTORE_FILE="$BACKUP_FILE"
fi

# Drop existing database and recreate (clean slate)
echo -e "${YELLOW}Dropping existing database...${NC}"
psql -h "$DB_HOST" \
     -p "$DB_PORT" \
     -U "$DB_USER" \
     -d "postgres" \
     -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | grep -v "NOTICE:"

echo -e "${YELLOW}Creating fresh database...${NC}"
psql -h "$DB_HOST" \
     -p "$DB_PORT" \
     -U "$DB_USER" \
     -d "postgres" \
     -c "CREATE DATABASE $DB_NAME;" 2>&1 | grep -v "NOTICE:"

# Enable PostGIS extension
echo -e "${YELLOW}Enabling PostGIS extension...${NC}"
psql -h "$DB_HOST" \
     -p "$DB_PORT" \
     -U "$DB_USER" \
     -d "$DB_NAME" \
     -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>&1 | grep -v "NOTICE:"

# Restore the backup
echo -e "${YELLOW}Restoring database backup...${NC}"
psql -h "$DB_HOST" \
     -p "$DB_PORT" \
     -U "$DB_USER" \
     -d "$DB_NAME" \
     -f "$RESTORE_FILE" 2>&1 | grep -v "NOTICE:" | grep -E "(ERROR|CREATE|INSERT|COPY)"

# Check if restore was successful
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}✓ Database Restored Successfully${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    
    # Show restored table counts
    echo -e "${YELLOW}Restored Database Statistics:${NC}"
    psql -h "$DB_HOST" \
         -p "$DB_PORT" \
         -U "$DB_USER" \
         -d "$DB_NAME" \
         -t -A -F"," \
         -c "SELECT 
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
             FROM users" 2>/dev/null | while IFS=',' read -r table count; do
        printf "  %-30s %10s rows\n" "$table:" "$count"
    done
    echo ""
else
    echo -e "${RED}✗ Database restore failed${NC}"
    echo "Check the output above for errors"
    exit 1
fi

# Clean up temp file if created
if [ ! -z "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
    rm -f "$TEMP_FILE"
fi

# Unset password
unset PGPASSWORD

echo -e "${GREEN}Restore complete!${NC}"
echo ""

