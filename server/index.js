/* eslint-disable linebreak-style */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const {
  populateDatabase,
  deleteStaleRecords,
  updateDatabaseFromAPI,
} = require('./database/database');

const PORT = process.env.PORT || 3001;

const allowedOrigins = ['http://flyoverhead.com', 'http://www.flyoverhead.com', 'http://localhost:3000'];

const app = express();
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not '
                + 'allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
}));
app.use(express.json());
app.use(morgan('short'));

app.use('/api', require('./routes/openSkyRouter'));

updateDatabaseFromAPI();
populateDatabase();
// setInterval(updateDatabaseFromAPI, 360000);
// deleteStaleRecords();
setInterval(deleteStaleRecords, 600000);
app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));
