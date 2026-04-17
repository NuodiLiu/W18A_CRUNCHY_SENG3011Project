/**
 * Unit tests for the "abs_census" (abs_census_2021) dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps "abs_census" → "abs_census_2021"
 *   - resolveEventType works for "abs_census"
 *   - ABS_CENSUS_DIMENSIONS and ABS_CENSUS_METRICS are valid
 *   - validateDimension does not throw for any ABS_CENSUS_DIMENSION
 *   - validateMetric does not throw for any ABS_CENSUS_METRIC
 *   - getEvents passes dataset_type:abs_census through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=abs_census returns events
 *   - Suburb filter works for abs_census events
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  ABS_CENSUS_DIMENSIONS,
  ABS_CENSUS_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Shared mock abs_census events ─────────────────────────────────────────────

const fakeAbsEvents = [
  {
    event_id: "abs-1",
    event_type: "abs_census_2021",
    time_object: { timestamp: "2021-08-10T00:00:00Z", timezone: "Australia/Sydney" },
    attribute: {
      suburb: "Sydney",
      sal_code: "SAL13730",
      total_population: 16667,
      median_age: 32,
      median_rent_weekly: 600,
      median_mortgage_monthly: 2800,
      median_personal_income_weekly: 971,
      median_household_income_weekly: 1500,
      owned_outright: 1200,
      owned_mortgage: 2100,
      rented_total: 9800,
      separate_houses: 400,
      flats_apartments: 7200,
      labour_force_pct: 72.5,
      unemployment_pct: 5.8,
      employed_fulltime: 8100,
      employed_parttime: 2600,
      unemployed: 630,
    },
  },
  {
    event_id: "abs-2",
    event_type: "abs_census_2021",
    time_object: { timestamp: "2021-08-10T00:00:00Z", timezone: "Australia/Sydney" },
    attribute: {
      suburb: "Parramatta",
      sal_code: "SAL13309",
      total_population: 29594,
      median_age: 34,
      median_rent_weekly: 450,
      median_mortgage_monthly: 2200,
      median_personal_income_weekly: 855,
      median_household_income_weekly: 1350,
      owned_outright: 2400,
      owned_mortgage: 3100,
      rented_total: 8200,
      separate_houses: 1500,
      flats_apartments: 5800,
      labour_force_pct: 65.2,
      unemployment_pct: 7.1,
      employed_fulltime: 9800,
      employed_parttime: 3100,
      unemployed: 950,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(absEvents = fakeAbsEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events: absEvents, total: absEvents.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["abs_census_2021"]),
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
  it('maps "abs_census" to "abs_census_2021"', () => {
    expect(DATASET_TYPE_MAP["abs_census"]).toBe("abs_census_2021");
  });
});

describe("resolveEventType", () => {
  it('resolves "abs_census" to "abs_census_2021"', () => {
    expect(resolveEventType("abs_census")).toBe("abs_census_2021");
  });
});

// ── 2. Dimension / metric allowlists ──────────────────────────────────────────

describe("ABS_CENSUS_DIMENSIONS", () => {
  it("contains suburb and sal_code", () => {
    expect(ABS_CENSUS_DIMENSIONS).toContain("suburb");
    expect(ABS_CENSUS_DIMENSIONS).toContain("sal_code");
  });

  it.each([...ABS_CENSUS_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("ABS_CENSUS_METRICS", () => {
  it("contains key financial and demographic metrics", () => {
    expect(ABS_CENSUS_METRICS).toContain("total_population");
    expect(ABS_CENSUS_METRICS).toContain("median_rent_weekly");
    expect(ABS_CENSUS_METRICS).toContain("median_mortgage_monthly");
    expect(ABS_CENSUS_METRICS).toContain("median_household_income_weekly");
    expect(ABS_CENSUS_METRICS).toContain("unemployment_pct");
  });

  it.each([...ABS_CENSUS_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents application service ─────────────────────────────────────────

describe("getEvents with abs_census dataset_type", () => {
  it("passes dataset_type:abs_census directly to dataLakeReader.queryEvents", async () => {
    const reader = makeMockReader();
    const deps = { dataLakeReader: reader };
    await getEvents({ dataset_type: "abs_census", limit: 10, offset: 0 }, deps);
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "abs_census" }),
    );
  });

  it("returns the events and total from the reader", async () => {
    const reader = makeMockReader();
    const result = await getEvents({ dataset_type: "abs_census", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("passes suburb filter through to queryEvents", async () => {
    const reader = makeMockReader();
    const deps = { dataLakeReader: reader };
    await getEvents(
      { dataset_type: "abs_census", suburb: "Sydney", limit: 10, offset: 0 },
      deps,
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Sydney" }),
    );
  });
});

// ── 4. HTTP layer ─────────────────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=abs_census", () => {
  it("returns 200 with abs_census events", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=abs_census&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].event_type).toBe("abs_census_2021");
  });

  it("calls queryEvents with dataset_type=abs_census", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=abs_census").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "abs_census" }),
    );
  });

  it("forwards suburb query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=abs_census&suburb=Sydney")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Sydney" }),
    );
  });

  it("returns 200 even with unknown suburb (empty result)", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=abs_census&suburb=NoSuchSuburb")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 5. Visualisation: breakdown ───────────────────────────────────────────────

describe("GET /api/v1/visualisation/breakdown for abs_census", () => {
  it("returns 200 for breakdown by suburb + total_population", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Sydney", value: 16667, count: 1 },
      { group_key: "Parramatta", value: 29594, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=abs_census&dimension=suburb&metric=total_population&aggregation=sum&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("total_population");
  });

  it("returns 200 for breakdown by suburb + median_rent_weekly", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Sydney", value: 600, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=abs_census&dimension=suburb&metric=median_rent_weekly&aggregation=avg&limit=10")
      .expect(200);

    expect(res.body.entries[0].value).toBe(600);
  });

  it("returns 400 for invalid dimension", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=abs_census&dimension=invalid_dim&metric=total_population&aggregation=sum")
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=abs_census&dimension=suburb&metric=not_a_metric&aggregation=avg")
      .expect(400);
  });
});
