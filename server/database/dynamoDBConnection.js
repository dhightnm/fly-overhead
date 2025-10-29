const AWS = require('aws-sdk');

AWS.config.update({
  region: process.env.AWS_REGION || 'us-west-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB();

dynamoDB.listTables({}, (err, data) => {
  if (err) {
    console.error('Error listing tables:', err);
  } else {
    console.log('Tables:', data.TableNames);
  }
});
