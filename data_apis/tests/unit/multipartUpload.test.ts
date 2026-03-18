import request from "supertest";
import { createApp } from "../../src/http/app";
import { JobRecord } from "../../src/domain/models/job";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const fakeJobRecord: JobRecord = {
  job_id: "j-1",
  connection_id: "c-1",
  status: "PENDING",
  config_ref: "s3://bucket/config.json",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const fakeInitResult = {
  upload_id: "mpu-abc123",
  s3_uri: "s3://bucket/raw-uploads/uuid/large.csv",
  parts: [
    { part_number: 1, upload_url: "https://s3.example.com/part1?sig=x", byte_range: "0-52428799" },
    { part_number: 2, upload_url: "https://s3.example.com/part2?sig=y", byte_range: "52428800-104857599" },
  ],
  expires_in: 3600,
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
      putConfig: jest.fn().mockResolvedValue("s3://config/c-1/j-1.json"),
      getConfig: jest.fn(),
    },
    queue: {
      sendMessage: jest.fn(),
      receiveMessages: jest.fn(),
      deleteMessage: jest.fn(),
    },
    fileUploadService: {
      presignPut: jest.fn(),
      initMultipart: jest.fn().mockResolvedValue(fakeInitResult),
      completeMultipart: jest.fn().mockResolvedValue("s3://bucket/raw-uploads/uuid/large.csv"),
    },
    dataLakeReader: {
      queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
      findEventById: jest.fn().mockResolvedValue(undefined),
      getDistinctEventTypes: jest.fn().mockResolvedValue([]),
      getGroupProjection: jest.fn().mockResolvedValue([]),
      readDataset: jest.fn(),
    },
    ...overrides,
  };

  const app = createApp(deps as Parameters<typeof createApp>[0]);
  return { app, deps };
}

describe("POST /api/v1/collection/uploads/multipart/init", () => {
  const validBody = {
    filename: "large.csv",
    content_type: "text/csv",
    file_size: 104_857_600,
  };

  it("returns 200 with upload_id, s3_uri, parts, expires_in", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    expect(res.body.upload_id).toBe(fakeInitResult.upload_id);
    expect(res.body.s3_uri).toMatch(/^s3:\/\//);
    expect(res.body.parts).toHaveLength(2);
    expect(res.body.expires_in).toBe(3600);
  });

  it("each part has part_number, upload_url, byte_range", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    for (const part of res.body.parts) {
      expect(part.part_number).toBeDefined();
      expect(part.upload_url).toMatch(/^https/);
      expect(part.byte_range).toMatch(/^\d+-\d+$/);
    }
  });

  it("delegates filename, content_type, file_size to fileUploadService", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    expect(deps.fileUploadService.initMultipart).toHaveBeenCalledWith(
      "large.csv",
      "text/csv",
      104_857_600
    );
  });

  it("calls initMultipart exactly once", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(200);

    expect(deps.fileUploadService.initMultipart).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when filename does not end in .csv", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({ ...validBody, filename: "large.zip" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for unsupported content_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({ ...validBody, content_type: "application/json" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when file_size is missing", async () => {
    const { app } = buildApp();
    const { file_size: _fs, ...bad } = validBody;
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(bad)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when file_size is zero or negative", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({ ...validBody, file_size: 0 })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 when fileUploadService throws", async () => {
    const { app } = buildApp({
      fileUploadService: {
        presignPut: jest.fn(),
        initMultipart: jest.fn().mockRejectedValue(new Error("S3 error")),
        completeMultipart: jest.fn(),
      },
    });
    await request(app)
      .post("/api/v1/collection/uploads/multipart/init")
      .send(validBody)
      .expect(500);
  });
});

describe("POST /api/v1/collection/uploads/multipart/complete", () => {
  const validBody = {
    s3_uri: "s3://bucket/raw-uploads/uuid/large.csv",
    upload_id: "mpu-abc123",
    parts: [
      { part_number: 1, etag: "etag-1" },
      { part_number: 2, etag: "etag-2" },
    ],
  };

  it("returns 200 with s3_uri", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(validBody)
      .expect(200);

    expect(res.body.s3_uri).toBe("s3://bucket/raw-uploads/uuid/large.csv");
  });

  it("delegates s3_uri, upload_id, parts to fileUploadService", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(validBody)
      .expect(200);

    expect(deps.fileUploadService.completeMultipart).toHaveBeenCalledWith(
      validBody.s3_uri,
      validBody.upload_id,
      validBody.parts
    );
  });

  it("calls completeMultipart exactly once", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(validBody)
      .expect(200);

    expect(deps.fileUploadService.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when s3_uri does not start with s3://", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({ ...validBody, s3_uri: "https://bucket/file.csv" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when upload_id is missing", async () => {
    const { app } = buildApp();
    const { upload_id: _uid, ...bad } = validBody;
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(bad)
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when parts array is empty", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({ ...validBody, parts: [] })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 when fileUploadService throws", async () => {
    const { app } = buildApp({
      fileUploadService: {
        presignPut: jest.fn(),
        initMultipart: jest.fn(),
        completeMultipart: jest.fn().mockRejectedValue(new Error("S3 error")),
      },
    });
    await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(validBody)
      .expect(500);
  });

  it("returned s3_uri is accepted as source_spec.s3_uris in /imports", async () => {
    const { app, deps } = buildApp();
    const completeRes = await request(app)
      .post("/api/v1/collection/uploads/multipart/complete")
      .send(validBody)
      .expect(200);

    // confirm the s3_uri from complete can be passed to imports
    deps.jobRepo.create = jest.fn();
    const importRes = await request(app)
      .post("/api/v1/collection/imports")
      .send({
        connector_type: "esg_csv_batch",
        source_spec: {
          s3_uris: [completeRes.body.s3_uri],
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
});
