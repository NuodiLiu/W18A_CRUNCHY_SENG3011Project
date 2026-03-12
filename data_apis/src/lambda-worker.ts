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
import { createConnector } from "./infra/connectors/connectorFactory.js";
import { runJob, RunJobDeps } from "./application/worker/runJob.js";

const config = loadConfig();

const deps: RunJobDeps = {
  jobRepo: new DynamoJobRepository(config),
  configStore: new S3ConfigStore(config),
  stateStore: new DynamoStateStore(config),
  dataLakeWriter: new S3DataLakeWriter(config),
  connectorFactory: (type) => createConnector(type, config),
};

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    const { job_id } = JSON.parse(record.body) as { job_id: string };
    try {
      await runJob(job_id, deps);
    } catch (err) {
      console.error(`[lambda-worker] job ${job_id} failed:`, err);
      // Return the messageId so Lambda/SQS retries only this record.
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
