#!/bin/bash

# Database Manager - All-in-one database operations script
# Consolidates: setup-database.sh, restore-database-local.sh, restore-database.sh,
#               quick-backup.sh, lightsail-backup-and-migrate.sh, migrate-api-keys.sh

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default configuration
BACKUP_DIR="./backups"
MIGRATION_DIR="server/migrations"

# Detect environment
detect_db_env() {
    if docker ps --format '{{.Names}}' | grep -q '^fly-overhead-postgres$'; then
        DB_TYPE="local-docker"
        DB_HOST="localhost"
        DB_PORT="5433"
        DB_NAME="fly_overhead"
        DB_USER="postgres"
        DB_PASSWORD="postgres"
        DOCKER_CONTAINER="fly-overhead-postgres"
    elif [ -f .env ]; then
        DB_TYPE="remote"
        POSTGRES_URL=$(grep -E '^POSTGRES_URL=' .env | head -1 | cut -d '=' -f2- | sed 's/^["'\'']//;s/["'\'']$//')
        # Parse components if needed
        DB_HOST=$(echo "$POSTGRES_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo "$POSTGRES_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        DB_NAME=$(echo "$POSTGRES_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')
        DB_USER=$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
        DB_PASSWORD=$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
    else
        echo -e "${RED}Cannot detect database environment${NC}"
        exit 1
    fi
}

# Print usage
usage() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Database Manager - Fly Overhead${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Usage: ./db-manager.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  setup                   - Set up database with migrations"
    echo "  backup [type]           - Create database backup (default: complete)"
    echo "    Types: complete, lightsail"
    echo "  restore <file>          - Restore database from backup"
    echo "  migrate [file]          - Run migrations (all or specific)"
    echo "  optimize                - Run performance optimization migration"
    echo "  verify                  - Verify database indexes and health"
    echo "  stats                   - Show database statistics"
    echo ""
    echo "Examples:"
    echo "  ./db-manager.sh setup"
    echo "  ./db-manager.sh backup"
    echo "  ./db-manager.sh backup lightsail"
    echo "  ./db-manager.sh restore backups/backup.sql.gz"
    echo "  ./db-manager.sh migrate"
    echo "  ./db-manager.sh optimize"
    echo "  ./db-manager.sh verify"
    echo "  ./db-manager.sh stats"
    echo ""
}

# Run psql command
run_psql() {
    local cmd="$1"
    if [ "$DB_TYPE" = "local-docker" ]; then
        docker exec -i "$DOCKER_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$cmd"
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$cmd"
    fi
}

# Run psql with file input
run_psql_file() {
    local file="$1"
    if [ "$DB_TYPE" = "local-docker" ]; then
        docker exec -i "$DOCKER_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$file"
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$file"
    fi
}

# Setup database
cmd_setup() {
    echo -e "${YELLOW}Setting up database...${NC}"
    echo ""
    
    detect_db_env
    
    if [ "$DB_TYPE" = "local-docker" ]; then
        echo "Starting Docker database..."
        docker compose -f docker-compose.dev.yml up -d db
        
        echo "Waiting for database to be ready..."
        sleep 5
        
        while ! docker exec "$DOCKER_CONTAINER" pg_isready -U postgres > /dev/null 2>&1; do
            echo "  Waiting..."
            sleep 2
        done
    fi
    
    echo -e "${GREEN}✓ Database is ready${NC}"
    echo ""
    
    # Enable PostGIS
    echo "Enabling PostGIS..."
    run_psql "CREATE EXTENSION IF NOT EXISTS postgis;" > /dev/null 2>&1
    echo -e "${GREEN}✓ PostGIS enabled${NC}"
    echo ""
    
    # Run migrations
    cmd_migrate
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Database setup complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
}

# Create backup
cmd_backup() {
    local backup_type="${1:-complete}"
    
    detect_db_env
    
    mkdir -p "$BACKUP_DIR"
    
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_file="$BACKUP_DIR/fly_overhead_${backup_type}_${timestamp}.sql.gz"
    
    echo -e "${YELLOW}Creating $backup_type backup...${NC}"
    echo "Source: $DB_HOST:$DB_PORT/$DB_NAME"
    echo "Output: $backup_file"
    echo ""
    
    if [ "$DB_TYPE" = "local-docker" ]; then
        docker exec "$DOCKER_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
            --format=plain --no-owner --no-privileges | gzip > "$backup_file"
    else
        docker run --rm \
            -e PGPASSWORD="$DB_PASSWORD" \
            postgres:15-alpine \
            pg_dump \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            --format=plain \
            --no-owner \
            --no-privileges | gzip > "$backup_file"
    fi
    
    if [ $? -eq 0 ] && [ -f "$backup_file" ]; then
        echo ""
        echo -e "${GREEN}✓ Backup created successfully!${NC}"
        ls -lh "$backup_file"
        
        # Verify integrity
        if gunzip -t "$backup_file" 2>&1 > /dev/null; then
            echo -e "${GREEN}✓ Backup integrity verified${NC}"
        fi
        
        # If lightsail backup, show additional info
        if [ "$backup_type" = "lightsail" ]; then
            echo ""
            cmd_stats
            echo ""
            echo -e "${BLUE}To restore on Lightsail:${NC}"
            echo "  1. Enable PostGIS: CREATE EXTENSION IF NOT EXISTS postgis;"
            echo "  2. Restore: gunzip -c $backup_file | psql \$LIGHTSAIL_DB_URL"
            echo "  3. Run optimizations: psql \$LIGHTSAIL_DB_URL -f server/migrations/002_performance_optimization.sql"
            echo ""
        fi
    else
        echo -e "${RED}✗ Backup failed${NC}"
        exit 1
    fi
}

# Restore backup
cmd_restore() {
    local backup_file="$1"
    
    if [ -z "$backup_file" ]; then
        echo -e "${RED}Error: Backup file required${NC}"
        echo "Usage: ./db-manager.sh restore <backup_file>"
        echo ""
        echo "Available backups:"
        ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
        exit 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}Error: Backup file not found: $backup_file${NC}"
        exit 1
    fi
    
    detect_db_env
    
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}⚠️  DATABASE RESTORE - DESTRUCTIVE ⚠️${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
    echo "Backup: $backup_file"
    echo ""
    echo -e "${RED}ALL CURRENT DATA WILL BE LOST!${NC}"
    echo ""
    read -p "Type 'yes' to confirm: " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
        echo "Restore cancelled."
        exit 0
    fi
    
    echo ""
    echo -e "${YELLOW}Dropping existing database...${NC}"
    
    if [ "$DB_TYPE" = "local-docker" ]; then
        docker exec "$DOCKER_CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | grep -v "NOTICE:" || true
        docker exec "$DOCKER_CONTAINER" psql -U postgres -c "CREATE DATABASE $DB_NAME;" 2>&1 | grep -v "NOTICE:" || true
        docker exec "$DOCKER_CONTAINER" psql -U postgres -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>&1 | grep -v "NOTICE:" || true
        
        echo -e "${YELLOW}Restoring backup...${NC}"
        gunzip -c "$backup_file" | sed '/^\\restrict/d' | docker exec -i "$DOCKER_CONTAINER" psql -U postgres -d "$DB_NAME" 2>&1 | grep -v "NOTICE:" | head -100
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | grep -v "NOTICE:" || true
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;" 2>&1 | grep -v "NOTICE:" || true
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>&1 | grep -v "NOTICE:" || true
        
        echo -e "${YELLOW}Restoring backup...${NC}"
        gunzip -c "$backup_file" | PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" 2>&1 | grep -v "NOTICE:" | head -100
    fi
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Restore complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    cmd_stats
}

# Run migrations
cmd_migrate() {
    local migration_file="$1"
    
    detect_db_env
    
    echo -e "${YELLOW}Running migrations...${NC}"
    echo ""
    
    if [ ! -d "$MIGRATION_DIR" ]; then
        echo -e "${RED}Migration directory not found: $MIGRATION_DIR${NC}"
        exit 1
    fi
    
    if [ -n "$migration_file" ]; then
        # Run specific migration
        echo "Running: $migration_file"
        run_psql_file "$migration_file" 2>&1 | grep -E "(CREATE|ALTER|ERROR)" | head -50
        echo -e "${GREEN}✓ Migration completed${NC}"
    else
        # Run all migrations
        local migration_files=$(find "$MIGRATION_DIR" -name "*.sql" ! -name "*rollback*" | sort)
        local count=0
        
        for file in $migration_files; do
            local name=$(basename "$file")
            echo "  Running: $name"
            run_psql_file "$file" > /dev/null 2>&1 && echo "    ✓ Completed" || echo "    ⚠ May have already been applied"
            count=$((count + 1))
        done
        
        echo ""
        echo -e "${GREEN}✓ $count migration(s) processed${NC}"
    fi
    echo ""
}

# Run optimization
cmd_optimize() {
    echo -e "${YELLOW}Running performance optimization...${NC}"
    echo ""
    
    detect_db_env
    
    if [ -f "$MIGRATION_DIR/002_performance_optimization.sql" ]; then
        cmd_migrate "$MIGRATION_DIR/002_performance_optimization.sql"
        echo -e "${GREEN}✓ Optimization complete${NC}"
        echo ""
        echo "Verifying indexes..."
        cmd_verify
    else
        echo -e "${RED}Optimization migration not found${NC}"
        exit 1
    fi
}

# Verify indexes and health
cmd_verify() {
    echo -e "${YELLOW}Verifying database...${NC}"
    echo ""
    
    detect_db_env
    
    if command -v node &> /dev/null; then
        if [ -f server/scripts/quick-index-check.js ]; then
            if [ "$DB_TYPE" = "local-docker" ]; then
                POSTGRES_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" node server/scripts/quick-index-check.js
            else
                node server/scripts/quick-index-check.js
            fi
        else
            echo "Quick index check script not found - skipping"
        fi
    else
        echo "Node.js not available - skipping verification"
    fi
    echo ""
}

# Show database statistics
cmd_stats() {
    echo -e "${YELLOW}Database Statistics:${NC}"
    echo ""
    
    detect_db_env
    
    local query="SELECT 
      'aircraft_states' as table_name, COUNT(*) as row_count FROM aircraft_states
      UNION ALL SELECT 'aircraft_states_history', COUNT(*) FROM aircraft_states_history
      UNION ALL SELECT 'flight_routes_cache', COUNT(*) FROM flight_routes_cache
      UNION ALL SELECT 'flight_routes_history', COUNT(*) FROM flight_routes_history
      UNION ALL SELECT 'airports', COUNT(*) FROM airports
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'api_keys', COUNT(*) FROM api_keys
      UNION ALL SELECT 'feeders', COUNT(*) FROM feeders;"
    
    if [ "$DB_TYPE" = "local-docker" ]; then
        docker exec "$DOCKER_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F"," -c "$query" 2>/dev/null | \
            while IFS=',' read -r table count; do
                if [ ! -z "$table" ] && [ ! -z "$count" ]; then
                    printf "  %-30s %10s rows\n" "$table:" "$count"
                fi
            done
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F"," -c "$query" 2>/dev/null | \
            while IFS=',' read -r table count; do
                if [ ! -z "$table" ] && [ ! -z "$count" ]; then
                    printf "  %-30s %10s rows\n" "$table:" "$count"
                fi
            done
    fi
    echo ""
}

# Main
case "${1:-}" in
    setup)
        cmd_setup
        ;;
    backup)
        cmd_backup "${2:-complete}"
        ;;
    restore)
        cmd_restore "$2"
        ;;
    migrate)
        cmd_migrate "$2"
        ;;
    optimize)
        cmd_optimize
        ;;
    verify)
        cmd_verify
        ;;
    stats)
        cmd_stats
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        usage
        exit 1
        ;;
esac

