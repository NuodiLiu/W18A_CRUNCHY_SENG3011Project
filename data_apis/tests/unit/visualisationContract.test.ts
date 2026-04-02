/**
 * Contract tests — provider side.
 *
 * Verifies that the backend visualisation endpoints return responses
 * whose shape matches the documented contract (OpenAPI / tsoa types)
 * consumed by reporting_frontend.
 *
 * These run with mocked deps (no DB), ensuring the HTTP response
 * structure is stable regardless of underlying data changes.
 */

import request from "supertest";
import { createApp } from "../../src/http/app";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// ── Fixtures ──────────────────────────────────────────────────

const fakeHousingEvents = [
  {
    event_id: "c-h1",
    time_object: { timestamp: "2022-03-15T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P100",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 900000,
      area: 100,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
      contract_date: "2022-03-15",
    },
  },
  {
    event_id: "c-h2",
    time_object: { timestamp: "2023-07-20T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P101",
      suburb: "Melbourne",
      postcode: 3000,
      purchase_price: 750000,
      area: 80,
      zoning: "R2",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
      contract_date: "2023-07-20",
    },
  },
];

const fakeEsgEvents = [
  {
    event_id: "c-e1",
    time_object: { timestamp: "2021-01-01T00:00:00Z", timezone: "UTC" },
    event_type: "esg_metric",
    attribute: {
      permid: "AAA",
      company_name: "GreenCo",
      metric_name: "CO2",
      metric_value: 50,
      metric_year: 2021,
      pillar: "Environmental",
      industry: "Tech",
    },
  },
];

function buildApp(events = fakeHousingEvents) {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn(),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
    },
    configStore: {
      putConfig: jest.fn(),
      getConfig: jest.fn(),
    },
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
      queryEvents: jest.fn().mockResolvedValue({ events, total: events.length }),
      findEventById: jest.fn(),
      getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
      getGroupProjection: jest.fn().mockResolvedValue(events),
      readDataset: jest.fn().mockResolvedValue(undefined),
    },
  };
  const app = createApp(deps as Parameters<typeof createApp>[0]);
  return { app, deps };
}

// ── Schema helpers ──────────────────────────────────────────────

/**
 * TimeSeriesResponse contract (as consumed by reporting_frontend):
 * {
 *   metric: string,
 *   aggregation: string,
 *   event_type: string,
 *   time_period?: string,
 *   dimension?: string,
 *   data: Array<{ period: string, value: number, count: number, series?: string }>
 * }
 */
function assertTimeSeriesContract(body: Record<string, unknown>) {
  expect(body).toHaveProperty("metric");
  expect(body).toHaveProperty("aggregation");
  expect(body).toHaveProperty("event_type");
  expect(body).toHaveProperty("data");

  expect(typeof body.metric).toBe("string");
  expect(typeof body.aggregation).toBe("string");
  expect(typeof body.event_type).toBe("string");
  expect(Array.isArray(body.data)).toBe(true);

  for (const point of body.data as Record<string, unknown>[]) {
    expect(typeof point.period).toBe("string");
    expect(typeof point.value).toBe("number");
    expect(typeof point.count).toBe("number");
    // series is optional — if present, must be string
    if (point.series !== undefined && point.series !== null) {
      expect(typeof point.series).toBe("string");
    }
  }
}

/**
 * BreakdownResponse contract:
 * {
 *   dimension: string,
 *   metric: string,
 *   aggregation: string,
 *   event_type: string,
 *   entries: Array<{ category: string, value: number, count: number }>
 * }
 */
function assertBreakdownContract(body: Record<string, unknown>) {
  expect(body).toHaveProperty("dimension");
  expect(body).toHaveProperty("metric");
  expect(body).toHaveProperty("aggregation");
  expect(body).toHaveProperty("event_type");
  expect(body).toHaveProperty("entries");

  expect(typeof body.dimension).toBe("string");
  expect(typeof body.metric).toBe("string");
  expect(typeof body.aggregation).toBe("string");
  expect(typeof body.event_type).toBe("string");
  expect(Array.isArray(body.entries)).toBe(true);

  for (const entry of body.entries as Record<string, unknown>[]) {
    expect(typeof entry.category).toBe("string");
    expect(typeof entry.value).toBe("number");
    expect(typeof entry.count).toBe("number");
  }
}

// ── Contract: /api/v1/visualisation/timeseries ──────────────────

