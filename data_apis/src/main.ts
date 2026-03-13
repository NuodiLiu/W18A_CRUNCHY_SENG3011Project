import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";
import { S3PresignService } from "./infra/aws/s3PresignService.js";
import { S3DataLakeReader } from "./infra/aws/s3DataLakeReader.js";

const config = loadConfig();

// wire infrastructure adapters
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);
const dataLakeReader = new S3DataLakeReader(config);

// build Express app with dependencies injected
const app = createApp({ jobRepo, configStore, queue, fileUploadService, dataLakeReader });

app.listen(config.port, () => {
  console.log(`[API] listening on :${config.port}`);
});
