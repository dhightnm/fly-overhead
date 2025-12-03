# Aircraft Tracking and Visualization System

This project is a full-stack application for real-time aircraft tracking and visualization using data from the OpenSky Network API.

The system consists of a Node.js backend that fetches and stores aircraft data in both PostgreSQL and DynamoDB databases, and a React frontend for displaying the aircraft on an interactive map.

## Repository Structure

```
.
├── client/
│   ├── Dockerfile
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── App.js
│       ├── components/
│       ├── contexts/
│       └── index.js
├── package.json
└── server/
    ├── database/
    │   ├── database.js
    │   ├── dynamoDB.js
    │   └── dynamoDBConnection.js
    ├── index.js
    ├── package.json
    └── routes/
        ├── openSkyFlightsRouter.js
        └── openSkyRouter.js
```

The repository is organized into two main directories:

- `client/`: Contains the React frontend application
- `server/`: Houses the Node.js backend application

Key files:
- `server/index.js`: Entry point for the backend server
- `server/database/database.js`: Manages PostgreSQL database operations
- `server/database/dynamoDB.js`: Handles DynamoDB database operations
- `server/routes/openSkyRouter.js`: Defines API endpoints for aircraft data
- `client/src/App.js`: Main component of the React frontend
- `client/src/index.js`: Entry point for the React application

## Usage Instructions

### Prerequisites

- Node.js (v16.20.2 or later)
- Docker and Docker Compose
- PostgreSQL (via Docker)
- Redis (via Docker)

### Quick Start with Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd fly-overhead
   ```

2. **Set up environment variables:**
   Create a `.env` file in the root directory (see `.env.example` if available). Required variables:
   ```bash
   # Database
   POSTGRES_URL=postgresql://postgres:postgres@db:5432/fly_overhead
   REDIS_URL=redis://redis:6379
   
   # React App Environment Variables (baked into build at build time)
   REACT_APP_API_URL=http://localhost:3005
   REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id
   REACT_APP_STRIPE_PUBLISHABLE_KEY=your-stripe-key
   REACT_APP_STRIPE_PRICE_FLIGHT_TRACKING_PRO=price_xxx
   REACT_APP_STRIPE_PRICE_EFB_BASIC=price_xxx
   REACT_APP_STRIPE_PRICE_EFB_PRO=price_xxx
   REACT_APP_STRIPE_PRICE_API_STARTER=price_xxx
   REACT_APP_STRIPE_PRICE_API_PRO=price_xxx
   
   # Server Environment Variables
   JWT_SECRET=your-jwt-secret
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   STRIPE_SECRET_KEY=your-stripe-secret-key
   STRIPE_WEBHOOK_SECRET=your-webhook-secret
   ```

3. **Build and start the application:**
   ```bash
   npm run docker:dev:build
   ```

4. **Access the application:**
   - Frontend: `http://localhost:3005`
   - API: `http://localhost:3005/api`

#### Preserving the Timescale/Postgres volume

- The development stack stores **all PostgreSQL/Timescale data** (airports, weather cache, aircraft history, etc.) in the named volume `db-data` defined in `docker-compose.dev.yml`.
- This volume is **never removed** by normal `docker compose up`, `down`, or `restart` commands.  
- **Do NOT run** `docker compose down -v` (or `docker system prune --volumes`) unless you intentionally want to wipe the database. Doing so will delete the imported OurAirports data and any cached flight data.
- To rebuild the app while keeping data intact, use:
  - `npm run docker:dev:build` (rebuild images, keep volume)
  - `docker compose -f docker-compose.dev.yml down` (stop containers, keep volume)
  - `docker compose -f docker-compose.dev.yml up -d` (start containers again)
  - `docker compose -f docker-compose.dev.yml restart server` (restart the Node server only)

### Important Notes

**React Environment Variables:**
- All `REACT_APP_*` variables are **baked into the JavaScript bundle at build time**
- They are **NOT available at runtime** - they must be set when building the Docker image
- The `docker-compose.dev.yml` passes these as build arguments to Docker
- **Do NOT mount a local `client/build` directory** - it will override the Docker-built version
- If you need to rebuild the client with new env vars, run: `npm run docker:dev:build`

