import request from "supertest";
import { createApp } from "../../src/http/app";
import { JobRecord } from "../../src/domain/models/job";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const fakeJobRecord: JobRecord = {
  job_id: "j-100",
  connection_id: "c-100",
  status: "PENDING",
  config_ref: "s3://config/c-100/j-100.json",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const fakePresignResult = {
  upload_url: "https://s3.example.com/bucket/raw-uploads/uuid/file.csv?sig=abc",
  s3_uri: "s3://bucket/raw-uploads/uuid/file.csv",
  expires_in: 900,
};

const fakeHousingEvents = [
  {
    event_id: "h-1",
    time_object: {
      timestamp: "2024-04-10T00:00:00Z",
      timezone: "UTC",
    },
    event_type: "housing_sale",
    attribute: {
      property_id: "P001",
      dealing_number: 1001,
      unit_number: "2",
      street_number: "10",
      street_name: "George St",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1500000,
      legal_description: "Lot 1 DP123456",
      area: 120,
      area_type: "sqm",
      contract_date: "2024-04-10",
      settlement_date: "2024-05-01",
      district_code: 7,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
    },
  },
  {
    event_id: "h-2",
    time_object: {
      timestamp: "2024-04-15T00:00:00Z",
      timezone: "UTC",
    },
    event_type: "housing_sale",
    attribute: {
      property_id: "P002",
      dealing_number: 1002,
      unit_number: "",
      street_number: "20",
      street_name: "King St",
      suburb: "Parramatta",
      postcode: 2150,
      purchase_price: 980000,
      legal_description: "Lot 2 DP654321",
      area: 95,
      area_type: "sqm",
      contract_date: "2024-04-15",
      settlement_date: "2024-05-10",
      district_code: 9,
      zoning: "R2",
      nature_of_property: "Residential",
      primary_purpose: "Investment",
    },
  },
];

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
    fileUploadService: {
      presignPut: jest.fn().mockResolvedValue(fakePresignResult),
      initMultipart: jest.fn(),
      completeMultipart: jest.fn(),
    },
    dataLakeReader: {
      queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: fakeHousingEvents.length }),
      findEventById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(fakeHousingEvents.find((e: { event_id: string }) => e.event_id === id))
      ),
      getDistinctEventTypes: jest.fn().mockResolvedValue([...new Set(fakeHousingEvents.map((e: { event_type: string }) => e.event_type))]),
      getGroupProjection: jest.fn().mockResolvedValue(
        fakeHousingEvents.map((e) => ({ event_type: e.event_type, attribute: e.attribute }))
      ),
      readDataset: jest.fn(),
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

describe("POST /api/v1/collection/uploads/presign", () => {
  const validBody = { filename: "data.csv", content_type: "text/csv" };

  it("returns 200 with upload_url, s3_uri, expires_in", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(200);

    expect(res.body.upload_url).toBe(fakePresignResult.upload_url);
    expect(res.body.s3_uri).toBe(fakePresignResult.s3_uri);
    expect(res.body.expires_in).toBe(900);
  });

  it("delegates filename and content_type to fileUploadService", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({ filename: "report.csv", content_type: "application/octet-stream" })
      .expect(200);

    expect(deps.fileUploadService.presignPut).toHaveBeenCalledWith(
      "report.csv",
      "application/octet-stream"
    );
  });

  it("returns 400 when filename does not end in .csv", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({ filename: "data.xlsx", content_type: "text/csv" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for unsupported content_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({ filename: "data.csv", content_type: "application/json" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 when fileUploadService throws", async () => {
    const { app } = buildApp({
      fileUploadService: {
        presignPut: jest.fn().mockRejectedValue(new Error("S3 error")),
        initMultipart: jest.fn(),
        completeMultipart: jest.fn(),
      },
    });
    await request(app)
      .post("/api/v1/collection/uploads/presign")
      .send(validBody)
      .expect(500);
  });
});

describe("GET /api/v1/events/:eventId", () => {
  it("returns 200 with housing event if it exists", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/h-1")
      .expect(200);

    expect(res.body.event_id).toBe("h-1");
    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.attribute.property_id).toBe("P001");
    expect(res.body.attribute.suburb).toBe("Sydney");
  });

  it("returns 404 if housing event does not exist", async () => {
    const { app } = buildApp();

    await request(app)
      .get("/api/v1/events/missing-id")
      .expect(404);
  });
});

describe("GET /api/v1/events/stats", () => {
  it("returns total_events and groups", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/stats")
      .expect(200);

    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "housing_sale", count: 2 }),
      ])
    );
  });

  it("group by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/stats?group_by=suburb")
      .expect(200);

    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Sydney", count: 1 }),
        expect.objectContaining({ key: "Parramatta", count: 1 }),
      ])
    );
  });

  it("group by postcode", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/stats?group_by=postcode")
      .expect(200);

    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "2000", count: 1 }),
        expect.objectContaining({ key: "2150", count: 1 }),
      ])
    );
  });

  it("group by zoning", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/stats?group_by=zoning")
      .expect(200);

    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "R1", count: 1 }),
        expect.objectContaining({ key: "R2", count: 1 }),
      ])
    );
  });

  it("group by contract year", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events/stats?group_by=contract_year")
      .expect(200);

    expect(res.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "2024", count: 2 }),
      ])
    );
  });

  it("returns empty groups for empty dataset", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });
  
    const res = await request(app)
      .get("/api/v1/events/stats")
      .expect(200);
  
    expect(res.body.total_events).toBe(0);
    expect(res.body.groups).toEqual([]);
  });
});