const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("short"));

app.use('/api', require('./routes/openSkyRouter'));


// use for server side rendering later

// app.use(express.static(path.join(__dirname, "..", "build")));
// app.use(express.static("public"));

// app.use((req, res, next) => {
//     res.sendFile(path.join(__dirname, "..", "client", "public/index.html"));
//   });

app.listen(PORT, () => console.log(`Listening on port: ${PORT}`));