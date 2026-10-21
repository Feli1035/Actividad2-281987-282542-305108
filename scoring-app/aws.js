// Clientes de SQS y DynamoDB compartidos por la API y el worker.
// AWS_ENDPOINT_URL solo se define para probar localmente contra LocalStack.
const { SQSClient } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const config = { region: process.env.AWS_REGION || 'us-east-1' };
if (process.env.AWS_ENDPOINT_URL) {
    config.endpoint = process.env.AWS_ENDPOINT_URL;
}

const sqs = new SQSClient(config);
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(config));

module.exports = {
    sqs,
    dynamo,
    QUEUE_URL: process.env.QUEUE_URL,
    TABLE_NAME: process.env.TABLE_NAME || 'Scorings',
};
