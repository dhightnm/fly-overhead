/* eslint-disable linebreak-style */
const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const {
  createMainTable,
  createHistoryTable,
  populateDatabase,
  deleteStaleRecords,
  updateDatabaseFromAPI,
} = require('./database/database');

const PORT = process.env.PORT || 3001;
console.log('PORT SERVER:', PORT);

const allowedOrigins = [
  'http://flyoverhead.com',
  'http://www.flyoverhead.com',
  `http://localhost:${PORT}`,
];

const app = express();

// Configure CORS
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.includes(origin)) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
}));

// Middleware
app.use(express.json());
app.use(morgan('short'));

app.use(express.static(path.join(__dirname, 'client/build')));

// Routes
app.use('/api', require('./routes/openSkyRouter'));

/**
 * Initialize the database tables, then start polling 
 * and set up intervals for updates/deletes.
 */
async function startServer() {
  try {
    // 1) Create tables if they don't exist
    await createMainTable();
    await createHistoryTable();

    // 2) Initially update the database & populate bounding boxes
    updateDatabaseFromAPI();
    populateDatabase();

    // 3) Schedule periodic updates if desired
    // e.g., every 6 minutes:
    setInterval(updateDatabaseFromAPI, 120000);

    // 4) Schedule stale record cleanup (here: every 10 minutes)
    // setInterval(deleteStaleRecords, 600000);

    // 5) Start the server
    app.listen(PORT, () => {
      console.log(`Listening on port: ${PORT}`);
    });
  } catch (err) {
    console.error('Error starting server:', err);
  }
}

// Call our async init function
startServer();
