/**
 * Lambda entry point — wraps the Express app via serverless-express.
 * Triggered by API Gateway HTTP API (payload format v2).
 *
 * Dependencies are initialised outside the handler so they are reused
 * across warm invocations (Lambda execution environment reuse).
 */
import serverlessExpress from "@vendia/serverless-express";
import { loadConfig } from "./config/index.js";
import { createApp } from "./http/app.js";
import { DynamoJobRepository } from "./infra/aws/dynamoJobRepository.js";
import { S3ConfigStore } from "./infra/aws/s3ConfigStore.js";
import { SQSQueueService } from "./infra/aws/sqsQueueService.js";
import { S3PresignService } from "./infra/aws/s3PresignService.js";
import { PostgresEventRepository } from "./infra/postgres/postgresEventRepository.js";

const config = loadConfig();

const app = createApp({
  jobRepo: new DynamoJobRepository(config),
  configStore: new S3ConfigStore(config),
  queue: new SQSQueueService(config),
  fileUploadService: new S3PresignService(config),
  dataLakeReader: new PostgresEventRepository(config),
});

export const handler = serverlessExpress({ app });
