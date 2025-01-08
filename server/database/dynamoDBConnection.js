const AWS = require('aws-sdk');

AWS.config.update({
  region: 'us-west-1',
  accessKeyId: 'AKIAQGFDTCBMD2DJQKEX',
  secretAccessKey: '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',
});

const dynamoDB = new AWS.DynamoDB();

dynamoDB.listTables({}, (err, data) => {
  if (err) {
    console.error('Error listing tables:', err);
  } else {
    console.log('Tables:', data.TableNames);
  }
});
