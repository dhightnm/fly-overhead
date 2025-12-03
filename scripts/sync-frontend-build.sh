#!/bin/bash

# Script to rebuild frontend and sync to Docker container
# This ensures the build folder is properly updated in the container
# Usage:
#   ./scripts/sync-frontend-build.sh          # Build and restart (uses volume mount)
#   ./scripts/sync-frontend-build.sh --copy  # Build and copy directly to container

set -e

echo "🔨 Building frontend..."
# Load REACT_APP_* vars from root .env so the build has Google client ID, etc.
if [ -f ./.env ]; then
  echo "ℹ️  Loading REACT_APP_* variables from .env"
  # shellcheck disable=SC2046
  export $(grep -E '^REACT_APP_' ./.env | xargs)
fi
cd client
npm run build
cd ..

echo "✅ Frontend build complete"
echo "📦 Build folder location: ./client/build"
echo ""

# Check if container is running
if ! docker ps | grep -q fly-overhead-server; then
  echo "⚠️  Container 'fly-overhead-server' is not running"
  echo "   Start it with: npm run docker:dev"
  exit 1
fi

# Optional: Copy to container if volume mount isn't working
if [ "$1" == "--copy" ]; then
  echo "📋 Copying build directly to container (bypassing volume mount)..."
  # Stop container temporarily to copy
  docker compose -f docker-compose.dev.yml stop server
  # Remove the read-only mount by copying to a temp location first, then moving
  docker cp ./client/build/. fly-overhead-server:/tmp/client-build/
  # Start container and exec to move files (since volume is read-only, we need to work around it)
  docker compose -f docker-compose.dev.yml start server
  docker exec fly-overhead-server sh -c "rm -rf /app/server/client/build/* && cp -r /tmp/client-build/* /app/server/client/build/ 2>/dev/null || echo 'Note: Volume may be read-only, restarting container to pick up local build...'"
  echo "🔄 Restarting server to pick up changes..."
  docker compose -f docker-compose.dev.yml restart server
  echo "✅ Done! Changes should be visible now."
else
  echo "🔄 Restarting server to pick up volume mount changes..."
  docker compose -f docker-compose.dev.yml restart server
  echo "✅ Server restarted"
  echo ""
  echo "💡 If changes don't appear, try:"
  echo "   1. Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)"
  echo "   2. Clear browser cache"
  echo "   3. Check if build folder exists: ls -la ./client/build"
fi
