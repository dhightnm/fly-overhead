# ---------------------------------------
# 1) Build the React front-end
# ---------------------------------------
FROM node:20 AS build-frontend

# Accept build arguments for React environment variables
ARG REACT_APP_API_URL
ARG REACT_APP_GOOGLE_CLIENT_ID
ARG REACT_APP_STRIPE_PRICE_FLIGHT_TRACKING_PRO
ARG REACT_APP_STRIPE_PRICE_EFB_BASIC
ARG REACT_APP_STRIPE_PRICE_EFB_PRO
ARG REACT_APP_STRIPE_PRICE_API_STARTER
ARG REACT_APP_STRIPE_PRICE_API_PRO
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_GOOGLE_CLIENT_ID=${REACT_APP_GOOGLE_CLIENT_ID}
ENV REACT_APP_STRIPE_PRICE_FLIGHT_TRACKING_PRO=${REACT_APP_STRIPE_PRICE_FLIGHT_TRACKING_PRO}
ENV REACT_APP_STRIPE_PRICE_EFB_BASIC=${REACT_APP_STRIPE_PRICE_EFB_BASIC}
ENV REACT_APP_STRIPE_PRICE_EFB_PRO=${REACT_APP_STRIPE_PRICE_EFB_PRO}
ENV REACT_APP_STRIPE_PRICE_API_STARTER=${REACT_APP_STRIPE_PRICE_API_STARTER}
ENV REACT_APP_STRIPE_PRICE_API_PRO=${REACT_APP_STRIPE_PRICE_API_PRO}

# Set working directory inside container
WORKDIR /app/client

# Copy only the files needed to install + build
COPY client/package*.json ./
# Install front-end dependencies
RUN npm install --production=false

# Copy the rest of the client code
COPY client/ .

# Build for production (creates /app/client/build)
RUN npm run build

# ---------------------------------------
# 2) Run server + serve built static files
# ---------------------------------------
FROM node:20

# Build argument for cache busting (optional, set via docker compose)
ARG BUILD_DATE
ENV BUILD_DATE=${BUILD_DATE}

# Set working directory inside container
WORKDIR /app

# Copy only server package.json (to install dependencies)
COPY server/package*.json ./server/
COPY server/tsconfig*.json ./server/

# Install server dependencies (including TypeScript)
WORKDIR /app/server
RUN npm install --legacy-peer-deps

# Copy the TypeScript source code
COPY server/src/ ./src/
COPY server/config/ ./config/
COPY server/utils/ ./utils/
COPY server/database/ ./database/
COPY server/migrations/ ./migrations/

# Build TypeScript to JavaScript
RUN npm run build

# Set working directory back to /app
WORKDIR /app

# Copy the built React frontend from Stage 1 into server/client/build
COPY --from=build-frontend /app/client/build ./server/client/build

# Expose port 3005 to the outside world
EXPOSE 3005

# Set environment variable so our server knows which port to use
ENV PORT=3005
ENV NODE_ENV=production

# Run the compiled TypeScript server
CMD ["node", "server/dist/index.js"]
