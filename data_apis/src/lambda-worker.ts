/**
 * Lambda entry point — SQS-triggered worker.
 *
 * Replaces the long-running poll loop in worker.ts.
 * Lambda receives batches from the SQS Event Source Mapping and returns
 * batchItemFailures so that only failed messages are retried (partial
 * batch failure reporting must be enabled on the event source mapping).
 *
 * Dependencies are initialised outside the handler for warm-invocation reuse.
 */
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { loadConfig } from "./config/index.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { DynamoStateStore } from "./infra/aws/dynamoStateStore.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { S3DataLakeWriter } from "./infra/aws/s3DataLakeWriter.js";
import { DynamoEventRepository } from "./infra/aws/dynamoEventRepository.js";
import { createConnector } from "./infra/connectors/connectorFactory.js";
import { runJob, RunJobDeps } from "./application/worker/runJob.js";

const config = loadConfig();

const deps: RunJobDeps = {
  jobRepo: new DynamoJobRepository(config),
  configStore: new S3ConfigStore(config),
  stateStore: new DynamoStateStore(config),
  dataLakeWriter: new S3DataLakeWriter(config),
  connectorFactory: (type) => createConnector(type, config),
  eventRepository: new DynamoEventRepository(config),
};

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body) as { job_id?: string };
      if (!parsed.job_id) {
        throw new Error(`Missing job_id in message body: ${record.body}`);
      }
      await runJob(parsed.job_id, deps);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[lambda-worker] record ${record.messageId} failed:`, err);
      // Return the messageId so Lambda/SQS retries only this record.
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
