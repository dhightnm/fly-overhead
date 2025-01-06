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
- PostgreSQL
- AWS account with DynamoDB access
- OpenSky Network API credentials

### Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd <repository-name>
   ```

2. Install server dependencies:
   ```
   cd server
   npm install
   ```

3. Install client dependencies:
   ```
   cd ../client
   npm install
   ```

4. Set up environment variables:
   Create a `.env` file in the `server/` directory with the following content:
   ```
   OPENSKY_USER=<your-opensky-username>
   OPENSKY_PASS=<your-opensky-password>
   PORT=3002
   ```

5. Configure database connections:
   - Update the PostgreSQL connection string in `server/database/database.js`
   - Set up AWS credentials for DynamoDB in `server/database/dynamoDBConnection.js`

### Running the Application

1. Start the backend server:
   ```
   cd server
   npm run dev
   ```

2. Start the frontend development server:
   ```
   cd client
   npm start
   ```

3. Access the application in your web browser at `http://localhost:3000`

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