import request from "supertest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  SQSClient,
  ReceiveMessageCommand,
  PurgeQueueCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
import { loadConfig } from "../../src/config/index";
import { createApp } from "../../src/http/app";
import { DynamoJobRepository } from "../../src/infra/aws/dynamoJobRepository";
import { S3ConfigStore } from "../../src/infra/aws/s3ConfigStore";
import { SQSQueueService } from "../../src/infra/aws/sqsQueueService";

// --- setup ---

const config = loadConfig();
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const app = createApp({ jobRepo, configStore, queue });

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: config.region,
    endpoint: config.dynamoEndpoint,
  }),
);
const s3 = new S3Client({
  region: config.region,
  endpoint: config.s3Endpoint,
  forcePathStyle: true,
});
const sqs = new SQSClient({
  region: config.region,
  endpoint: config.sqsEndpoint,
});

const validBody = {
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://test-bucket/esg-data.csv"],
    timezone: "UTC",
  },
  mapping_profile: "esg_v1",
  data_source: "clarity_ai",
  dataset_type: "esg_metrics",
  ingestion_mode: "full_refresh",
};

// purge SQS before each test to avoid leftover messages
beforeEach(async () => {
  try {
    const urlRes = await sqs.send(
      new GetQueueUrlCommand({ QueueName: config.sqsQueueName }),
    );
    await sqs.send(
      new PurgeQueueCommand({ QueueUrl: urlRes.QueueUrl! }),
    );
    // purge is async, wait briefly
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // queue may not exist yet, that's fine
  }
});

// --- tests ---

describe("POST /collection/imports — integration", () => {
  it("returns 202 with job_id, connection_id, status_url", async () => {
    const res = await request(app)
      .post("/collection/imports")
      .send(validBody)
      .expect(202);

    expect(res.body.job_id).toBeDefined();
    expect(res.body.connection_id).toBeDefined();
    expect(res.body.status_url).toMatch(/^\/collection\/jobs\//);
  });

  it("creates a PENDING job record in DynamoDB", async () => {
    const res = await request(app)
      .post("/collection/imports")
      .send(validBody)
      .expect(202);

    const item = await ddb.send(
      new GetCommand({
        TableName: config.ddbJobsTable,
        Key: { job_id: res.body.job_id },
      }),
    );

    expect(item.Item).toBeDefined();
    expect(item.Item!.status).toBe("PENDING");
    expect(item.Item!.connection_id).toBe(res.body.connection_id);
  });

  it("persists job config to S3", async () => {
    const res = await request(app)
      .post("/collection/imports")
      .send(validBody)
      .expect(202);

    const configKey = `configs/${res.body.connection_id}/${res.body.job_id}.json`;
    const s3Obj = await s3.send(
      new GetObjectCommand({
        Bucket: config.s3ConfigBucket,
        Key: configKey,
      }),
    );
    const body = await s3Obj.Body!.transformToString();
    const parsed = JSON.parse(body);

    expect(parsed.connector_type).toBe("esg_csv_batch");
    expect(parsed.source_spec.s3_uris).toEqual(["s3://test-bucket/esg-data.csv"]);
  });

  it("sends a message to SQS with job_id", async () => {
    const res = await request(app)
      .post("/collection/imports")
      .send(validBody)
      .expect(202);

    const urlRes = await sqs.send(
      new GetQueueUrlCommand({ QueueName: config.sqsQueueName }),
    );
    const msgs = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: urlRes.QueueUrl!,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
      }),
    );

    expect(msgs.Messages).toBeDefined();
    const bodies = msgs.Messages!.map((m) => JSON.parse(m.Body!));
    const match = bodies.find((b) => b.job_id === res.body.job_id);
    expect(match).toBeDefined();
  });

  it("returns 400 for missing connector_type", async () => {
    const { connector_type: _ct, ...badBody } = validBody;
    const res = await request(app)
      .post("/collection/imports")
      .send(badBody)
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty source_spec (no s3_uris or s3_prefix)", async () => {
    const badBody = {
      ...validBody,
      source_spec: { timezone: "UTC" },
    };
    const res = await request(app)
      .post("/collection/imports")
      .send(badBody)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /collection/jobs/:jobId — integration", () => {
  it("returns the job after creation", async () => {
    const createRes = await request(app)
      .post("/collection/imports")
      .send(validBody)
      .expect(202);

    const jobRes = await request(app)
      .get(`/collection/jobs/${createRes.body.job_id}`)
      .expect(200);

    expect(jobRes.body.job_id).toBe(createRes.body.job_id);
    expect(jobRes.body.status).toBe("PENDING");
  });

  it("returns 404 for non-existent job", async () => {
    await request(app)
      .get("/collection/jobs/non-existent-id")
      .expect(404);
  });
});
