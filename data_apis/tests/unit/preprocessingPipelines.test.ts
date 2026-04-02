import request from "supertest";
import { createApp } from "../../src/http/app";
import { PIPELINE_CATALOGUE } from "../../src/application/preprocessing/getPipelines";
import { runHousingCleanPipeline } from "../../src/application/preprocessing/runHousingCleanPipeline";
import { EventRecord } from "../../src/domain/models/event";
import { JobRecord } from "../../src/domain/models/job";

const fakePreprocessJob: JobRecord = {
  job_id: "pp-1",
  connection_id: "preprocess:ds-1",
  status: "DONE",
  config_ref: "",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  job_type: "preprocess",
  source_dataset_id: "ds-1",
  pipeline: "housing_clean_v1",
  pipeline_params: { price_min: 1 },
  dataset_id: "ds-2",
  quality_report: {
    input_count: 5,
    output_count: 3,
    removed: { zero_price: 1, duplicates: 1, invalid_date: 0 },
    standardized: { suburb_uppercased: 2, area_nullified: 1, area_type_fixed: 0, whitespace_trimmed: 0 },
  },
};

function buildApp(overrides: Record<string, unknown> = {}) {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(fakePreprocessJob),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
      incrementChunksDone: jest.fn().mockResolvedValue(1),
    },
    configStore: { putConfig: jest.fn(), getConfig: jest.fn() },
    queue: {
      sendMessage: jest.fn(),
      receiveMessages: jest.fn(),
      deleteMessage: jest.fn(),
    },
    fileUploadService: {
      presignPut: jest.fn(),
      initMultipart: jest.fn(),
      completeMultipart: jest.fn(),
    },
    dataLakeReader: {
      queryEvents: jest.fn(),
      findEventById: jest.fn(),
      deleteEvent: jest.fn(),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn(),
      readDataset: jest.fn(),
    },
    ...overrides,
  };
  return { app: createApp(deps as Parameters<typeof createApp>[0]), deps };
}

// ── GET /api/v1/preprocessing/pipelines ───────────────────────

describe("GET /api/v1/preprocessing/pipelines", () => {
  it("returns 200", async () => {
    const { app } = buildApp();
    await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
  });

  it("response has a pipelines array", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    expect(Array.isArray(res.body.pipelines)).toBe(true);
    expect(res.body.pipelines.length).toBeGreaterThan(0);
  });

  it("includes housing_clean_v1 pipeline", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    const ids: string[] = res.body.pipelines.map((p: { id: string }) => p.id);
    expect(ids).toContain("housing_clean_v1");
  });

  it("housing_clean_v1 has required fields", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    const housing = res.body.pipelines.find((p: { id: string }) => p.id === "housing_clean_v1");
    expect(housing).toBeDefined();
    expect(housing.name).toBeTruthy();
    expect(housing.description).toBeTruthy();
    expect(housing.category).toBe("housing");
    expect(housing.params_schema).toBeDefined();
  });

  it("housing_clean_v1 params_schema has expected cleaning params", () => {
    const housing = PIPELINE_CATALOGUE.find((p) => p.id === "housing_clean_v1")!;
    const props = (housing.params_schema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("price_min");
    expect(props).toHaveProperty("dedup_by_dealing");
    expect(props).toHaveProperty("normalize_suburb");
    expect(props).toHaveProperty("nullify_zero_area");
    expect(props).toHaveProperty("fix_area_type");
    expect(props).toHaveProperty("trim_whitespace");
  });

  it("pipelines response matches PIPELINE_CATALOGUE exactly", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    expect(res.body.pipelines).toEqual(PIPELINE_CATALOGUE);
  });
});

// ── POST /api/v1/preprocessing/jobs ───────────────────────────

describe("POST /api/v1/preprocessing/jobs", () => {
  it("returns 202 with valid body", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ dataset_id: "ds-1", pipeline: "housing_clean_v1" })
      .expect(202);

    expect(res.body.job_id).toBeDefined();
    expect(res.body.status_url).toMatch(/\/api\/v1\/preprocessing\/jobs\//);
  });

  it("calls jobRepo.create with preprocess job_type", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ dataset_id: "ds-1", pipeline: "housing_clean_v1" })
      .expect(202);

    expect(deps.jobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        job_type: "preprocess",
        source_dataset_id: "ds-1",
        pipeline: "housing_clean_v1",
        status: "PENDING",
      })
    );
  });

  it("enqueues message with job_type preprocess", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ dataset_id: "ds-1", pipeline: "housing_clean_v1" })
      .expect(202);

    expect(deps.queue.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: "preprocess" })
    );
  });

  it("returns 400 for unknown pipeline", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ dataset_id: "ds-1", pipeline: "nonexistent" })
      .expect(400);
  });

  it("returns 400 when dataset_id is missing", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ pipeline: "housing_clean_v1" })
      .expect(400);
  });

  it("passes params to jobRepo.create", async () => {
    const { app, deps } = buildApp();
    const params = { price_min: 500, dedup_by_dealing: false };
    await request(app)
      .post("/api/v1/preprocessing/jobs")
      .send({ dataset_id: "ds-1", pipeline: "housing_clean_v1", params })
      .expect(202);

    expect(deps.jobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline_params: params })
    );
  });
});

