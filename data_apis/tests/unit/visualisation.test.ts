import request from "supertest";
import { createApp } from "../../src/http/app";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const fakeHousingEvents = [
  {
    event_id: "h-1",
    time_object: { timestamp: "2024-04-10T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: { suburb: "Sydney", postcode: 2000, purchase_price: 1500000, area: 120, zoning: "R1", nature_of_property: "Residential", primary_purpose: "Dwelling", contract_date: "2024-04-10" },
  },
  {
    event_id: "h-2",
    time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: { suburb: "Sydney", postcode: 2000, purchase_price: 1200000, area: 95, zoning: "R1", nature_of_property: "Residential", primary_purpose: "Dwelling", contract_date: "2024-04-15" },
  },
  {
    event_id: "h-3",
    time_object: { timestamp: "2024-05-01T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: { suburb: "Parramatta", postcode: 2150, purchase_price: 980000, area: 80, zoning: "R2", nature_of_property: "Residential", primary_purpose: "Dwelling", contract_date: "2024-05-01" },
  },
  {
    event_id: "h-4",
    time_object: { timestamp: "2024-06-20T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: { suburb: "Sydney", postcode: 2000, purchase_price: 1800000, area: 150, zoning: "R1", nature_of_property: "Residential", primary_purpose: "Dwelling", contract_date: "2024-06-20" },
  },
];

// mock AggRow data matching the fake events above
const breakdownBySuburb = [
  { group_key: "Sydney", value: 1500000, count: 3 },
  { group_key: "Parramatta", value: 980000, count: 1 },
];

const timeseriesByYear = [
  { group_key: "2024", value: 1370000, count: 4 },
];

const timeseriesByMonth = [
  { group_key: "2024-04", value: 1350000, count: 2 },
  { group_key: "2024-05", value: 980000, count: 1 },
  { group_key: "2024-06", value: 1800000, count: 1 },
];

const timeseriesByDay = [
  { group_key: "2024-04-10", value: 1500000, count: 1 },
  { group_key: "2024-04-15", value: 1200000, count: 1 },
  { group_key: "2024-05-01", value: 980000, count: 1 },
  { group_key: "2024-06-20", value: 1800000, count: 1 },
];

const timeseriesWithDimension = [
  { group_key: "2024-04", series_key: "Sydney", value: 1350000, count: 2 },
  { group_key: "2024-05", series_key: "Parramatta", value: 980000, count: 1 },
  { group_key: "2024-06", series_key: "Sydney", value: 1800000, count: 1 },
];

function makeMockReader(overrides: Record<string, unknown> = {}) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: fakeHousingEvents.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
    getGroupProjection: jest.fn().mockResolvedValue(fakeHousingEvents),
    readDataset: jest.fn().mockResolvedValue(undefined),
    aggregateByDimension: jest.fn().mockResolvedValue(breakdownBySuburb),
    aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesByYear),
    ...overrides,
  };
}

function buildApp(overrides: Record<string, unknown> = {}) {
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
    dataLakeReader: makeMockReader(),
    ...overrides,
  };

  const app = createApp(deps as Parameters<typeof createApp>[0]);
  return { app, deps };
}

// ─── /api/v1/visualisation/breakdown ──────────────────────────────────

describe("GET /api/v1/visualisation/breakdown", () => {
  it("returns 200 with breakdown data structure", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.dimension).toBeDefined();
    expect(res.body.metric).toBeDefined();
    expect(res.body.aggregation).toBeDefined();
    expect(res.body.event_type).toBeDefined();
    expect(res.body.entries).toBeInstanceOf(Array);
  });

  it("groups by suburb with count aggregation by default", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb" })
      .expect(200);

    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("count");
    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Sydney", count: 3 }),
        expect.objectContaining({ category: "Parramatta", count: 1 }),
      ])
    );
  });

  it("calls aggregateByDimension with correct params", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb", metric: "purchase_price", aggregation: "avg", limit: 5 })
      .expect(200);

    expect(deps.dataLakeReader.aggregateByDimension).toHaveBeenCalledWith(
      "housing_sale", "suburb", "purchase_price", "avg", 5,
    );
  });

  it("returns metric value from SQL aggregation", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "avg" })
      .expect(200);

    const sydney = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydney.value).toBe(1500000);
    expect(sydney.count).toBe(3);
  });

  it("returns empty entries for empty result", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByDimension: jest.fn().mockResolvedValue([]) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });

  it("filters by event_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb" })
      .expect(200);

    expect(res.body.event_type).toBe("housing_sale");
  });
});

