/**
 * Unit tests for the "nsw_weather" dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps "nsw_weather" → "nsw_weather"
 *   - resolveEventType works for "nsw_weather"
 *   - NSW_WEATHER_DIMENSIONS and NSW_WEATHER_METRICS are valid
 *   - validateDimension and validateMetric do not throw for registered values
 *   - getEvents passes dataset_type:nsw_weather through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=nsw_weather returns events
 *   - suburb / lga filters forwarded correctly
 *   - Visualisation breakdown by suburb + avg_temp returns correct shape
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  NSW_WEATHER_DIMENSIONS,
  NSW_WEATHER_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Shared mock nsw_weather events ────────────────────────────────────────────

const fakeWeatherEvents = [
  {
    event_id: "weather-1",
    event_type: "nsw_weather",
    time_object: { timestamp: "2021-04-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Sydney CBD",
      lga: "Sydney",
      avg_temp: 16.9,
      avg_rainfall: 16.5,
      month: "2021-04",
    },
  },
  {
    event_id: "weather-2",
    event_type: "nsw_weather",
    time_object: { timestamp: "2021-05-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Sydney CBD",
      lga: "Sydney",
      avg_temp: 14.6,
      avg_rainfall: 88.3,
      month: "2021-05",
    },
  },
  {
    event_id: "weather-3",
    event_type: "nsw_weather",
    time_object: { timestamp: "2021-04-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      suburb: "Parramatta",
      lga: "Parramatta",
      avg_temp: 17.2,
      avg_rainfall: 22.1,
      month: "2021-04",
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(events = fakeWeatherEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events, total: events.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["nsw_weather"]),
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
  it('maps "nsw_weather" to "nsw_weather"', () => {
    expect(DATASET_TYPE_MAP["nsw_weather"]).toBe("nsw_weather");
  });
});

describe("resolveEventType", () => {
  it('resolves "nsw_weather" to "nsw_weather"', () => {
    expect(resolveEventType("nsw_weather")).toBe("nsw_weather");
  });
});

// ── 2. Dimension / metric allowlists ──────────────────────────────────────────

describe("NSW_WEATHER_DIMENSIONS", () => {
  it("contains suburb, lga, month", () => {
    expect(NSW_WEATHER_DIMENSIONS).toContain("suburb");
    expect(NSW_WEATHER_DIMENSIONS).toContain("lga");
    expect(NSW_WEATHER_DIMENSIONS).toContain("month");
  });

  it.each([...NSW_WEATHER_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("NSW_WEATHER_METRICS", () => {
  it("contains avg_temp and avg_rainfall", () => {
    expect(NSW_WEATHER_METRICS).toContain("avg_temp");
    expect(NSW_WEATHER_METRICS).toContain("avg_rainfall");
  });

  it.each([...NSW_WEATHER_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents application service ─────────────────────────────────────────

describe("getEvents with nsw_weather dataset_type", () => {
  it("passes dataset_type:nsw_weather to dataLakeReader.queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents({ dataset_type: "nsw_weather", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_weather" }),
    );
  });

  it("returns events and total from the reader", async () => {
    const reader = makeMockReader();
    const result = await getEvents({ dataset_type: "nsw_weather", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("forwards suburb filter to queryEvents", async () => {
    const reader = makeMockReader();
    await getEvents(
      { dataset_type: "nsw_weather", suburb: "Sydney CBD", limit: 10, offset: 0 },
      { dataLakeReader: reader },
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Sydney CBD" }),
    );
  });
});

// ── 4. HTTP layer ─────────────────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=nsw_weather", () => {
  it("returns 200 with nsw_weather events", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_weather&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    expect(res.body.events[0].event_type).toBe("nsw_weather");
  });

  it("calls queryEvents with dataset_type=nsw_weather", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=nsw_weather").expect(200);
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "nsw_weather" }),
    );
  });

  it("forwards suburb query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=nsw_weather&suburb=Sydney+CBD")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ suburb: "Sydney CBD" }),
    );
  });

  it("returns 200 with empty result for unknown suburb", async () => {
    const reader = makeMockReader([]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=nsw_weather&suburb=NoSuchSuburb")
      .expect(200);

    expect(res.body.events).toHaveLength(0);
  });
});

// ── 5. Visualisation: breakdown ───────────────────────────────────────────────

describe("GET /api/v1/visualisation/breakdown for nsw_weather", () => {
  it("returns 200 for breakdown by suburb + avg_temp", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Sydney CBD", value: 15.75, count: 2 },
      { group_key: "Parramatta", value: 17.2, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_weather&dimension=suburb&metric=avg_temp&aggregation=avg&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("avg_temp");
  });

  it("returns 200 for breakdown by lga + avg_rainfall", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([
      { group_key: "Sydney", value: 52.4, count: 2 },
      { group_key: "Parramatta", value: 22.1, count: 1 },
    ]);
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_weather&dimension=lga&metric=avg_rainfall&aggregation=avg&limit=10")
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.dimension).toBe("lga");
    expect(res.body.metric).toBe("avg_rainfall");
  });

  it("calls aggregateByDimension with correct args", async () => {
    const reader = makeMockReader();
    reader.aggregateByDimension = jest.fn().mockResolvedValue([]);
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_weather&dimension=suburb&metric=avg_temp&aggregation=avg")
      .expect(200);

    expect(reader.aggregateByDimension).toHaveBeenCalledWith(
      "nsw_weather", "suburb", "avg_temp", "avg", expect.any(Number), undefined,
    );
  });

  it("returns 400 for invalid dimension", async () => {
    const { app } = buildApp();
    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_weather&dimension=bad_dim&metric=avg_temp&aggregation=avg")
      .expect(400);
  });

  it("returns 400 for invalid metric", async () => {
    const { app } = buildApp();
    await request(app)
      .get("/api/v1/visualisation/breakdown?dataset_type=nsw_weather&dimension=suburb&metric=bad_metric&aggregation=avg")
      .expect(400);
  });
});
