/**
 * Unit tests for the "nsw_tax" dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps "nsw_tax" → "nsw_tax"
 *   - resolveEventType works for "nsw_tax"
 *   - NSW_TAX_DIMENSIONS and NSW_TAX_METRICS are valid
 *   - validateDimension and validateMetric do not throw for registered values
 *   - getEvents passes dataset_type:nsw_tax through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=nsw_tax returns events
 *   - Suburb and postcode filters work for nsw_tax events
 *   - Visualisation breakdown/timeseries return correct shape
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  NSW_TAX_DIMENSIONS,
  NSW_TAX_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Shared mock nsw_tax events ────────────────────────────────────────────────

const fakeNswTaxEvents = [
  {
    event_id: "nswtax-1",
    event_type: "nsw_tax",
    time_object: { timestamp: "2017-06-30T00:00:00.000Z", timezone: "Australia/Sydney" },
    attribute: {
      year: "2017",
      postcode: 2000,
      suburb: "BARANGAROO",
      avg_taxable_income: 66698.0,
      prop_salary_wages: 0.84,
      avg_salary_wages: 54325.0,
    },
  },
  {
    event_id: "nswtax-2",
    event_type: "nsw_tax",
    time_object: { timestamp: "2018-06-30T00:00:00.000Z", timezone: "Australia/Sydney" },
    attribute: {
      year: "2018",
      postcode: 2000,
      suburb: "BARANGAROO",
      avg_taxable_income: 70120.0,
      prop_salary_wages: 0.85,
      avg_salary_wages: 57150.0,
    },
  },
  {
    event_id: "nswtax-3",
    event_type: "nsw_tax",
    time_object: { timestamp: "2017-06-30T00:00:00.000Z", timezone: "Australia/Sydney" },
    attribute: {
      year: "2017",
      postcode: 2008,
      suburb: "CHIPPENDALE",
      avg_taxable_income: 78230.0,
      prop_salary_wages: 0.88,
      avg_salary_wages: 65120.0,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(nswTaxEvents = fakeNswTaxEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events: nswTaxEvents, total: nswTaxEvents.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["nsw_tax"]),
    getGroupProjection: jest.fn().mockResolvedValue([]),
    readDataset: jest.fn(),
    aggregateByDimension: jest.fn().mockResolvedValue([]),
    aggregateByTimePeriod: jest.fn().mockResolvedValue([]),
  };
}

function buildApp(dataLakeReader = makeMockReader()) {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn(),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
      incrementChunksDone: jest.fn().mockResolvedValue(1),
    },
    configStore: { putConfig: jest.fn(), getConfig: jest.fn() },
    queue: { sendMessage: jest.fn(), receiveMessages: jest.fn(), deleteMessage: jest.fn() },
    fileUploadService: { presignPut: jest.fn(), initMultipart: jest.fn(), completeMultipart: jest.fn() },
    dataLakeReader,
  };
  return { app: createApp(deps as Parameters<typeof createApp>[0]), deps };
}

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// ── 1. Domain model registration ──────────────────────────────────────────────

describe("DATASET_TYPE_MAP", () => {
  it('maps "nsw_tax" to "nsw_tax"', () => {
    expect(DATASET_TYPE_MAP["nsw_tax"]).toBe("nsw_tax");
  });
});

describe("resolveEventType", () => {
  it('resolves "nsw_tax" to "nsw_tax"', () => {
    expect(resolveEventType("nsw_tax")).toBe("nsw_tax");
  });
});

// ── 2. Dimension / metric allowlists ──────────────────────────────────────────

describe("NSW_TAX_DIMENSIONS", () => {
  it("contains suburb, postcode, year", () => {
    expect(NSW_TAX_DIMENSIONS).toContain("suburb");
    expect(NSW_TAX_DIMENSIONS).toContain("postcode");
    expect(NSW_TAX_DIMENSIONS).toContain("year");
  });

  it.each([...NSW_TAX_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("NSW_TAX_METRICS", () => {
  it("contains avg_taxable_income, prop_salary_wages, avg_salary_wages", () => {
    expect(NSW_TAX_METRICS).toContain("avg_taxable_income");
    expect(NSW_TAX_METRICS).toContain("prop_salary_wages");
    expect(NSW_TAX_METRICS).toContain("avg_salary_wages");
  });

  it.each([...NSW_TAX_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents application service ──────────────────────────────────────────

describe("getEvents with nsw_tax dataset_type", () => {
  it("passes dataset_type:nsw_tax directly to dataLakeReader.queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents({ dataset_type: "nsw_tax", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_tax" }),
    );
  });

  it("returns the events and total from the reader", async () => {
    const reader = makeMockReader();
    const result = await getEvents(
      { dataset_type: "nsw_tax", limit: 10, offset: 0 },
      { dataLakeReader: reader },
    );
    expect(result.events).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("passes suburb filter through to queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents(
      { dataset_type: "nsw_tax", suburb: "BARANGAROO", limit: 10, offset: 0 },
      { dataLakeReader: reader },
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "BARANGAROO" }),
    );
  });

  it("passes postcode filter through to queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents(
      { dataset_type: "nsw_tax", postcode: 2000, limit: 10, offset: 0 },
      { dataLakeReader: reader },
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ postcode: 2000 }),
    );
  });
});

// ── 4. HTTP layer ─────────────────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=nsw_tax", () => {
  it("returns 200 with nsw_tax events", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_tax&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    expect(res.body.events[0].event_type).toBe("nsw_tax");
  });

  it("calls queryEvents with dataset_type=nsw_tax", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=nsw_tax").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_tax" }),
    );
  });

  it("forwards suburb query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=nsw_tax&suburb=BARANGAROO")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "BARANGAROO" }),
    );
  });

  it("forwards postcode query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=nsw_tax&postcode=2000")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ postcode: 2000 }),
    );
  });

  it("returns 200 with empty result for unknown suburb", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_tax&suburb=NoSuchSuburb")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 5. Visualisation: breakdown ───────────────────────────────────────────────

describe("GET /api/v1/visualisation/breakdown for nsw_tax", () => {
  it("returns 200 for breakdown by suburb + avg_taxable_income", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "BARANGAROO", value: 68409, count: 2 },
      { group_key: "CHIPPENDALE", value: 78230, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get(
        "/api/v1/visualisation/breakdown?dataset_type=nsw_tax&dimension=suburb&metric=avg_taxable_income&aggregation=avg&limit=10",
      )
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("avg_taxable_income");
  });

  it("calls aggregateByDimension with correct event_type", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([]);
    const { app } = buildApp(reader);

    await request(app)
      .get(
        "/api/v1/visualisation/breakdown?dataset_type=nsw_tax&dimension=suburb&metric=avg_taxable_income&aggregation=avg",
      )
      .expect(200);

    expect(reader.aggregateByDimension).toHaveBeenCalledWith(
      "nsw_tax",
      "suburb",
      "avg_taxable_income",
      "avg",
      expect.any(Number),
      undefined,
    );
  });

  it("returns 400 for invalid dimension", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get(
        "/api/v1/visualisation/breakdown?dataset_type=nsw_tax&dimension=invalid_dim&metric=avg_taxable_income&aggregation=avg",
      )
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get(
        "/api/v1/visualisation/breakdown?dataset_type=nsw_tax&dimension=suburb&metric=invalid_metric&aggregation=avg",
      )
      .expect(400);
  });
});

// ── 6. Visualisation: timeseries ──────────────────────────────────────────────

describe("GET /api/v1/visualisation/timeseries for nsw_tax", () => {
  it("returns 200 for yearly timeseries of avg_taxable_income", async () => {
    const reader = makeMockReader();
    reader.aggregateByTimePeriod = jest.fn().mockResolvedValue([
      { group_key: "2017", value: 72464, count: 2 },
      { group_key: "2018", value: 70120, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get(
        "/api/v1/visualisation/timeseries?dataset_type=nsw_tax&metric=avg_taxable_income&aggregation=avg&time_period=year",
      )
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.metric).toBe("avg_taxable_income");
    expect(res.body.time_period).toBe("year");
  });

  it("calls aggregateByTimePeriod with correct event_type", async () => {
    const reader = makeMockReader();
    reader.aggregateByTimePeriod = jest.fn().mockResolvedValue([]);
    const { app } = buildApp(reader);

    await request(app)
      .get(
        "/api/v1/visualisation/timeseries?dataset_type=nsw_tax&metric=avg_taxable_income&aggregation=avg&time_period=year",
      )
      .expect(200);

    expect(reader.aggregateByTimePeriod).toHaveBeenCalledWith(
      "nsw_tax",
      "year",
      "avg_taxable_income",
      "avg",
      undefined,
      undefined,
    );
  });
});
