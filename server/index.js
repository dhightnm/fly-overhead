const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const PORT = process.env.PORT || 3001;
const { 
    db,
    populateDatabase, 
    updateDatabaseFromAPI,
    deleteStaleRecords
}  = require('./database/database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("short"));

    

app.use('/api', require('./routes/openSkyRouter'));


populateDatabase();
setInterval(updateDatabaseFromAPI, 10000);
setInterval(deleteStaleRecords, 2 * 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));