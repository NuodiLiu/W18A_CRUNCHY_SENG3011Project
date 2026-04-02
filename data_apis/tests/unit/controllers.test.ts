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
      deleteEvent: jest.fn().mockResolvedValue(true),
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

describe("GET /api/v1/events/types", () => {
  it("returns 200 with event_types array", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/events/types")
      .expect(200);

    expect(Array.isArray(res.body.event_types)).toBe(true);
    expect(res.body.event_types).toContain("housing_sale");
  });

  it("calls dataLakeReader.getDistinctEventTypes", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/events/types").expect(200);
    expect(deps.dataLakeReader.getDistinctEventTypes).toHaveBeenCalled();
  });

  it("returns empty array when data lake is empty", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
        readDataset: jest.fn(),
      },
    });
    const res = await request(app).get("/api/v1/events/types").expect(200);
    expect(res.body.event_types).toEqual([]);
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

  it("calls dataLakeReader.findEventById with the path parameter", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/events/h-1").expect(200);
    expect(deps.dataLakeReader.findEventById).toHaveBeenCalledWith("h-1");
  });

  it("response contains correct time_object", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/events/h-1").expect(200);
    expect(res.body.time_object.timestamp).toBe("2024-04-10T00:00:00Z");
    expect(res.body.time_object.timezone).toBe("UTC");
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
        readDataset: jest.fn(),
      },
    });
  
    const res = await request(app)
      .get("/api/v1/events/stats")
      .expect(200);
  
    expect(res.body.total_events).toBe(0);
    expect(res.body.groups).toEqual([]);
  });
});

describe("GET /api/v1/events", () => {
  it("returns 200 with events array and total", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.total).toBe(fakeHousingEvents.length);
  });

  it("returns mapped event records", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    expect(res.body.events[0].event_id).toBe("h-1");
    expect(res.body.events[0].event_type).toBe("housing_sale");
    expect(res.body.events[0].attribute.suburb).toBe("Sydney");
  });

  it("passes ESG query filters to dataLakeReader.queryEvents", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", company_name: "Acme", pillar: "Environmental", limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        company_name: "Acme",
        pillar: "Environmental",
        limit: 10,
        offset: 0,
      })
    );
  });

  it("passes housing query filters to dataLakeReader.queryEvents", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "housing", suburb: "Sydney", postcode: 2000, limit: 20, offset: 5 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "housing",
        suburb: "Sydney",
        postcode: 2000,
        limit: 20,
        offset: 5,
      })
    );
  });

  it("passes mixed filters without dataset_type to dataLakeReader.queryEvents", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ company_name: "Acme", suburb: "Sydney", limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        company_name: "Acme",
        suburb: "Sydney",
        limit: 10,
        offset: 0,
      })
    );
  });

  it("returns mapped event records with correct shape", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    const event = res.body.events[0];
    expect(event.event_id).toBe("h-1");
    expect(event.event_type).toBe("housing_sale");
    expect(event.time_object).toBeDefined();
    expect(event.attribute).toBeDefined();
    expect(event.attribute.suburb).toBe("Sydney");
  });

  it("passes pillar filter to dataLakeReader.queryEvents", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/events?pillar=Environmental").expect(200);
    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ pillar: "Environmental" })
    );
  });

  it("passes metric_name filter to dataLakeReader.queryEvents", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/events?metric_name=carbon_emissions").expect(200);
    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ metric_name: "carbon_emissions" })
    );
  });

  it("uses default limit=50 and offset=0 when not specified", async () => {
    const { app, deps } = buildApp();
    await request(app).get("/api/v1/events").expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 })
    );
  });

  it("returns empty events array when data lake is empty", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
        readDataset: jest.fn(),
      },
    });
    const res = await request(app).get("/api/v1/events").expect(200);

    expect(res.body.events).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("filters results by ESG dataset when dataset_type=esg is specified", async () => {
    const esgEvent = {
      event_id: "esg-1",
      event_type: "esg_metric",
      dataset_type: "esg",
      time_object: { timestamp: "2024-01-01T00:00:00Z", timezone: "UTC" },
      attribute: { company_name: "Acme", metric_name: "CO2 Emissions", pillar: "Environmental" },
    };

    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [esgEvent], total: 1 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg" })
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].event_id).toBe("esg-1");
  });

  it("filters results by housing dataset when dataset_type=housing is specified", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: 2 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "housing" })
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].attribute.suburb).toBe("Sydney");
  });

  it("passes year_from and year_to filters for ESG metrics", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", metric_name: "CO2", year_from: 2020, year_to: 2023, limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        metric_name: "CO2",
        year_from: 2020,
        year_to: 2023,
        limit: 10,
        offset: 0,
      })
    );
  });

  it("passes permid filter for ESG company lookup", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", permid: "4298012345", limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        permid: "4298012345",
        limit: 10,
        offset: 0,
      })
    );
  });

  it("passes postcode filter for housing sales", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "housing", postcode: 2000, limit: 15, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "housing",
        postcode: 2000,
        limit: 15,
        offset: 0,
      })
    );
  });

  it("passes street_name and nature_of_property filters for housing", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "housing", street_name: "King St", nature_of_property: "Residential", limit: 25, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "housing",
        street_name: "King St",
        nature_of_property: "Residential",
        limit: 25,
        offset: 0,
      })
    );
  });

  it("supports pagination with offset and custom limit", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", company_name: "Acme", limit: 100, offset: 50 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        company_name: "Acme",
        limit: 100,
        offset: 50,
      })
    );
  });

  it("combines ESG company and pillar filters", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", company_name: "Tesla", pillar: "Social", limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        company_name: "Tesla",
        pillar: "Social",
        limit: 10,
        offset: 0,
      })
    );
  });

  it("combines housing suburb and postcode filters", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "housing", suburb: "Parramatta", postcode: 2150, limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "housing",
        suburb: "Parramatta",
        postcode: 2150,
        limit: 10,
        offset: 0,
      })
    );
  });

  it("returns correct total count in response", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: 150 }),
        findEventById: jest.fn().mockResolvedValue(undefined),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/events")
      .query({ limit: 10, offset: 0 })
      .expect(200);

    expect(res.body.events).toHaveLength(2);
  });

  it("passes metric_name filter for ESG metrics", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/events")
      .query({ dataset_type: "esg", metric_name: "Carbon Emissions", limit: 10, offset: 0 })
      .expect(200);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_type: "esg",
        metric_name: "Carbon Emissions",
        limit: 10,
        offset: 0,
      })
    );
  });

  it("returns dataset envelope with correct structure", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/events")
      .query({ limit: 10 })
      .expect(200);

    expect(res.body.events).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });
});
