# Database & Deployment Scripts

Quick reference for the consolidated management scripts.

## 📦 Two Scripts to Rule Them All

### `db-manager.sh` - Database Operations
### `deploy-manager.sh` - Docker & AWS Deployment

## Common Commands

### Database

```bash
# Setup fresh database
./db-manager.sh setup

# Backup database
./db-manager.sh backup

# Restore from backup
./db-manager.sh restore backups/backup_file.sql.gz

# Run performance optimization
./db-manager.sh optimize

# Check database health
./db-manager.sh verify
./db-manager.sh stats
```

### Deployment

```bash
# Rebuild for development
./deploy-manager.sh rebuild dev

# Deploy to AWS ECR
./deploy-manager.sh deploy us-east-2

# Quick container management
./deploy-manager.sh start
./deploy-manager.sh stop
./deploy-manager.sh logs
```

## Help

```bash
./db-manager.sh help
./deploy-manager.sh help
```

## Full Documentation

See [SCRIPTS_MIGRATION_GUIDE.md](./SCRIPTS_MIGRATION_GUIDE.md) for:
- Complete command reference
- Migration from old scripts
- Examples and troubleshooting
- Command mapping guide

