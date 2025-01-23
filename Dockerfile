# ---------------------------------------
# 1) Build the React front-end
# ---------------------------------------
FROM node:16 AS build-frontend

# Set working directory inside container
WORKDIR /app/client

# Copy only the files needed to install + build
COPY client/package.json client/package-lock.json* ./
# Install front-end dependencies
RUN npm install

# Copy the rest of the client code
COPY client/ .

# Build for production (creates /app/client/build)
RUN npm run build

# ---------------------------------------
# 2) Run server + serve built static files
# ---------------------------------------
FROM node:16

# Set working directory inside container
WORKDIR /fly-overhead

# Copy server package.json + package-lock (to install dependencies)
COPY server/package*.json server/

# Install server dependencies
RUN cd server && npm install

# Copy the rest of your server code
COPY server/ server/

# Copy the built React frontend from Stage 1 into server/client/build
COPY --from=build-frontend /app/client/build server/client/build

# Expose port 3005 to the outside world
EXPOSE 3005

# Set environment variable so our server knows which port to use
ENV PORT=3005

# Run your Node server
CMD ["node", "server/index.js"]
