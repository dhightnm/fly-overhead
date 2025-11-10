# Scripts Consolidation Guide

## Overview

All database and deployment scripts have been consolidated into two manager scripts to reduce redundancy and complexity.

## New Consolidated Scripts

### 1. `db-manager.sh` - All Database Operations

Consolidates these old scripts:
- ✅ `setup-database.sh`
- ✅ `restore-database-local.sh`
- ✅ `restore-database.sh`
- ✅ `quick-backup.sh`
- ✅ `lightsail-backup-and-migrate.sh`
- ✅ `migrate-api-keys.sh`

**Commands:**
```bash
# Set up database with all migrations
./db-manager.sh setup

# Create a backup
./db-manager.sh backup                    # Regular backup
./db-manager.sh backup lightsail          # Backup with Lightsail migration info

# Restore from backup (works for both local Docker and remote)
./db-manager.sh restore backups/backup.sql.gz

# Run migrations
./db-manager.sh migrate                   # Run all migrations
./db-manager.sh migrate server/migrations/001_*.sql  # Run specific migration

# Run performance optimization
./db-manager.sh optimize

# Verify database indexes and health
./db-manager.sh verify

# Show database statistics
./db-manager.sh stats
```

### 2. `deploy-manager.sh` - Docker Build and AWS Deployment

Consolidates these old scripts:
- ✅ `rebuild-docker.sh`
- ✅ `setup-ecr.sh`

**Commands:**
```bash
# Build Docker image
./deploy-manager.sh build                 # Production build
./deploy-manager.sh build dev             # Development build

# Rebuild containers (no cache)
./deploy-manager.sh rebuild               # Production rebuild
./deploy-manager.sh rebuild dev           # Development rebuild

# Push to AWS ECR
./deploy-manager.sh push us-east-2        # Push to ECR in us-east-2

# Full deployment (build + push)
./deploy-manager.sh deploy us-east-2      # Build and push

# Container management
./deploy-manager.sh start                 # Start containers
./deploy-manager.sh start dev             # Start dev containers
./deploy-manager.sh stop                  # Stop containers
./deploy-manager.sh logs                  # Show logs
```

## Features of New Scripts

### Smart Environment Detection

Both scripts automatically detect your environment:
- **Local Docker**: Detects `fly-overhead-postgres` container
- **Remote Database**: Reads from `.env` file
- No manual configuration needed!

### Unified Interface

- Same commands work for both local and remote databases
- Consistent error handling and colored output
- Progress indicators and verification
- Safety checks (confirmation for destructive operations)

### Integration with Existing Tools

- Integrates with Node.js diagnostic scripts
- Uses existing migrations automatically
- Works with both Docker and native PostgreSQL

## Migration Steps

### Step 1: Test the New Scripts

```bash
# Try the new commands
./db-manager.sh stats
./db-manager.sh verify
./deploy-manager.sh build dev
```

### Step 2: Remove Old Scripts (After Verifying)

Once you're confident the new scripts work, remove the old ones:

```bash
rm setup-database.sh
rm restore-database-local.sh
rm restore-database.sh
rm quick-backup.sh
rm lightsail-backup-and-migrate.sh
rm migrate-api-keys.sh
rm rebuild-docker.sh
rm setup-ecr.sh
```

### Step 3: Update Your Workflow

**Old Workflow:**
```bash
# Setup database
./setup-database.sh

# Create backup
./quick-backup.sh

# Restore local
./restore-database-local.sh backups/backup.sql.gz

# Rebuild Docker
./rebuild-docker.sh dev

# Push to ECR
./setup-ecr.sh
```

**New Workflow:**
```bash
# Setup database
./db-manager.sh setup

# Create backup
./db-manager.sh backup

# Restore (auto-detects local vs remote)
./db-manager.sh restore backups/backup.sql.gz

# Rebuild Docker
./deploy-manager.sh rebuild dev

# Deploy to ECR
./deploy-manager.sh deploy us-east-2
```

## Command Mapping

### Database Operations

