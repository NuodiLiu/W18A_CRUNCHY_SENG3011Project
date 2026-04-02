import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { loadConfig } from "./config/index.js";
import { logger, emitMetric } from "./infra/logger.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { DynamoStateStore } from "./infra/aws/dynamoStateStore.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { S3DataLakeWriter } from "./infra/aws/s3DataLakeWriter.js";
import { PostgresEventRepository } from "./infra/postgres/postgresEventRepository.js";
import { createConnector } from "./infra/connectors/connectorFactory.js";
import { runJob, RunJobDeps, JobMessage } from "./application/worker/runJob.js";

const config = loadConfig();

const deps: RunJobDeps = {
  jobRepo: new DynamoJobRepository(config),
  configStore: new S3ConfigStore(config),
  stateStore: new DynamoStateStore(config),
  dataLakeWriter: new S3DataLakeWriter(config),
  connectorFactory: (type) => createConnector(type, config),
  eventRepository: new PostgresEventRepository(config),
};

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const msg = JSON.parse(record.body) as JobMessage;
      if (!msg.job_id) {
        throw new Error(`missing job_id in message body: ${record.body}`);
      }
      await runJob(msg, deps);
    } catch (err) {
      logger.error({ messageId: record.messageId, err }, "sqs_record_failed");
      emitMetric("SqsRecordFailed", 1, "Count", { service: "datalake-ingest-worker" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