**Development Workflow:**
- Server code changes: Hot-reloaded automatically (no restart needed)
- Client code changes: Rebuild required (`npm run docker:dev:build`)
- Environment variable changes: Rebuild required (`npm run docker:dev:build`)

### Running Locally (Without Docker)

1. Install server dependencies:
   ```bash
   cd server
   npm install
   ```

2. Install client dependencies:
   ```bash
   cd ../client
   npm install
   ```

3. Set up environment variables in `.env` files (see above)

4. Start the backend server:
   ```bash
   cd server
   npm run dev
   ```

5. Start the frontend development server:
   ```bash
   cd client
   REACT_APP_GOOGLE_CLIENT_ID=your-id npm start
   ```

### API Endpoints

- `GET /api/aircraft`: Retrieve all aircraft states
- `GET /api/aircraft/:icao24`: Get aircraft information by ICAO24 code
- `GET /api/aircraft/bounds/:latmin/:lonmin/:latmax/:lonmax`: Get aircraft within specified geographical bounds
- `GET /api/airports/bounds/:latmin/:lonmin/:latmax/:lonmax`: Get airports within specified geographical bounds

### Testing & Quality

To run linting on the server code:
```
cd server
npm run lint
```

To automatically fix linting issues:
```
cd server
npm run fix
```

### Troubleshooting

1. Database Connection Issues:
   - Ensure PostgreSQL is running and the connection string is correct in `server/database/database.js`
   - Verify AWS credentials and region settings in `server/database/dynamoDBConnection.js`

2. API Rate Limiting:
   - If you encounter "429 Too Many Requests" errors from the OpenSky Network API, implement a delay between requests or reduce the frequency of updates.

3. Performance Optimization:
   - Monitor the `aircraft_states` table size in both PostgreSQL and DynamoDB
   - Adjust the `deleteStaleRecords` interval in `server/index.js` if necessary

## Data Flow

The application follows this data flow:

1. The backend server fetches aircraft data from the OpenSky Network API at regular intervals.
2. The fetched data is processed and stored in both PostgreSQL and DynamoDB databases.
3. The frontend React application requests aircraft data from the backend API.
4. The backend retrieves the requested data from the databases and sends it to the frontend.
5. The frontend renders the aircraft positions on an interactive map.

```
OpenSky API -> Backend Server -> Databases <-> Backend API <-> Frontend React App
```

Notes:
- The application uses both PostgreSQL and DynamoDB for data storage, providing flexibility and redundancy.
- Stale records are periodically removed from the databases to maintain performance.
- The frontend uses React contexts for state management and Leaflet for map rendering.

## Deployment

### Prerequisites

- Docker
- AWS CLI configured with appropriate permissions

### Deployment Steps

1. Build the Docker image for the client:
   ```
   cd client
   docker build -t aircraft-tracker-client .
   ```

2. Push the Docker image to your preferred container registry (e.g., Amazon ECR)

3. Deploy the backend to your preferred hosting platform (e.g., AWS EC2, Heroku)

4. Update the frontend API endpoint to point to your deployed backend

5. Deploy the frontend Docker image to a container hosting service (e.g., AWS ECS, Heroku)

### Environment Configurations

- Ensure all environment variables are properly set in your deployment environment
- Configure CORS settings in the backend to allow requests from the deployed frontend URL

## Infrastructure

The project uses AWS DynamoDB for data storage. The main infrastructure components are:

- DynamoDB:
  - Table: `aircraft_states`
    - Primary Key: `icao24` (String)
    - Attributes: Various aircraft state data (e.g., callsign, position, altitude)

- AWS SDK Configuration:
  - Region: `us-west-1`
  - Access is configured using AWS access key ID and secret access key

Note: Ensure that the AWS credentials used have the necessary permissions to perform operations on the DynamoDB table.
