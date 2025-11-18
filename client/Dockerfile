# Build stage
FROM node:20-slim AS build

WORKDIR /app

# Accept build argument for API URL
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=${REACT_APP_API_URL}

# Set OpenSSL legacy provider for webpack 4 compatibility
ENV NODE_OPTIONS=--openssl-legacy-provider

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Build for production
RUN npm run build

# Production stage - serve with nginx
FROM nginx:alpine

# Copy built app to nginx
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration (if exists, otherwise use default)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