// ── GET /api/v1/preprocessing/jobs/:jobId ─────────────────────

describe("GET /api/v1/preprocessing/jobs/:jobId", () => {
  it("returns 200 with job status", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/preprocessing/jobs/pp-1")
      .expect(200);

    expect(res.body.job_id).toBe("pp-1");
    expect(res.body.status).toBe("DONE");
    expect(res.body.pipeline).toBe("housing_clean_v1");
    expect(res.body.source_dataset_id).toBe("ds-1");
    expect(res.body.output_dataset_id).toBe("ds-2");
    expect(res.body.quality_report).toBeDefined();
    expect(res.body.quality_report.input_count).toBe(5);
  });

  it("returns 404 for non-existent job", async () => {
    const { app } = buildApp({
      jobRepo: {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue(undefined),
        claimJob: jest.fn(),
        updateStatus: jest.fn(),
      },
    });
    await request(app)
      .get("/api/v1/preprocessing/jobs/nonexistent")
      .expect(404);
  });

  it("returns 404 for import job (not preprocess)", async () => {
    const importJob: JobRecord = {
      ...fakePreprocessJob,
      job_type: "import",
    };
    const { app } = buildApp({
      jobRepo: {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue(importJob),
        claimJob: jest.fn(),
        updateStatus: jest.fn(),
      },
    });
    await request(app)
      .get("/api/v1/preprocessing/jobs/pp-1")
      .expect(404);
  });

  it.each(["PENDING", "RUNNING", "FAILED"] as const)(
    "returns null output_dataset_id and quality_report when status is %s",
    async (status) => {
      const pendingJob: JobRecord = {
        ...fakePreprocessJob,
        status,
        dataset_id: undefined,
        quality_report: undefined,
      };
      const { app } = buildApp({
        jobRepo: {
          create: jest.fn(),
          findById: jest.fn().mockResolvedValue(pendingJob),
          claimJob: jest.fn(),
          updateStatus: jest.fn(),
        },
      });
      const res = await request(app)
        .get("/api/v1/preprocessing/jobs/pp-1")
        .expect(200);

      expect(res.body.status).toBe(status);
      expect(res.body.output_dataset_id).toBeNull();
      expect(res.body.quality_report).toBeNull();
    }
  );
});

// ── Pipeline pure function unit tests ─────────────────────────

