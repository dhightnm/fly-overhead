const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const {
  updateDatabaseFromAPIDynamo,
  deleteStaleRecordsDynamo,
} = require('./database/dynamoDB');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('short'));

app.use('/api', require('./routes/openSkyRouter'));

// populateDatabase();
// populateDatabaseDynamo();
// updateDatabaseFromAPIDynamo();
// setInterval(updateDatabaseFromAPIDynamo, 60000);
// setInterval(updateDatabaseFromAPI, 300000);
// deleteStaleRecordsDynamo();
// setInterval(deleteStaleRecordsDynamo, 2 * 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));
