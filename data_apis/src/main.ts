/* eslint-disable no-console */
import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";
import { S3PresignService } from "./infra/aws/s3PresignService.js";
import { DynamoEventRepository } from "./infra/aws/dynamoEventRepository.js";

const config = loadConfig();

// wire infrastructure adapters
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);
const dataLakeReader = new DynamoEventRepository(config);

// build Express app with dependencies injected
const app = createApp({ jobRepo, configStore, queue, fileUploadService, dataLakeReader });

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[API] listening on :${config.port}`);
});
