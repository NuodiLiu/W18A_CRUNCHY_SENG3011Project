import { loadConfig } from "./config/index.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { DynamoStateStore } from "./infra/aws/dynamoStateStore.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { S3DataLakeWriter } from "./infra/aws/s3DataLakeWriter.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";
import { createConnector } from "./infra/connectors/connectorFactory.js";
import { runJob, RunJobDeps } from "./application/worker/runJob.js";

const config = loadConfig();

const queue = new SQSQueueService(config);
const deps: RunJobDeps = {
  jobRepo: new DynamoJobRepository(config),
  configStore: new S3ConfigStore(config),
  stateStore: new DynamoStateStore(config),
  dataLakeWriter: new S3DataLakeWriter(config),
  connectorFactory: (type) => createConnector(type, config),
};

let running = true;

// graceful shutdown on SIGTERM / SIGINT
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

async function pollLoop(): Promise<void> {
  console.log("[worker] starting sqs poll loop");

  while (running) {
    const messages = await queue.receiveMessages(10, 20);
    if (messages.length === 0) continue;

    for (const msg of messages) {
      const { job_id } = JSON.parse(msg.body) as { job_id: string };
      try {
        await runJob(job_id, deps);
        await queue.deleteMessage(msg.receiptHandle);
      } catch (err) {
        // don't delete message — sqs will redeliver after visibility timeout
        console.error(`[worker] job ${job_id} failed:`, err);
      }
    }
  }

  console.log("[worker] shutting down");
}

pollLoop().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
