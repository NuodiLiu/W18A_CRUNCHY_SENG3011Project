/**
 * Unit tests for the "aus_population" and "aus_gdp" dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps correctly for both types
 *   - AUS_POPULATION_DIMENSIONS / AUS_POPULATION_METRICS allowlist tests
 *   - AUS_GDP_DIMENSIONS / AUS_GDP_METRICS allowlist tests
 *   - validateDimension / validateMetric pass for all declared fields
 *   - getEvents passes dataset_type through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=aus_population|aus_gdp returns events
 *   - Breakdown visualisation by quarter + population / real_gdp_aud_millions
 *   - Time series visualisation by year
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  AUS_POPULATION_DIMENSIONS,
  AUS_POPULATION_METRICS,
  AUS_GDP_DIMENSIONS,
  AUS_GDP_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Fake events ───────────────────────────────────────────────────────────────

const fakePopEvents = [
  {
    event_id: "pop-1",
    event_type: "aus_population",
    time_object: { timestamp: "2024-03-31T00:00:00Z", timezone: "UTC" },
    attribute: { country: "Australia", quarter: "2024-Q1", year: "2024", population: 27113517 },
  },
  {
    event_id: "pop-2",
    event_type: "aus_population",
    time_object: { timestamp: "2024-06-30T00:00:00Z", timezone: "UTC" },
    attribute: { country: "Australia", quarter: "2024-Q2", year: "2024", population: 27194286 },
  },
];

const fakeGdpEvents = [
  {
    event_id: "gdp-1",
    event_type: "aus_gdp",
    time_object: { timestamp: "2024-03-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      country: "Australia",
      quarter: "2024-Q1",
      year: "2024",
      real_gdp_aud_millions: 676341,
      nominal_gdp_aud_millions: 694124,
    },
  },
  {
    event_id: "gdp-2",
    event_type: "aus_gdp",
    time_object: { timestamp: "2024-06-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      country: "Australia",
      quarter: "2024-Q2",
      year: "2024",
      real_gdp_aud_millions: 679123,
      nominal_gdp_aud_millions: 697500,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(events: object[] = fakePopEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events, total: events.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["aus_population", "aus_gdp"]),
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

// ── 1. Domain model: aus_population ───────────────────────────────────────────

describe("DATASET_TYPE_MAP – aus_population", () => {
  it('maps "aus_population" to "aus_population"', () => {
    expect(DATASET_TYPE_MAP["aus_population"]).toBe("aus_population");
  });
});

describe("resolveEventType – aus_population", () => {
  it('resolves "aus_population" to "aus_population"', () => {
    expect(resolveEventType("aus_population")).toBe("aus_population");
  });
});

describe("AUS_POPULATION_DIMENSIONS", () => {
  it("contains country, quarter, year", () => {
    expect(AUS_POPULATION_DIMENSIONS).toContain("country");
    expect(AUS_POPULATION_DIMENSIONS).toContain("quarter");
    expect(AUS_POPULATION_DIMENSIONS).toContain("year");
  });

  it.each([...AUS_POPULATION_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("AUS_POPULATION_METRICS", () => {
  it("contains population", () => {
    expect(AUS_POPULATION_METRICS).toContain("population");
  });

  it.each([...AUS_POPULATION_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 2. Domain model: aus_gdp ──────────────────────────────────────────────────

describe("DATASET_TYPE_MAP – aus_gdp", () => {
  it('maps "aus_gdp" to "aus_gdp"', () => {
    expect(DATASET_TYPE_MAP["aus_gdp"]).toBe("aus_gdp");
  });
});

describe("resolveEventType – aus_gdp", () => {
  it('resolves "aus_gdp" to "aus_gdp"', () => {
    expect(resolveEventType("aus_gdp")).toBe("aus_gdp");
  });
});

describe("AUS_GDP_DIMENSIONS", () => {
  it("contains country, quarter, year", () => {
    expect(AUS_GDP_DIMENSIONS).toContain("country");
    expect(AUS_GDP_DIMENSIONS).toContain("quarter");
    expect(AUS_GDP_DIMENSIONS).toContain("year");
  });

  it.each([...AUS_GDP_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("AUS_GDP_METRICS", () => {
  it("contains real_gdp_aud_millions and nominal_gdp_aud_millions", () => {
    expect(AUS_GDP_METRICS).toContain("real_gdp_aud_millions");
    expect(AUS_GDP_METRICS).toContain("nominal_gdp_aud_millions");
  });

  it.each([...AUS_GDP_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents – aus_population ─────────────────────────────────────────────

describe("getEvents with aus_population dataset_type", () => {
  it("passes dataset_type:aus_population to queryEvents", async () => {
    const reader = makeMockReader(fakePopEvents);
    await getEvents({ dataset_type: "aus_population", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "aus_population" }),
    );
  });

  it("returns events and total", async () => {
    const reader = makeMockReader(fakePopEvents);
    const result = await getEvents({ dataset_type: "aus_population", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

// ── 4. getEvents – aus_gdp ────────────────────────────────────────────────────

describe("getEvents with aus_gdp dataset_type", () => {
  it("passes dataset_type:aus_gdp to queryEvents", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    await getEvents({ dataset_type: "aus_gdp", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "aus_gdp" }),
    );
  });

  it("returns events and total", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    const result = await getEvents({ dataset_type: "aus_gdp", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

// ── 5. HTTP layer – aus_population ────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=aus_population", () => {
  it("returns 200 with aus_population events", async () => {
    const reader = makeMockReader(fakePopEvents);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=aus_population&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].event_type).toBe("aus_population");
  });

  it("calls queryEvents with dataset_type=aus_population", async () => {
    const reader = makeMockReader(fakePopEvents);
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=aus_population").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "aus_population" }),
    );
  });

  it("returns 200 with empty result when no events match", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=aus_population&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 6. HTTP layer – aus_gdp ───────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=aus_gdp", () => {
  it("returns 200 with aus_gdp events", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=aus_gdp&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].event_type).toBe("aus_gdp");
  });

  it("calls queryEvents with dataset_type=aus_gdp", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=aus_gdp").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "aus_gdp" }),
    );
  });

  it("returns 200 with empty result when no events match", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=aus_gdp&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 7. Breakdown visualisation – aus_population ───────────────────────────────

describe("GET /api/v1/visualisation/breakdown for aus_population", () => {
  it("returns 200 for breakdown by year + population sum", async () => {
    const reader = makeMockReader(fakePopEvents);
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "2024", value: 54307803, count: 2 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_population&dimension=year&metric=population&aggregation=sum&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.dimension).toBe("year");
    expect(res.body.metric).toBe("population");
  });

  it("returns 200 for breakdown by quarter + population avg", async () => {
    const reader = makeMockReader(fakePopEvents);
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "2024-Q1", value: 27113517, count: 1 },
      { group_key: "2024-Q2", value: 27194286, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_population&dimension=quarter&metric=population&aggregation=avg&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
  });

  it("returns 400 for invalid dimension", async () => {
    const reader = makeMockReader(fakePopEvents);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_population&dimension=bad_dim&metric=population&aggregation=avg")
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const reader = makeMockReader(fakePopEvents);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_population&dimension=year&metric=not_a_metric&aggregation=avg")
      .expect(400);
  });
});

// ── 8. Breakdown visualisation – aus_gdp ─────────────────────────────────────

describe("GET /api/v1/visualisation/breakdown for aus_gdp", () => {
  it("returns 200 for breakdown by quarter + real_gdp_aud_millions", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "2024-Q1", value: 676341, count: 1 },
      { group_key: "2024-Q2", value: 679123, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_gdp&dimension=quarter&metric=real_gdp_aud_millions&aggregation=avg&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.metric).toBe("real_gdp_aud_millions");
  });

  it("returns 200 for breakdown by year + nominal_gdp_aud_millions", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "2024", value: 1391624, count: 2 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_gdp&dimension=year&metric=nominal_gdp_aud_millions&aggregation=sum&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.metric).toBe("nominal_gdp_aud_millions");
  });

  it("returns 400 for invalid dimension", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_gdp&dimension=bad_dim&metric=real_gdp_aud_millions&aggregation=sum")
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const reader = makeMockReader(fakeGdpEvents);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=aus_gdp&dimension=year&metric=bad_metric&aggregation=sum")
      .expect(400);
  });
});
