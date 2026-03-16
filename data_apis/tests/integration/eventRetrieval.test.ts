import request from "supertest";
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { loadConfig } from "../../src/config/index";
import { createApp } from "../../src/http/app";
import { DynamoJobRepository } from "../../src/infra/aws/dynamoJobRepository";
import { S3ConfigStore } from "../../src/infra/aws/s3ConfigStore";
import { SQSQueueService } from "../../src/infra/aws/sqsQueueService";
import { S3PresignService } from "../../src/infra/aws/s3PresignService";
import { S3DataLakeReader } from "../../src/infra/aws/s3DataLakeReader";

// --- setup ---

const config = loadConfig();
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);
// useS3Select: false → uses GetObject + in-memory filter (LocalStack community doesn't support S3 Select)
const dataLakeReader = new S3DataLakeReader(config, { useS3Select: false });

const app = createApp({ jobRepo, configStore, queue, fileUploadService, dataLakeReader });

const s3 = new S3Client({
  region: config.region,
  endpoint: config.s3Endpoint,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// ── Seed data ─────────────────────────────────────────────────

const DATASET_PREFIX = "datasets/esg_test";

const sampleEvents = [
  {
    event_id: "evt-001",
    event_type: "esg_metric",
    time_object: { timestamp: "2024-01-15T00:00:00Z", timezone: "UTC" },
    attribute: {
      company_name: "TestCorp",
      permid: "P12345",
      metric_name: "carbon_emissions",
      pillar: "Environmental",
      metric_year: 2023,
      industry: "Technology",
      value: 42.5,
    },
  },
  {
    event_id: "evt-002",
    event_type: "esg_metric",
    time_object: { timestamp: "2024-01-16T00:00:00Z", timezone: "UTC" },
    attribute: {
      company_name: "TestCorp",
      permid: "P12345",
      metric_name: "water_usage",
      pillar: "Environmental",
      metric_year: 2024,
      industry: "Technology",
      value: 18.0,
    },
  },
  {
    event_id: "evt-003",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-02-01T00:00:00Z", timezone: "AEST" },
    attribute: {
      suburb: "Kensington",
      postcode: "2033",
      zoning: "residential",
      contract_year: 2024,
      price: 1500000,
    },
  },
];

const manifest = {
  dataset_id: "esg_test",
  data_source: "test",
  dataset_type: "esg_metrics",
  time_object: { timestamp: new Date().toISOString(), timezone: "UTC" },
  total_events: sampleEvents.length,
  segments: [`s3://${config.s3DatalakeBucket}/${DATASET_PREFIX}/segment-0.jsonl`],
  created_at: new Date().toISOString(),
};

const segmentBody = sampleEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";

// ── Helpers ──────────────────────────────────────────────────

async function ensureBucket() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3DatalakeBucket }));
  } catch {
    // bucket already exists
  }
}

async function seedData() {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3DatalakeBucket,
      Key: `${DATASET_PREFIX}/manifest.json`,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
    })
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3DatalakeBucket,
      Key: `${DATASET_PREFIX}/segment-0.jsonl`,
      Body: segmentBody,
      ContentType: "application/x-ndjson",
    })
  );
}

async function cleanupData() {
  try {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: config.s3DatalakeBucket, Prefix: DATASET_PREFIX })
    );
    for (const obj of list.Contents ?? []) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: config.s3DatalakeBucket, Key: obj.Key! })
      );
    }
  } catch {
    // ignore
  }
}

// ── Lifecycle ────────────────────────────────────────────────

beforeAll(async () => {
  await ensureBucket();
  await seedData();
});

afterAll(async () => {
  await cleanupData();
});

// ── Tests ────────────────────────────────────────────────────

describe("GET /api/v1/events/:eventId — integration", () => {
  it("returns a single event by ID", async () => {
    const res = await request(app)
      .get("/api/v1/events/evt-001")
      .expect(200);

    expect(res.body.event_id).toBe("evt-001");
    expect(res.body.event_type).toBe("esg_metric");
    expect(res.body.attribute.company_name).toBe("TestCorp");
  });

  it("returns 404 for non-existent event ID", async () => {
    await request(app)
      .get("/api/v1/events/evt-nonexistent")
      .expect(404);
  });
});

describe("GET /api/v1/events/types — integration", () => {
  it("returns distinct event types", async () => {
    const res = await request(app)
      .get("/api/v1/events/types")
      .expect(200);

    expect(res.body.event_types).toBeDefined();
    expect(res.body.event_types).toContain("esg_metric");
    expect(res.body.event_types).toContain("housing_sale");
  });
});

describe("GET /api/v1/events — integration", () => {
  it("returns all events with total", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.total).toBe(sampleEvents.length);
    expect(res.body.events).toHaveLength(sampleEvents.length);
  });

  it("returns correct event structure", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    const evt = res.body.events.find((e: { event_id: string }) => e.event_id === "evt-001");
    expect(evt).toBeDefined();
    expect(evt.event_type).toBe("esg_metric");
    expect(evt.time_object.timestamp).toBe("2024-01-15T00:00:00Z");
    expect(evt.time_object.timezone).toBe("UTC");
  });

  it("respects limit param", async () => {
    const res = await request(app)
      .get("/api/v1/events?limit=1")
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.total).toBe(sampleEvents.length);
  });

  it("respects offset param", async () => {
    const resAll = await request(app).get("/api/v1/events").expect(200);
    const resOffset = await request(app).get("/api/v1/events?offset=1").expect(200);

    expect(resOffset.body.events).toHaveLength(sampleEvents.length - 1);
    expect(resOffset.body.events[0].event_id).not.toBe(resAll.body.events[0].event_id);
  });
});

describe("GET /api/v1/events/stats — integration", () => {
  it("returns stats with total_events", async () => {
    const res = await request(app)
      .get("/api/v1/events/stats")
      .expect(200);

    expect(res.body.total_events).toBe(3);
    expect(res.body.groups).toBeDefined();
  });

  it("groups by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/events/stats?group_by=pillar")
      .expect(200);

    expect(res.body.total_events).toBe(3);
    const envGroup = res.body.groups.find(
      (g: Record<string, unknown>) => g.key === "Environmental"
    );
    expect(envGroup).toBeDefined();
    expect(envGroup.count).toBe(2);
  });
});