describe("runHousingCleanPipeline", () => {
  const makeEvent = (overrides: Record<string, unknown> = {}): EventRecord => ({
    event_id: "e1",
    time_object: { timestamp: "2024-01-01T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P1",
      dealing_number: 1001,
      unit_number: "",
      street_number: "10",
      street_name: "King St",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 500000,
      legal_description: "Lot 1",
      area: 100,
      area_type: "M",
      contract_date: "2024-01-01",
      settlement_date: "2024-02-01",
      district_code: 7,
      zoning: "R1",
      nature_of_property: "R",
      primary_purpose: "",
      ...overrides,
    },
  });

  it("removes zero-price records", () => {
    const events = [
      makeEvent({ purchase_price: 0 }),
      makeEvent({ event_id: "e2", purchase_price: 500000, dealing_number: 1002 }),
    ];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect(cleaned).toHaveLength(1);
    expect(report.removed.zero_price).toBe(1);
  });

  it("removes records with empty contract_date", () => {
    const events = [makeEvent({ contract_date: "" })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect(cleaned).toHaveLength(0);
    expect(report.removed.invalid_date).toBe(1);
  });

  it("deduplicates by dealing_number", () => {
    const events = [
      makeEvent({ dealing_number: 1001 }),
      makeEvent({ event_id: "e2", dealing_number: 1001 }),
    ];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect(cleaned).toHaveLength(1);
    expect(report.removed.duplicates).toBe(1);
  });

  it("uppercases suburb names", () => {
    const events = [makeEvent({ suburb: "parramatta" })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect((cleaned[0].attribute as Record<string, unknown>).suburb).toBe("PARRAMATTA");
    expect(report.standardized.suburb_uppercased).toBe(1);
  });

  it("nullifies zero area", () => {
    const events = [makeEvent({ area: 0 })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect((cleaned[0].attribute as Record<string, unknown>).area).toBeNull();
    expect(report.standardized.area_nullified).toBe(1);
  });

  it("respects custom price_min param", () => {
    const events = [
      makeEvent({ purchase_price: 50 }),
      makeEvent({ event_id: "e2", purchase_price: 200, dealing_number: 1002 }),
    ];
    const { cleaned } = runHousingCleanPipeline(events, { price_min: 100 });
    expect(cleaned).toHaveLength(1);
  });

  it("skips dedup when dedup_by_dealing is false", () => {
    const events = [
      makeEvent({ dealing_number: 1001 }),
      makeEvent({ event_id: "e2", dealing_number: 1001 }),
    ];
    const { cleaned } = runHousingCleanPipeline(events, { dedup_by_dealing: false });
    expect(cleaned).toHaveLength(2);
  });

  it("returns correct report totals", () => {
    const events = [
      makeEvent({ purchase_price: 0 }),
      makeEvent({ event_id: "e2", dealing_number: 1001, purchase_price: 500000 }),
      makeEvent({ event_id: "e3", dealing_number: 1001, purchase_price: 600000 }),
      makeEvent({ event_id: "e4", dealing_number: 1002, purchase_price: 700000, suburb: "test", area: 0 }),
    ];
    const { report } = runHousingCleanPipeline(events);
    expect(report.input_count).toBe(4);
    expect(report.output_count).toBe(2);
    expect(report.removed.zero_price).toBe(1);
    expect(report.removed.duplicates).toBe(1);
  });

  it("fixes corrupted area_type from csv parse shift", () => {
    const events = [makeEvent({ area_type: "847.3" })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect((cleaned[0].attribute as Record<string, unknown>).area_type).toBe("");
    expect(report.standardized.area_type_fixed).toBe(1);
  });

  it("keeps valid area_type values", () => {
    const events = [makeEvent({ area_type: "M" })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect((cleaned[0].attribute as Record<string, unknown>).area_type).toBe("M");
    expect(report.standardized.area_type_fixed).toBe(0);
  });

  it("trims whitespace on string fields", () => {
    const events = [makeEvent({ street_name: "  King St  ", legal_description: " Lot 1 " })];
    const { cleaned, report } = runHousingCleanPipeline(events);
    expect((cleaned[0].attribute as Record<string, unknown>).street_name).toBe("King St");
    expect((cleaned[0].attribute as Record<string, unknown>).legal_description).toBe("Lot 1");
    expect(report.standardized.whitespace_trimmed).toBe(1);
  });

  it("skips suburb uppercasing when normalize_suburb is false", () => {
    const events = [makeEvent({ suburb: "parramatta" })];
    const { cleaned, report } = runHousingCleanPipeline(events, { normalize_suburb: false });
    expect((cleaned[0].attribute as Record<string, unknown>).suburb).toBe("parramatta");
    expect(report.standardized.suburb_uppercased).toBe(0);
  });

  it("skips area nullification when nullify_zero_area is false", () => {
    const events = [makeEvent({ area: 0 })];
    const { cleaned, report } = runHousingCleanPipeline(events, { nullify_zero_area: false });
    expect((cleaned[0].attribute as Record<string, unknown>).area).toBe(0);
    expect(report.standardized.area_nullified).toBe(0);
  });

  it("skips area_type fix when fix_area_type is false", () => {
    const events = [makeEvent({ area_type: "847.3" })];
    const { cleaned, report } = runHousingCleanPipeline(events, { fix_area_type: false });
    expect((cleaned[0].attribute as Record<string, unknown>).area_type).toBe("847.3");
    expect(report.standardized.area_type_fixed).toBe(0);
  });

  it("skips whitespace trimming when trim_whitespace is false", () => {
    const events = [makeEvent({ street_name: "  King St  " })];
    const { cleaned, report } = runHousingCleanPipeline(events, { trim_whitespace: false });
    expect((cleaned[0].attribute as Record<string, unknown>).street_name).toBe("  King St  ");
    expect(report.standardized.whitespace_trimmed).toBe(0);
  });
});
