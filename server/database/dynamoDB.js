const AWS = require('aws-sdk');
const axios = require('axios');

const docClient = new AWS.DynamoDB.DocumentClient({ region: 'us-west-1' });
const dynamoDBclient = new AWS.DynamoDB({ region: 'us-west-1' });

const tableExists = async () => {
  const params = {
    TableName: 'aircraft_states',
  };

  try {
    await dynamoDBclient.describeTable(params).promise();
    return true;
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
};

const createTable = async () => {
  const params = {
    TableName: 'aircraft_states',
    KeySchema: [
      { AttributeName: 'icao24', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'icao24', AttributeType: 'S' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 20,
    },
  };

  try {
    await dynamoDBclient.createTable(params).promise();
    console.log('DYNAMO Table aircraft_states created successfully.');
  } catch (error) {
    console.error('Error creating DynamoDB table:', error);
  }
};

const MAX_RETRIES = 5;
const INITIAL_BACKOFF = 100;

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
      created_at: state[17].toISOString(),
    },
  };

  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      await docClient.put(params).promise();
      console.log('STATE inserted/updated successfully', state.length, state);
      break;
    } catch (error) {
      if (error.code === 'ProvisionedThroughputExceededException') {
        retries += 1;
        const backoff = INITIAL_BACKOFF * 2 ** retries + Math.random() * 100; // introducing jitter
        console.log(`Throttled! Waiting for ${backoff}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        console.error('Error inserting/updating state in DynamoDB', error);
        throw error;
      }
    }
  }

  if (retries === MAX_RETRIES) {
    console.error('Max retries reached. Failed to insert/update state in DynamoDB for state:', state);
  }
};

const fetchDataForBoundingBox = async (box) => {
  const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`);

  const promises = areaRes.data.states.map((state) => {
    const currentStateWithDate = [...state, new Date()];
    return insertOrUpdateAircraftStateDynamo(currentStateWithDate);
  });

  await Promise.all(promises);
};

const populateDatabaseDynamo = async () => {
  try {
    const exists = await tableExists();
    if (!exists) {
      await createTable();
    }

    // const boundingBoxes = [
    //     { lamin: -90, lomin: -180, lamax: 0, lomax: 0 },
    //     { lamin: 0, lomin: -180, lamax: 90, lomax: 0 },
    //     { lamin: -90, lomin: 0, lamax: 0, lomax: 180 },
    //     { lamin: 0, lomin: 0, lamax: 90, lomax: 180 }
    // ];

    const boundingBoxes = [
      {
        lamin: 10, lomin: -170, lamax: 85, lomax: -55,
      },
    ];

    const fetchPromises = boundingBoxes.map((box) => fetchDataForBoundingBox(box));
    await Promise.all(fetchPromises);
    console.log('DYNAMO Database populated');
  } catch (err) {
    console.error('Error populating database:', err);
  }
};

const deleteStaleRecordsDynamo = async () => {
  try {
    const twoHoursAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const params = {
      TableName: 'aircraft_states',
      FilterExpression: 'created_at < :twoHoursAgo',
      ExpressionAttributeValues: {
        ':twoHoursAgo': twoHoursAgo,
      },
    };

    const result = await docClient.scan(params).promise();
    const itemsToDelete = result.Items;

    if (itemsToDelete.length === 0) {
      console.log('No stale records found.');
      return;
    }
    for (let i = 0; i < itemsToDelete.length; i += 25) {
      const batch = itemsToDelete.slice(i, i + 25);

      const deleteRequests = batch.map((item) => ({
        DeleteRequest: {
          Key: {
            icao24: item.icao24,
            created_at: item.created_at,
          },
        },
      }));

      const batchDeleteParams = {
        RequestItems: {
          aircraft_states: deleteRequests,
        },
      };

      await docClient.batchWrite(batchDeleteParams).promise();
    }

    console.log('Stale records deleted successfully.');
  } catch (err) {
    console.error('Error deleting stale records:', err);
  }
};

const batchSize = 25;

const prepareBatch = (states) => states.map((state) => ({
  PutRequest: {
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
      created_at: state[17].toISOString(),
    },
  },
}));

const batchWriteDynamo = async (batch) => {
  const params = {
    RequestItems: {
      aircraft_states: batch,
    },
  };
  try {
    await docClient.batchWrite(params).promise();
    console.log(`Batch of ${batch.length} items written successfully.`);
  } catch (error) {
    console.error('Error writing batch to DynamoDB', error);
  }
};

const updateDatabaseFromAPIDynamo = async () => {
  try {
    const areaRes = await axios.get(`https://${process.env.OPENSKY_USER}:${process.env.OPENSKY_PASS}@opensky-network.org/api/states/all`);

    const statesWithDate = areaRes.data.states.map((state) => [...state, new Date()]);

    const batchPromises = [];

    for (let i = 0; i < statesWithDate.length; i += batchSize) {
      const currentBatch = statesWithDate.slice(i, i + batchSize);
      const preparedBatch = prepareBatch(currentBatch);
      batchPromises.push(batchWriteDynamo(preparedBatch));
    }

    await Promise.all(batchPromises);

    console.log('DYNAMO Database updated successfully.');
  } catch (err) {
    console.error('Error updating database from API:', err);
  }
};

module.exports = {
  insertOrUpdateAircraftStateDynamo,
  populateDatabaseDynamo,
  updateDatabaseFromAPIDynamo,
  deleteStaleRecordsDynamo,
};
