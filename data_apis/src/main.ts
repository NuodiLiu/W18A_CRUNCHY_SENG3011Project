import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";

const config = loadConfig();

// Wire infrastructure adapters
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);

// Build Express app with dependencies injected
const app = createApp({ jobRepo, configStore, queue });

app.listen(config.port, () => {
  console.log(`[API] listening on :${config.port}`);
});
