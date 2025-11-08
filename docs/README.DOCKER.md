# Docker Development Guide

## Quick Start

### Development Mode (Recommended for Active Development)
Use volume mounts so code changes are reflected immediately without rebuilds:

```bash
# Start in development mode (code changes reflect immediately)
docker compose -f docker-compose.dev.yml up -d

# Or use npm scripts (if package.json exists in root)
npm run docker:dev
```

**Benefits:**
- ✅ Code changes reflect immediately (no rebuild needed)
- ✅ Fast iteration during development  
- ✅ No wasted time rebuilding containers
- ⚠️ Requires manual server restart after changes (or use nodemon)

**To enable auto-restart on file changes:**
1. Install nodemon: Already in `server/package.json` devDependencies
2. Change CMD in Dockerfile.dev (if you create one) or use: `docker exec fly-overhead-server npm run dev`

### Production Mode
For production builds or when you need a clean build:

```bash
# Standard production build
docker compose up -d

# Force rebuild (when code changes aren't showing up)
docker compose build --no-cache server
docker compose restart server

# Or use npm script
npm run docker:rebuild
```

## When to Use Each Mode

### Development Mode (`docker-compose.dev.yml`)
- ✅ **Use during active development**
- ✅ Code changes are immediate (volume mounts)
- ✅ No rebuild time wasted
- ⚠️ Node modules are preserved in container (may need rebuild if adding packages)

### Production Mode (`docker-compose.yml`)
- ✅ **Use for testing production builds**
- ✅ **Use for deployment**
- ✅ Fully isolated build
- ⚠️ Requires rebuild for every code change

## Troubleshooting

### Code changes not showing up?

**Development mode:**
1. Check if volume mount is working: `docker exec fly-overhead-server ls -la /app/server/services/`
2. Restart server: `npm run docker:dev:restart`
3. Check file permissions

**Production mode:**
1. Force rebuild: `npm run docker:rebuild`
2. Verify file is copied: `docker exec fly-overhead-server cat /app/server/services/FlightRouteService.js | grep "your-change"`
3. Check `.dockerignore` - make sure it's not excluding your files

### Best Practices

1. **During development:** Always use `docker-compose.dev.yml` for instant code updates
2. **Before testing:** Use production mode to catch any build issues
3. **Before deploying:** Always test with production build (`docker compose build`)

## Commands Reference

```bash
# Development
npm run docker:dev              # Start dev mode
npm run docker:dev:build        # Rebuild dev container
npm run docker:dev:restart      # Restart dev server
npm run docker:dev:down         # Stop dev containers

# Production
npm run docker:prod             # Start production mode
npm run docker:prod:build       # Rebuild production container
npm run docker:prod:restart     # Restart production server
npm run docker:prod:down       # Stop production containers

# Nuclear option (full clean rebuild)
npm run docker:rebuild          # Down, rebuild with --no-cache, up
```

