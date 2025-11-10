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

# Install server dependencies
WORKDIR /app/server
RUN npm install --production

# Set working directory back to /app
WORKDIR /app

# Copy the rest of your server code
# Use .dockerignore to exclude node_modules, but include all source files
# This layer will be invalidated when any server/*.js file changes
COPY server/ ./server/

# Copy the built React frontend from Stage 1 into server/client/build
COPY --from=build-frontend /app/client/build ./server/client/build

# Expose port 3005 to the outside world
EXPOSE 3005

# Set environment variable so our server knows which port to use
ENV PORT=3005
ENV NODE_ENV=production

# Run your Node server
CMD ["node", "server/index.js"]
