const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv').config();
const https = require('https');
const fs = require('fs');
const {
  populateDatabase,
  deleteStaleRecords,
  updateDatabaseFromAPI,
} = require('./database/database');

const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

const privateKey = fs.readFileSync(process.env.SSL_KEY_PATH, 'utf8');
const certificate = fs.readFileSync(process.env.SSL_CERT_PATH, 'utf8');
const ca = process.env.SSL_CA_PATH ? fs.readFileSync(process.env.SSL_CA_PATH, 'utf8') : null;

const credentials = ca
  ? { key: privateKey, cert: certificate, ca }
  : { key: privateKey, cert: certificate };

const app = express();
app.use(cors({
  origin: 'http://localhost:3000',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
}));
app.use(express.json());
app.use(morgan('short'));

app.use('/api', require('./routes/openSkyRouter'));

const httpsServer = https.createServer(credentials, app);

updateDatabaseFromAPI();
populateDatabase();
setInterval(updateDatabaseFromAPI, 360000);
deleteStaleRecords();
// setInterval(deleteStaleRecords, 600000);
// app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));
httpsServer.listen(HTTPS_PORT, () => console.log(`Listening on HTTPS port: ${HTTPS_PORT}`));
