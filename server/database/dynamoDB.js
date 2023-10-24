const AWS = require('aws-sdk');
const axios = require('axios');
const docClient = new AWS.DynamoDB.DocumentClient({region: "us-west-1"});
const dynamoDBclient = new AWS.DynamoDB({region: "us-west-1"});

const tableExists = async () => {
    const params = {
        TableName: 'aircraft_states'
    };
    
    try {
        await dynamoDBclient.describeTable(params).promise();
        return true;  // Table exists
    } catch (error) {
        if (error.code === 'ResourceNotFoundException') {
            return false;  // Table does not exist
        } else {
            throw error;  // Some other error occurred
        }
    }
};

const createTable = async () => {
    const params = {
        TableName: 'aircraft_states',
        KeySchema: [
            { AttributeName: 'icao24', KeyType: 'HASH' },  // Partition key
        ],
        AttributeDefinitions: [
            { AttributeName: 'icao24', AttributeType: 'S' }  // 'S' means string
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 20
        }
    };

    try {
        await dynamoDBclient.createTable(params).promise();
        console.log("DYNAMO Table aircraft_states created successfully.");
    } catch (error) {
        console.error('Error creating DynamoDB table:', error);
    }
};

const MAX_RETRIES = 5;
const INITIAL_BACKOFF = 100;  // start with 100ms

const insertOrUpdateAircraftStateDynamo = async (state) => {
    const params = {
        TableName: 'aircraft_states',
        Item: {
            icao24: state[0],
            callsign: state[1].trim(),
            origin_country: state[2],
            time_position: state[3],
            last_contact: state[4],
            longitude: state[5],
            latitude: state[6],
            baro_altitude: state[7],
            on_ground: state[8],
            velocity: state[9],
            true_track: state[10],
            vertical_rate: state[11],
            sensors: state[12],
            geo_altitude: state[13],
            squawk: state[14],
            spi: state[15],
            position_source: state[16],
            created_at: state[17].toISOString()
        }
    };

    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            await docClient.put(params).promise(); // I noticed you used dynamoDB instead of dynamoDBclient, correcting it here
            console.log("STATE inserted/updated successfully", state.length, state);

            // if successful, break out of the loop
            break;
        } catch (error) {
            if (error.code === 'ProvisionedThroughputExceededException') {
                retries++;
                const backoff = INITIAL_BACKOFF * Math.pow(2, retries) + Math.random() * 100; // introducing jitter
                console.log(`Throttled! Waiting for ${backoff}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
            } else {
                // for other errors, just throw them
                console.error('Error inserting/updating state in DynamoDB', error);
                throw error;
            }
        }
    }

    // Handle the situation where all retry attempts fail
    if (retries === MAX_RETRIES) {
        console.error('Max retries reached. Failed to insert/update state in DynamoDB for state:', state);
    }
};

const populateDatabaseDynamo = async () => {
    try {
        const exists = await tableExists();
        if (!exists) {
            await createTable();
        }

        const boundingBoxes = [
            { lamin: -90, lomin: -180, lamax: 0, lomax: 0 },
            { lamin: 0, lomin: -180, lamax: 90, lomax: 0 },
            { lamin: -90, lomin: 0, lamax: 0, lomax: 180 },
            { lamin: 0, lomin: 0, lamax: 90, lomax: 180 }
        ];

        const fetchPromises = boundingBoxes.map(box => fetchDataForBoundingBox(box));
        await Promise.all(fetchPromises);
        console.log('DYNAMO Database populated');
    } catch (err) {
        console.error('Error populating database:', err);
    }
};


const fetchDataForBoundingBox = async (box) => {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`);
    const promises = [];
    for (const state of areaRes.data.states) {
        const currentStateWithDate = [...state, new Date()];
        promises.push(insertOrUpdateAircraftStateDynamo(currentStateWithDate));
    }
    await Promise.all(promises);
}

const updateDatabaseFromAPIDynamo = async () => {
    try {
        const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);
        
        for (const state of areaRes.data.states) {
            console.log("CALLSIGN", state[1])
            const currentStateWithDate = [...state, new Date()];
            await insertOrUpdateAircraftStateDynamo(currentStateWithDate);
        }
        console.log('DYNAMO Database updated successfully.');
    } catch (err) {
        console.error('Error updating database from API:', err);
    }
};

module.exports = { insertOrUpdateAircraftStateDynamo, populateDatabaseDynamo, updateDatabaseFromAPIDynamo };