# ---------------------------------------
# 1) Build the React front-end
# ---------------------------------------
FROM node:18 AS build-frontend

# Set working directory inside container
WORKDIR /app/client

# Copy only the files needed to install + build
COPY client/package*.json ./
# Install front-end dependencies
RUN npm install --production=false

# Copy the rest of the client code
COPY client/ .

# Build for production (creates /app/client/build)
# Node 18 should handle the build without needing the openssl-legacy-provider flag
RUN npm run build

# ---------------------------------------
# 2) Run server + serve built static files
# ---------------------------------------
FROM node:18

# Build argument for cache busting (optional, set via docker compose)
ARG BUILD_DATE
ENV BUILD_DATE=${BUILD_DATE}

# Set working directory inside container
WORKDIR /app

# Copy only server package.json (to install dependencies)
COPY server/package*.json ./server/

# Install server dependencies (including dev dependencies for TypeScript build)
WORKDIR /app/server
RUN npm install --legacy-peer-deps

# Copy the rest of your server code (includes tsconfig files)
# Note: We're in /app/server, so we copy server contents to current directory (.)
COPY server/ ./

# Verify tsconfig files are present before building
RUN ls -la tsconfig*.json || (echo "ERROR: tsconfig files not found!" && exit 1)

# Build TypeScript to JavaScript
RUN npm run build

# Verify build succeeded
RUN if [ ! -f dist/index.js ]; then \
      echo "ERROR: TypeScript build failed - dist/index.js not found!" && \
      exit 1; \
    fi && \
    echo "TypeScript build successful!"

# Remove dev dependencies to reduce image size
# Note: Using --legacy-peer-deps to handle ESLint peer dependency conflicts
RUN npm prune --production --legacy-peer-deps || npm prune --production

# Set working directory back to /app
WORKDIR /app

# Copy the built React frontend from Stage 1 into server/client/build
COPY --from=build-frontend /app/client/build ./server/client/build

# Expose port 3005 to the outside world
EXPOSE 3005

# Set environment variable so our server knows which port to use
ENV PORT=3005
ENV NODE_ENV=production

# Run your Node server (now using compiled TypeScript)
CMD ["node", "server/dist/index.js"]
