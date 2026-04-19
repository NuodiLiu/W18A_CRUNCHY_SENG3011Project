/**
 * Unit tests for the "nsw_population" dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps "nsw_population" → "nsw_population"
 *   - resolveEventType works for "nsw_population"
 *   - NSW_POPULATION_DIMENSIONS and NSW_POPULATION_METRICS are valid
 *   - validateDimension and validateMetric do not throw for registered values
 *   - getEvents passes dataset_type:nsw_population through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=nsw_population returns events
 *   - Suburb and category filters work for nsw_population events
 *   - Visualisation breakdown by suburb + persons returns correct shape
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  NSW_POPULATION_DIMENSIONS,
  NSW_POPULATION_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Shared mock nsw_population events ─────────────────────────────────────────

const fakeNswPopEvents = [
  {
    event_id: "nswpop-1",
    event_type: "nsw_population",
    time_object: { timestamp: "2016-08-09T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Auburn",
      lga: "Cumberland",
      suburb_code: "10107",
      category: "Total persons",
      sub_category: "Total persons",
      males: 18500,
      females: 18000,
      persons: 36500,
    },
  },
  {
    event_id: "nswpop-2",
    event_type: "nsw_population",
    time_object: { timestamp: "2016-08-09T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Auburn",
      lga: "Cumberland",
      suburb_code: "10107",
      category: "Age groups",
      sub_category: "0-4 years",
      males: 1100,
      females: 1050,
      persons: 2150,
    },
  },
  {
    event_id: "nswpop-3",
    event_type: "nsw_population",
    time_object: { timestamp: "2011-08-09T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Chester Hill",
      lga: "Canterbury-Bankstown",
      suburb_code: "10898",
      category: "Age groups",
      sub_category: "15-19 years",
      males: 449,
      females: 458,
      persons: 907,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(nswPopEvents = fakeNswPopEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events: nswPopEvents, total: nswPopEvents.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["nsw_population"]),
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
  it('maps "nsw_population" to "nsw_population"', () => {
    expect(DATASET_TYPE_MAP["nsw_population"]).toBe("nsw_population");
  });
});

describe("resolveEventType", () => {
  it('resolves "nsw_population" to "nsw_population"', () => {
    expect(resolveEventType("nsw_population")).toBe("nsw_population");
  });
});

// ── 2. Dimension / metric allowlists ──────────────────────────────────────────

describe("NSW_POPULATION_DIMENSIONS", () => {
  it("contains suburb, lga, category, sub_category, suburb_code", () => {
    expect(NSW_POPULATION_DIMENSIONS).toContain("suburb");
    expect(NSW_POPULATION_DIMENSIONS).toContain("lga");
    expect(NSW_POPULATION_DIMENSIONS).toContain("category");
    expect(NSW_POPULATION_DIMENSIONS).toContain("sub_category");
    expect(NSW_POPULATION_DIMENSIONS).toContain("suburb_code");
  });

  it.each([...NSW_POPULATION_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("NSW_POPULATION_METRICS", () => {
  it("contains males, females, persons", () => {
    expect(NSW_POPULATION_METRICS).toContain("males");
    expect(NSW_POPULATION_METRICS).toContain("females");
    expect(NSW_POPULATION_METRICS).toContain("persons");
  });

  it.each([...NSW_POPULATION_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents application service ─────────────────────────────────────────

describe("getEvents with nsw_population dataset_type", () => {
  it("passes dataset_type:nsw_population directly to dataLakeReader.queryEvents", async () => {
    const reader = makeMockReader();
    const deps = { dataLakeReader: reader };
    await getEvents({ dataset_type: "nsw_population", limit: 10, offset: 0 }, deps);
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_population" }),
    );
  });

  it("returns the events and total from the reader", async () => {
    const reader = makeMockReader();
    const result = await getEvents({ dataset_type: "nsw_population", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("passes suburb filter through to queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents(
      { dataset_type: "nsw_population", suburb: "Auburn", limit: 10, offset: 0 },
      { dataLakeReader: reader },
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Auburn" }),
    );
  });
});

// ── 4. HTTP layer ─────────────────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=nsw_population", () => {
  it("returns 200 with nsw_population events", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_population&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    expect(res.body.events[0].event_type).toBe("nsw_population");
  });

  it("calls queryEvents with dataset_type=nsw_population", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=nsw_population").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_population" }),
    );
  });

  it("forwards suburb query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=nsw_population&suburb=Auburn")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Auburn" }),
    );
  });

  it("returns 200 with empty result for unknown suburb", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_population&suburb=NoSuchSuburb")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 5. Visualisation: breakdown ───────────────────────────────────────────────

describe("GET /api/v1/visualisation/breakdown for nsw_population", () => {
  it("returns 200 for breakdown by suburb + persons", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Auburn", value: 36500, count: 1 },
      { group_key: "Chester Hill", value: 907, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_population&dimension=suburb&metric=persons&aggregation=sum&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("persons");
  });

  it("returns 200 for breakdown by category + persons", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Total persons", value: 36500, count: 1 },
      { group_key: "Age groups", value: 3057, count: 2 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_population&dimension=category&metric=persons&aggregation=sum&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("category");
  });

  it("calls aggregateByDimension with correct dataset_type", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([]);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_population&dimension=suburb&metric=persons&aggregation=sum")
      .expect(200);

    expect(reader.aggregateByDimension).toHaveBeenCalledWith(
      "nsw_population",
      "suburb",
      "persons",
      "sum",
      expect.any(Number),
      undefined,
    );
  });

  it("returns 400 for invalid dimension", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_population&dimension=invalid_dim&metric=persons&aggregation=sum")
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_population&dimension=suburb&metric=invalid_metric&aggregation=sum")
      .expect(400);
  });
});