describe("Contract: GET /api/v1/visualisation/timeseries", () => {
  it("response shape matches TimeSeriesResponse contract", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", metric: "purchase_price", aggregation: "avg", time_period: "year" })
      .expect(200);

    assertTimeSeriesContract(res.body);
  });

  it("data points have period/value/count (the fields frontend normaliseHousing reads)", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", metric: "purchase_price", aggregation: "avg", time_period: "year" })
      .expect(200);

    // Frontend calls: raw.data.map(d => ({ period: d.period, value: Math.round(d.value) }))
    // So data[] must be under .data key with period + value fields
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThan(0);
    const first = res.body.data[0];
    expect(first.period).toBeDefined();
    expect(first.value).toBeDefined();
    expect(typeof first.period).toBe("string");
    expect(typeof first.value).toBe("number");
  });

  it("returns .data (not .entries) — matches frontend expectation", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    // Frontend does: raw.data.map(...)
    // Must be .data, not .entries
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("empty dataset still returns valid contract shape", async () => {
    const { app } = buildApp([]);
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale" })
      .expect(200);

    assertTimeSeriesContract(res.body);
    expect(res.body.data).toEqual([]);
  });

  it("dimension query returns series field on data points", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", dimension: "suburb", metric: "purchase_price", aggregation: "avg", time_period: "year" })
      .expect(200);

    assertTimeSeriesContract(res.body);
    expect(res.body.dimension).toBe("suburb");
    for (const point of res.body.data) {
      expect(typeof point.series).toBe("string");
    }
  });

  it("returns correct field names used by frontend (metric, aggregation, event_type, time_period)", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", metric: "purchase_price", aggregation: "avg", time_period: "month" })
      .expect(200);

    expect(res.body.metric).toBe("purchase_price");
    expect(res.body.aggregation).toBe("avg");
    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.time_period).toBe("month");
  });

  it("rejects invalid dimension with 400", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "invalid_dim" });

    expect(res.status).toBe(400);
  });

  it("rejects invalid metric with 400", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "invalid_metric" });

    expect(res.status).toBe(400);
  });
});

// ── Contract: /api/v1/visualisation/breakdown ───────────────────

describe("Contract: GET /api/v1/visualisation/breakdown", () => {
  it("response shape matches BreakdownResponse contract", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb", metric: "purchase_price", aggregation: "avg" })
      .expect(200);

    assertBreakdownContract(res.body);
  });

  it("entries have category/value/count fields", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb" })
      .expect(200);

    expect(res.body.entries.length).toBeGreaterThan(0);
    const first = res.body.entries[0];
    expect(typeof first.category).toBe("string");
    expect(typeof first.value).toBe("number");
    expect(typeof first.count).toBe("number");
  });

  it("returns .entries (not .data) — different from timeseries", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body).toHaveProperty("entries");
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it("empty dataset still returns valid contract shape", async () => {
    const { app } = buildApp([]);
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb" })
      .expect(200);

    assertBreakdownContract(res.body);
    expect(res.body.entries).toEqual([]);
  });

  it("returns correct metadata fields (dimension, metric, aggregation, event_type)", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "avg", event_type: "housing_sale" })
      .expect(200);

    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("purchase_price");
    expect(res.body.aggregation).toBe("avg");
    expect(res.body.event_type).toBe("housing_sale");
  });

  it("rejects invalid dimension with 400", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "invalid_dim" });

    expect(res.status).toBe(400);
  });
});

// ── Cross-endpoint contract consistency ─────────────────────────

describe("Contract: cross-endpoint consistency", () => {
  it("timeseries uses .data[] while breakdown uses .entries[]", async () => {
    const { app } = buildApp();

    const tsRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);
    const bdRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    // timeseries → .data
    expect(tsRes.body).toHaveProperty("data");
    expect(tsRes.body).not.toHaveProperty("entries");

    // breakdown → .entries
    expect(bdRes.body).toHaveProperty("entries");
    expect(bdRes.body).not.toHaveProperty("data");
  });

  it("both endpoints share common metadata fields", async () => {
    const { app } = buildApp();

    const tsRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);
    const bdRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    for (const body of [tsRes.body, bdRes.body]) {
      expect(body).toHaveProperty("metric");
      expect(body).toHaveProperty("aggregation");
      expect(body).toHaveProperty("event_type");
    }
  });

  it("both endpoints return 200 with valid aggregation types", async () => {
    const { app } = buildApp();

    for (const agg of ["avg", "sum", "count", "min", "max"]) {
      await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ aggregation: agg })
        .expect(200);
      await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ aggregation: agg })
        .expect(200);
    }
  });
});
