# Server Dockerfile for fly-overhead
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY src/ ./src/
COPY config/ ./config/
COPY utils/ ./utils/
COPY database/ ./database/

# Build TypeScript to JavaScript
RUN npm run build

# Expose port
EXPOSE 3005

# Set environment
ENV NODE_ENV=production
ENV PORT=3005

# Start server
CMD ["node", "dist/index.js"]

