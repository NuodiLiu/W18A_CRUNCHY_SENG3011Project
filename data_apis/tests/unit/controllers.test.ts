import request from "supertest";
import { createApp } from "../../src/http/app";
import { JobRecord } from "../../src/domain/models/job";

const fakeJobRecord: JobRecord = {
  job_id: "j-100",
  connection_id: "c-100",
  status: "PENDING",
  config_ref: "s3://config/c-100/j-100.json",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function buildApp(overrides: Record<string, unknown> = {}) {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(fakeJobRecord),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
    },
    configStore: {
      putConfig: jest.fn().mockResolvedValue("s3://config/c-100/j-100.json"),
      getConfig: jest.fn(),
    },
    queue: {
      sendMessage: jest.fn(),
      receiveMessages: jest.fn(),
      deleteMessage: jest.fn(),
    },
    ...overrides,
  };

  const app = createApp(deps as Parameters<typeof createApp>[0]);

  return { app, deps };
}

const validBody = {
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://bucket/file.csv"],
    timezone: "UTC",
  },
  mapping_profile: "esg_v1",
  data_source: "clarity_ai",
  dataset_type: "esg_metrics",
  ingestion_mode: "full_refresh",
};

describe("POST /api/v1/collection/imports", () => {
  it("returns 202 with valid body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    expect(res.body.job_id).toBeDefined();
    expect(res.body.connection_id).toBeDefined();
    expect(res.body.status_url).toMatch(/^\/api\/v1\/collection\/jobs\//);
  });

  it("calls jobRepo.create with PENDING status", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    expect(deps.jobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PENDING" })
    );
  });

  it("calls configStore.putConfig", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    expect(deps.configStore.putConfig).toHaveBeenCalledWith(
      expect.any(String), // connection_id
      expect.any(String), // job_id
      expect.objectContaining({ connector_type: "esg_csv_batch" })
    );
  });

  it("calls queue.sendMessage with job_id", async () => {
    const { app, deps } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send(validBody)
      .expect(202);

    expect(deps.queue.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: res.body.job_id })
    );
  });

  it("returns 400 for invalid body (missing connector_type)", async () => {
    const { app } = buildApp();
    const { connector_type: _connector_type, ...bad } = validBody;
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send(bad)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when source_spec has no s3_uris or s3_prefix", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/imports")
      .send({
        ...validBody,
        source_spec: { timezone: "UTC" },
      })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/collection/jobs/:jobId", () => {
  it("returns 200 with job details when job exists", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/collection/jobs/j-100")
      .expect(200);

    expect(res.body.job_id).toBe("j-100");
    expect(res.body.status).toBe("PENDING");
    expect(res.body.connection_id).toBe("c-100");
  });

  it("returns 404 when job does not exist", async () => {
    const { app } = buildApp({
      jobRepo: {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue(undefined),
        claimJob: jest.fn(),
        updateStatus: jest.fn(),
      },
    });

    const res = await request(app)
      .get("/api/v1/collection/jobs/nonexistent")
      .expect(404);

    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("calls jobRepo.findById with the path parameter", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/collection/jobs/j-100").expect(200);
    expect(deps.jobRepo.findById).toHaveBeenCalledWith("j-100");
  });
});
