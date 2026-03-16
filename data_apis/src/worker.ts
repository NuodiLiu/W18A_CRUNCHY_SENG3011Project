/* eslint-disable no-console */
import { loadConfig } from "./config/index.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { DynamoStateStore } from "./infra/aws/dynamoStateStore.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { S3DataLakeWriter } from "./infra/aws/s3DataLakeWriter.js";
import { DynamoEventRepository } from "./infra/aws/dynamoEventRepository.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";
import { createConnector } from "./infra/connectors/connectorFactory.js";
import { runJob, RunJobDeps } from "./application/worker/runJob.js";
import { runPreprocessJob, RunPreprocessJobDeps } from "./application/preprocessing/runPreprocessJob.js";

const config = loadConfig();

const queue = new SQSQueueService(config);
const jobRepo = new DynamoJobRepository(config);
const dataLakeWriter = new S3DataLakeWriter(config);
const eventRepository = new DynamoEventRepository(config);

const importDeps: RunJobDeps = {
  jobRepo,
  configStore: new S3ConfigStore(config),
  stateStore: new DynamoStateStore(config),
  dataLakeWriter,
  connectorFactory: (type) => createConnector(type, config),
  eventRepository,
};

const preprocessDeps: RunPreprocessJobDeps = {
  jobRepo,
  dataLakeReader: eventRepository,
  dataLakeWriter,
};

let running = true;

// graceful shutdown on SIGTERM / SIGINT
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

async function pollLoop(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[worker] starting sqs poll loop");

  while (running) {
    const messages = await queue.receiveMessages(10, 20);
    if (messages.length === 0) continue;

    for (const msg of messages) {
      const parsed = JSON.parse(msg.body) as { job_id: string; job_type?: string };
      const { job_id, job_type } = parsed;
      try {
        if (job_type === "preprocess") {
          await runPreprocessJob(job_id, preprocessDeps);
        } else {
          await runJob(job_id, importDeps);
        }
        await queue.deleteMessage(msg.receiptHandle);
      } catch (err) {
        // don't delete message — sqs will redeliver after visibility timeout
<<<<<<< HEAD
        console.error(`[worker] job ${job_id} (${job_type ?? "import"}) failed:`, err);
=======
        // eslint-disable-next-line no-console
        console.error(`[worker] job ${job_id} failed:`, err);
>>>>>>> develop
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log("[worker] shutting down");
}

pollLoop().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal:", err);
  process.exit(1);
});