| Old Command | New Command |
|-------------|-------------|
| `./setup-database.sh` | `./db-manager.sh setup` |
| `./quick-backup.sh` | `./db-manager.sh backup` |
| `./lightsail-backup-and-migrate.sh` | `./db-manager.sh backup lightsail` |
| `./restore-database-local.sh FILE` | `./db-manager.sh restore FILE` |
| `./restore-database.sh FILE` | `./db-manager.sh restore FILE` |
| `./migrate-api-keys.sh` | `./db-manager.sh migrate` |
| N/A | `./db-manager.sh optimize` (NEW!) |
| N/A | `./db-manager.sh verify` (NEW!) |
| N/A | `./db-manager.sh stats` (NEW!) |

### Deployment Operations

| Old Command | New Command |
|-------------|-------------|
| `./rebuild-docker.sh` | `./deploy-manager.sh rebuild` |
| `./rebuild-docker.sh dev` | `./deploy-manager.sh rebuild dev` |
| `./setup-ecr.sh` | `./deploy-manager.sh push us-east-2` |
| N/A | `./deploy-manager.sh build` (NEW!) |
| N/A | `./deploy-manager.sh deploy us-east-2` (NEW!) |
| N/A | `./deploy-manager.sh start` (NEW!) |
| N/A | `./deploy-manager.sh stop` (NEW!) |
| N/A | `./deploy-manager.sh logs` (NEW!) |

## Benefits

### Before (8 scripts)
- ❌ Multiple scripts doing similar things
- ❌ Different interfaces for local vs remote
- ❌ Hardcoded database configurations
- ❌ Duplicated backup/restore logic
- ❌ No verification or optimization commands

### After (2 scripts)
- ✅ Unified interface for all operations
- ✅ Auto-detects environment (local Docker vs remote)
- ✅ Smart configuration loading
- ✅ Single source of truth for logic
- ✅ Built-in verification and optimization
- ✅ Better error handling and safety checks
- ✅ Colored output and progress indicators

## Quick Reference

```bash
# ===== DATABASE OPERATIONS =====
./db-manager.sh setup             # Initialize database
./db-manager.sh backup            # Create backup
./db-manager.sh restore FILE      # Restore backup
./db-manager.sh migrate           # Run migrations
./db-manager.sh optimize          # Optimize performance
./db-manager.sh verify            # Check indexes
./db-manager.sh stats             # Show statistics

# ===== DEPLOYMENT OPERATIONS =====
./deploy-manager.sh build         # Build image
./deploy-manager.sh rebuild       # Rebuild (no cache)
./deploy-manager.sh push REGION   # Push to ECR
./deploy-manager.sh deploy REGION # Build + push
./deploy-manager.sh start         # Start containers
./deploy-manager.sh stop          # Stop containers
./deploy-manager.sh logs          # View logs
```

## Troubleshooting

### "Cannot detect database environment"

Make sure either:
- Docker container `fly-overhead-postgres` is running, OR
- `.env` file exists with `POSTGRES_URL`

### "AWS credentials not configured"

Run `aws configure` or set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_DEFAULT_REGION=us-east-2
```

### "Migration failed"

Check if the migration was already applied:
```bash
./db-manager.sh stats
```

Most migration errors are harmless if the schema already exists.

## Examples

### Complete Local Development Setup

```bash
# 1. Start and set up database
./db-manager.sh setup

# 2. Build and start dev containers
./deploy-manager.sh rebuild dev

# 3. Verify everything
./db-manager.sh verify
./db-manager.sh stats
```

### Backup and Restore Workflow

```bash
# Create backup
./db-manager.sh backup

# Later... restore it
./db-manager.sh restore backups/fly_overhead_complete_20251109_120000.sql.gz
```

### Deploy to Lightsail

```bash
# 1. Create backup with Lightsail info
./db-manager.sh backup lightsail

# 2. Build and push to ECR
./deploy-manager.sh deploy us-east-2

# 3. Follow the output instructions for Lightsail setup
```

### Performance Optimization

```bash
# Run performance migration
./db-manager.sh optimize

# Verify indexes were created
./db-manager.sh verify

# Check query performance
cd server && TEST_DB_URL="postgresql://postgres:postgres@localhost:5433/fly_overhead" node scripts/test-query-performance.js
```

## Notes

- All scripts are safe to run multiple times
- Destructive operations require confirmation
- Automatic environment detection prevents errors
- Colored output makes it easy to spot issues
- Progress indicators for long-running operations

---

**Migration Status:** ✅ Ready to use
**Old Scripts:** Can be deleted after testing
**Documentation:** This guide + inline help in scripts

