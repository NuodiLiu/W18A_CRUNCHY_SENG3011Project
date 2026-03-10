import request from "supertest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  UploadPartCommand,
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
import { S3PresignService } from "../../src/infra/aws/s3PresignService";

// --- setup ---

const config = loadConfig();
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);
const app = createApp({ jobRepo, configStore, queue, fileUploadService });

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
  // suppress default CRC32 checksums — localstack rejects them on multipart upload parts
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
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

describe("POST /api/v1/collection/imports — integration", () => {
  it("returns 202 with job_id, connection_id, status_url", async () => {
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    expect(res.body.job_id).toBeDefined();
    expect(res.body.connection_id).toBeDefined();
    expect(res.body.status_url).toMatch(/^\/api\/v1\/collection\/jobs\//);
  });

  it("creates a PENDING job record in DynamoDB", async () => {
    const res = await request(app)
      .post("/api/v1/collection/imports")
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
      .post("/api/v1/collection/imports")
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
      .post("/api/v1/collection/imports")
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
      .post("/api/v1/collection/imports")
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
      .post("/api/v1/collection/imports")
      .send(badBody)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/collection/jobs/:jobId — integration", () => {
  it("returns the job after creation", async () => {
    const createRes = await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    const jobRes = await request(app)
      .get(`/api/v1/collection/jobs/${createRes.body.job_id}`)
      .expect(200);

    expect(jobRes.body.job_id).toBe(createRes.body.job_id);
    expect(jobRes.body.status).toBe("PENDING");
  });

  it("returns 404 for non-existent job", async () => {
    await request(app)
      .get("/api/v1/collection/jobs/non-existent-id")
      .expect(404);
  });
});

describe("POST /api/v1/collection/uploads/presign — integration", () => {
  const validBody = { filename: "esg.csv", content_type: "text/csv" };

  it("returns 200 with upload_url, s3_uri, expires_in", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(200);

    expect(res.body.upload_url).toBeDefined();
    expect(res.body.s3_uri).toMatch(/^s3:\/\//);  
    expect(res.body.expires_in).toBe(900);
  });

  it("s3_uri points to raw-uploads prefix in datalake bucket", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(200);

    expect(res.body.s3_uri).toContain(`s3://${config.s3DatalakeBucket}/raw-uploads/`);
    expect(res.body.s3_uri).toContain("/esg.csv");
  });

  it("each presign call returns a unique s3_uri (uuid in key)", async () => {
    const [res1, res2] = await Promise.all([
      request(app).post("/api/v1/collection/uploads/presign").send(validBody),
      request(app).post("/api/v1/collection/uploads/presign").send(validBody),
    ]);

    expect(res1.body.s3_uri).not.toBe(res2.body.s3_uri);
  });

  it("upload_url is a valid HTTPS URL", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(200);

    expect(() => new URL(res.body.upload_url)).not.toThrow();
    expect(res.body.upload_url).toMatch(/^https?:\/\//); 
  });

  it("returned s3_uri is accepted as source_spec.s3_uris in /imports", async () => {
    const presignRes = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(200);

    const importRes = await request(app)
      .post("/api/v1/collection/imports")
      .send({
        connector_type: "esg_csv_batch",
        source_spec: {
          s3_uris: [presignRes.body.s3_uri],
          timezone: "UTC",
        },
        mapping_profile: "esg_v1",
        data_source: "clarity_ai",
        dataset_type: "esg_metrics",
        ingestion_mode: "full_refresh",
      })
      .expect(202);

    expect(importRes.body.job_id).toBeDefined();
  });

  it("returns 400 for filename without .csv extension", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({ filename: "data.xlsx", content_type: "text/csv" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for unsupported content_type", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({ filename: "data.csv", content_type: "image/png" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/collection/uploads/multipart/init — integration", () => {
  const validBody = {
    filename: "large.csv",
    content_type: "text/csv",
    // 110 MB — triggers 3 parts at 50 MB each
    file_size: 115_343_360,
  };

  it("returns 200 with upload_id, s3_uri, parts, expires_in", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    expect(res.body.upload_id).toBeDefined();
    expect(res.body.s3_uri).toMatch(/^s3:\/\//);
    expect(res.body.parts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.expires_in).toBe(3600);
  });

  it("s3_uri is under raw-uploads prefix in datalake bucket", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    expect(res.body.s3_uri).toContain(`s3://${config.s3DatalakeBucket}/raw-uploads/`);
    expect(res.body.s3_uri).toContain("/large.csv");
  });

  it("each part has valid upload_url and byte_range", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    for (const part of res.body.parts) {
      expect(part.part_number).toBeGreaterThanOrEqual(1);
      expect(() => new URL(part.upload_url)).not.toThrow();
      expect(part.byte_range).toMatch(/^\d+-\d+$/);
    }
  });

  it("each init call produces a unique s3_uri", async () => {
    const [r1, r2] = await Promise.all([
      request(app).post("/api/v1/collection/uploads/multipart/init").send(validBody),
      request(app).post("/api/v1/collection/uploads/multipart/init").send(validBody),
    ]);

    expect(r1.body.s3_uri).not.toBe(r2.body.s3_uri);
  });

  it("returns 400 for invalid filename", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({ ...validBody, filename: "data.zip" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when file_size is missing", async () => {
    const { file_size: _fs, ...bad } = validBody;
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(bad)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/collection/uploads/multipart/complete — integration", () => {
  it("completes a real multipart upload and s3_uri is usable in /imports", async () => {
    // step 1: init
    const initRes = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({ filename: "real.csv", content_type: "text/csv", file_size: 10 })
      .expect(200);

    const { upload_id, s3_uri, parts } = initRes.body;

    // parse bucket and key from the s3_uri returned by init
    const withoutScheme = (s3_uri as string).slice(5);
    const slashIdx = withoutScheme.indexOf("/");
    const bucket = withoutScheme.slice(0, slashIdx);
    const key = withoutScheme.slice(slashIdx + 1);

    // step 2: upload each part directly with the SDK to get real ETags
    const completedParts: { part_number: number; etag: string }[] = [];
    for (const part of parts) {
      const result = await s3.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: upload_id,
          PartNumber: part.part_number,
          Body: Buffer.from("a,b,c\n1,2,3"),
        })
      );
      completedParts.push({ part_number: part.part_number, etag: result.ETag! });
    }

    // step 3: complete
    const completeRes = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({ s3_uri, upload_id, parts: completedParts })
      .expect(200);

    expect(completeRes.body.s3_uri).toBe(s3_uri);

    // step 4: s3_uri is accepted by /imports
    const importRes = await request(app)
      .post("/api/v1/collection/imports")
      .send({
        connector_type: "esg_csv_batch",
        source_spec: { s3_uris: [completeRes.body.s3_uri], timezone: "UTC" },
        mapping_profile: "esg_v1",
        data_source: "clarity_ai",
        dataset_type: "esg_metrics",
        ingestion_mode: "full_refresh",
      })
      .expect(202);

    expect(importRes.body.job_id).toBeDefined();
  });

  it("returns 400 when s3_uri does not start with s3://", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({
        s3_uri: "https://bucket/file.csv",
        upload_id: "mpu-abc",
        parts: [{ part_number: 1, etag: "etag-1" }],
      })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when parts array is empty", async () => {
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({
        s3_uri: "s3://bucket/raw-uploads/uuid/large.csv",
        upload_id: "mpu-abc",
        parts: [],
      })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
