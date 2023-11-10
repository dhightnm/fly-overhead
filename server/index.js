const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const {
  populateDatabase,
  deleteStaleRecords,
  updateDatabaseFromAPI,
} = require('./database/database');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('short'));

app.use('/api', require('./routes/openSkyRouter'));

updateDatabaseFromAPI();
populateDatabase();
setInterval(updateDatabaseFromAPI, 360000);
deleteStaleRecords();
setInterval(deleteStaleRecords, 600000);
app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));