// ─── /api/v1/visualisation/timeseries ────────────────────────────────

describe("GET /api/v1/visualisation/timeseries", () => {
  it("returns 200 with time series data structure", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    expect(res.body.metric).toBeDefined();
    expect(res.body.aggregation).toBeDefined();
    expect(res.body.event_type).toBeDefined();
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it("returns data points grouped by year by default", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "year" })
      .expect(200);

    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: "2024", count: 4 }),
      ])
    );
  });

  it("groups data by month", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesByMonth) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "month" })
      .expect(200);

    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: "2024-04" }),
        expect.objectContaining({ period: "2024-05" }),
        expect.objectContaining({ period: "2024-06" }),
      ])
    );
  });

  it("groups data by day", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesByDay) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "day" })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    expect(periods).toContain("2024-04-10");
    expect(periods).toContain("2024-05-01");
  });

  it("calls aggregateByTimePeriod with correct params", async () => {
    const { app, deps } = buildApp();
    await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", metric: "purchase_price", aggregation: "avg", time_period: "month" })
      .expect(200);

    expect(deps.dataLakeReader.aggregateByTimePeriod).toHaveBeenCalledWith(
      "housing_sale", "month", "purchase_price", "avg", undefined,
    );
  });

  it("passes dimension field to aggregateByTimePeriod", async () => {
    const { app, deps } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesWithDimension) }),
    });
    await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb", time_period: "month" })
      .expect(200);

    expect(deps.dataLakeReader.aggregateByTimePeriod).toHaveBeenCalledWith(
      "housing_sale", "month", null, "sum", "suburb",
    );
  });

  it("includes series field when dimension is provided", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesWithDimension) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb", time_period: "month" })
      .expect(200);

    const hasSeries = res.body.data.some((d: { series?: string }) => d.series !== undefined);
    expect(hasSeries).toBe(true);
  });

  it("data points are sorted by period ascending", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue(timeseriesByMonth) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "month" })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    expect(periods).toEqual([...periods].sort());
  });

  it("returns empty data for empty result", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockResolvedValue([]) }),
    });
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it("filters by event_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale" })
      .expect(200);

    expect(res.body.event_type).toBe("housing_sale");
  });
});

// ─── Error cases ──────────────────────────────────────────────────────

describe("Visualisation endpoints — error handling", () => {
  it("breakdown handles errors gracefully", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByDimension: jest.fn().mockRejectedValue(new Error("DB error")) }),
    });
    await request(app).get("/api/v1/visualisation/breakdown").expect(500);
  });

  it("timeseries handles errors gracefully", async () => {
    const { app } = buildApp({
      dataLakeReader: makeMockReader({ aggregateByTimePeriod: jest.fn().mockRejectedValue(new Error("DB error")) }),
    });
    await request(app).get("/api/v1/visualisation/timeseries").expect(500);
  });
});

describe("Visualisation endpoints — invalid input validation", () => {
  it("breakdown returns 400 for unsupported aggregation", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ aggregation: "median" })
      .expect(400);
    expect(res.body.error.message).toMatch(/Request validation failed/i);
  });

  it("breakdown returns 400 for invalid dimension", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "nonexistent_field" })
      .expect(400);
    expect(res.body.error.message).toMatch(/Invalid dimension/);
  });

  it("timeseries returns 400 for unsupported time_period", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "week" })
      .expect(400);
    expect(res.body.error.message).toMatch(/Request validation failed/i);
  });

  it("timeseries returns 400 for unsupported aggregation", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ aggregation: "blah" })
      .expect(400);
    expect(res.body.error.message).toMatch(/Request validation failed/i);
  });
});
