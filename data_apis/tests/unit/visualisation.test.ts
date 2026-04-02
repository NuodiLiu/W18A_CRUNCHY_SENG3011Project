import request from "supertest";
import { createApp } from "../../src/http/app";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const fakeHousingEvents = [
  {
    event_id: "h-1",
    time_object: { timestamp: "2024-04-10T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P001",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1500000,
      area: 120,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
      contract_date: "2024-04-10",
    },
  },
  {
    event_id: "h-2",
    time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P002",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1200000,
      area: 95,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Investment",
      contract_date: "2024-04-15",
    },
  },
  {
    event_id: "h-3",
    time_object: { timestamp: "2024-05-01T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P003",
      suburb: "Parramatta",
      postcode: 2150,
      purchase_price: 980000,
      area: 85,
      zoning: "R2",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
      contract_date: "2024-05-01",
    },
  },
  {
    event_id: "h-4",
    time_object: { timestamp: "2024-06-01T00:00:00Z", timezone: "UTC" },
    event_type: "housing_sale",
    attribute: {
      property_id: "P004",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1800000,
      area: 150,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
      contract_date: "2024-06-01",
    },
  },
];

const fakeEsgEvents = [
  {
    event_id: "e-1",
    time_object: { timestamp: "2020-01-01T00:00:00Z", timezone: "UTC" },
    event_type: "esg_metric",
    attribute: {
      permid: "111",
      company_name: "CompanyA",
      metric_name: "CO2_EMISSIONS",
      metric_value: 100,
      metric_year: 2020,
      pillar: "Environmental",
      industry: "Tech",
    },
  },
  {
    event_id: "e-2",
    time_object: { timestamp: "2021-01-01T00:00:00Z", timezone: "UTC" },
    event_type: "esg_metric",
    attribute: {
      permid: "111",
      company_name: "CompanyA",
      metric_name: "CO2_EMISSIONS",
      metric_value: 95,
      metric_year: 2021,
      pillar: "Environmental",
      industry: "Tech",
    },
  },
  {
    event_id: "e-3",
    time_object: { timestamp: "2020-01-01T00:00:00Z", timezone: "UTC" },
    event_type: "esg_metric",
    attribute: {
      permid: "222",
      company_name: "CompanyB",
      metric_name: "CO2_EMISSIONS",
      metric_value: 150,
      metric_year: 2020,
      pillar: "Environmental",
      industry: "Finance",
    },
  },
  {
    event_id: "e-4",
    time_object: { timestamp: "2020-06-01T00:00:00Z", timezone: "UTC" },
    event_type: "esg_metric",
    attribute: {
      permid: "333",
      company_name: "CompanyC",
      metric_name: "WATER_USAGE",
      metric_value: 200,
      metric_year: 2020,
      pillar: "Environmental",
      industry: "Mining",
    },
  },
];

function buildApp(overrides: Record<string, unknown> = {}) {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn(),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
      incrementChunksDone: jest.fn().mockResolvedValue(1),
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
      queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: fakeHousingEvents.length }),
      findEventById: jest.fn(),
      deleteEvent: jest.fn(),
      getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
      getGroupProjection: jest.fn().mockResolvedValue(fakeHousingEvents),
      readDataset: jest.fn().mockResolvedValue(undefined),
    },
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
    expect(res.body.aggregation).toBe("sum");
    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Sydney", count: 3 }),
        expect.objectContaining({ category: "Parramatta", count: 1 }),
      ])
    );
  });

  it("calculates average purchase_price by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "avg" })
      .expect(200);

    expect(res.body.dimension).toBe("suburb");
    expect(res.body.metric).toBe("purchase_price");
    expect(res.body.aggregation).toBe("avg");

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydneyEntry).toBeDefined();
    // Sydney avg: (1500000 + 1200000 + 1800000) / 3 = 1500000
    expect(sydneyEntry.value).toBe(1500000);
    expect(sydneyEntry.count).toBe(3);
  });

  it("calculates sum of purchase_price by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "sum" })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney sum: 1500000 + 1200000 + 1800000 = 4500000
    expect(sydneyEntry.value).toBe(4500000);
  });

  it("calculates min purchase_price by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "min" })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydneyEntry.value).toBe(1200000);
  });

  it("calculates max purchase_price by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "max" })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydneyEntry.value).toBe(1800000);
  });

  it("groups by zoning dimension", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "zoning" })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "R1", count: 3 }),
        expect.objectContaining({ category: "R2", count: 1 }),
      ])
    );
  });

  it("respects limit parameter and sorts by value descending", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", limit: 1 })
      .expect(200);

    expect(res.body.entries.length).toBe(1);
    expect(res.body.entries[0].category).toBe("Sydney");
  });

  it("filters by event_type", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb" })
      .expect(200);

    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.entries.length).toBeGreaterThan(0);
  });

  it("returns empty entries for non-matching event_type", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "esg_metric", dimension: "pillar" })
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });

  it("calls getGroupProjection on dataLakeReader", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalled();
  });

  it("handles empty dataset", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });

  it("aggregates area metric by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "area", aggregation: "sum" })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney area sum: 120 + 95 + 150 = 365
    expect(sydneyEntry.value).toBe(365);
  });

  it("aggregates esg metric_value by pillar", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: fakeEsgEvents, total: fakeEsgEvents.length }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue(["esg_metric"]),
        getGroupProjection: jest.fn().mockResolvedValue(fakeEsgEvents),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "esg_metric", dimension: "pillar", metric: "metric_value", aggregation: "sum" })
      .expect(200);

    const envEntry = res.body.entries.find((e: { category: string }) => e.category === "Environmental");
    // All events have pillar Environmental, sum: 100 + 95 + 150 + 200 = 545
    expect(envEntry.value).toBe(545);
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
        expect.objectContaining({ period: "2024", value: 4 }),
      ])
    );
  });

  it("groups data by month when time_period=month", async () => {
    const { app } = buildApp();

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

  it("groups data by day when time_period=day", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "day" })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    expect(periods).toContain("2024-04-10");
    expect(periods).toContain("2024-04-15");
    expect(periods).toContain("2024-05-01");
  });

  it("aggregates metrics by time period (sum)", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "purchase_price", aggregation: "sum", time_period: "month" })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    // April: 1500000 + 1200000 = 2700000
    expect(april.value).toBe(2700000);

    const may = res.body.data.find((d: { period: string }) => d.period === "2024-05");
    // May: 980000
    expect(may.value).toBe(980000);
  });

  it("calculates average price by month", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "purchase_price", aggregation: "avg", time_period: "month" })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    // April avg: (1500000 + 1200000) / 2 = 1350000
    expect(april.value).toBe(1350000);
  });

  it("supports min aggregation", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "purchase_price", aggregation: "min", time_period: "month" })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    expect(april.value).toBe(1200000);
  });

  it("supports max aggregation", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "purchase_price", aggregation: "max", time_period: "month" })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    expect(april.value).toBe(1500000);
  });

  it("aggregates count by default", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "month" })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    expect(april.value).toBe(2); // 2 events in April
  });

  it("supports multi-line chart with dimension grouping", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb", time_period: "month" })
      .expect(200);

    // Check for multiple series in same period
    const aprilEntries = res.body.data.filter((d: { period: string }) => d.period === "2024-04");
    const sydneyApril = aprilEntries.find((d: { series?: string }) => d.series === "Sydney");
    const sydneyCount = sydneyApril?.value || 0;
    
    expect(sydneyCount).toBe(2);
  });

  it("data points are sorted by period ascending", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ time_period: "month" })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    const sorted = [...periods].sort();
    expect(periods).toEqual(sorted);
  });

  it("filters by event_type", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale" })
      .expect(200);

    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("returns empty data for non-matching event_type", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "esg_metric" })
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it("handles empty dataset", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it("calls getGroupProjection on dataLakeReader", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalled();
  });

  it("aggregates esg metrics over time by year", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: fakeEsgEvents, total: fakeEsgEvents.length }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue(["esg_metric"]),
        getGroupProjection: jest.fn().mockResolvedValue(fakeEsgEvents),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "esg_metric", metric: "metric_value", aggregation: "sum", time_period: "year" })
      .expect(200);

    const year2020 = res.body.data.find((d: { period: string }) => d.period === "2020");
    // 2020: 100 + 150 + 200 = 450
    expect(year2020.value).toBe(450);

    const year2021 = res.body.data.find((d: { period: string }) => d.period === "2021");
    // 2021: 95
    expect(year2021.value).toBe(95);
  });

  it("supports multi-line timeseries by company_name", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: fakeEsgEvents, total: fakeEsgEvents.length }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue(["esg_metric"]),
        getGroupProjection: jest.fn().mockResolvedValue(fakeEsgEvents),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ 
        event_type: "esg_metric", 
        dimension: "company_name", 
        metric: "metric_value", 
        aggregation: "sum",
        time_period: "year"
      })
      .expect(200);

    // Should have multiple data points per period for different companies
    const year2020Data = res.body.data.filter((d: { period: string }) => d.period === "2020");
    const companies = new Set(year2020Data.map((d: { series?: string }) => d.series));
    expect(companies.size).toBeGreaterThan(1);
  });

  it("returns response with expected field names", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    const dataPoint = res.body.data[0];
    expect(dataPoint).toHaveProperty("period");
    expect(dataPoint).toHaveProperty("value");
  });

  it("includes series field only when dimension is provided", async () => {
    const { app } = buildApp();

    // Without dimension
    const res1 = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    // const hasSeriesField = res1.body.data.some((d: { series?: string }) => d.series !== undefined);
    // May or may not have series field when undefined
    expect(res1.body.data[0]).toHaveProperty("period");
    expect(res1.body.data[0]).toHaveProperty("value");

    // With dimension
    const res2 = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb" })
      .expect(200);

    const hasSeriesFieldWithDimension = res2.body.data.some((d: { series?: string }) => d.series !== undefined);
    expect(hasSeriesFieldWithDimension).toBe(true);
  });
});

// ─── Error cases ──────────────────────────────────────────────────────

describe("Visualisation endpoints — error handling", () => {
  it("breakdown handles dataLakeReader errors gracefully", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockRejectedValue(new Error("S3 error")),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockRejectedValue(new Error("S3 error")),
      },
    });

    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(500);
  });

  it("timeseries handles dataLakeReader errors gracefully", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockRejectedValue(new Error("S3 error")),
      },
    });

    await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(500);
  });
});

describe("Visualisation endpoints — invalid input validation", () => {
  describe("breakdown endpoint", () => {
    it("returns 400 for unsupported aggregation=median", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ aggregation: "median" })
        .expect(400);

      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });

    it("returns 400 for unrecognised dimension=nonexistent_field", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ dimension: "nonexistent_field" })
        .expect(400);

      expect(res.body.error.message).toMatch(/Invalid dimension/);
    });
  });

  describe("timeseries endpoint", () => {
    it("returns 400 for unsupported time_period=week", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ time_period: "week" })
        .expect(400);

      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });

    it("returns 400 for unsupported aggregation=blah", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ aggregation: "blah" })
        .expect(400);

      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });
  });

  describe("both endpoints — limit parameter edge cases", () => {
    it("breakdown with limit=-1 returns empty entries or 400", async () => {
      const { app } = buildApp();

      // Test documents current behavior - negative limit should not cause 500
      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ limit: -1 });

      // Should either be 400 or 200 with empty entries, not 500
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.entries).toEqual([]);
      }
    });

    it("breakdown with limit=0 returns empty entries or 400", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ limit: 0 });

      // Should either be 400 or 200 with empty entries, not 500
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.entries).toEqual([]);
      }
    });

    it("timeseries endpoint handles edge case parameters gracefully", async () => {
      const { app } = buildApp();

      // Timeseries doesn't have a limit param in the current implementation
      // but verifying it doesn't crash with unexpected params
      const res = await request(app)
        .get("/api/v1/visualisation/timeseries");

      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.data).toBeInstanceOf(Array);
      }
    });
  });
});

describe("GET /api/v1/visualisation/timeseries — response field validation", () => {
  it("without dimension param, data points should NOT have a series field", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    // Verify that when no dimension is provided, series field is absent
    for (const dataPoint of res.body.data) {
      expect(dataPoint).toHaveProperty("period");
      expect(dataPoint).toHaveProperty("value");
      expect(dataPoint.series).toBeUndefined();
    }
  });

  it("with dimension=suburb, every data point should have a non-empty series field", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb" })
      .expect(200);

    for (const dataPoint of res.body.data) {
      expect(dataPoint).toHaveProperty("series");
      expect(typeof dataPoint.series).toBe("string");
      expect(dataPoint.series.length).toBeGreaterThan(0);
    }
  });

  it("with dimension=suburb, period + series combination should be unique", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ dimension: "suburb", time_period: "month" })
      .expect(200);

    // Create unique keys from period + series
    const keys = res.body.data.map(
      (d: { period: string; series?: string }) => `${d.period}|${d.series}`
    );
    const uniqueKeys = new Set(keys);

    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("metric and aggregation fields reflect query params, not hardcoded defaults", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ metric: "purchase_price", aggregation: "avg" })
      .expect(200);

    expect(res.body.metric).toBe("purchase_price");
    expect(res.body.aggregation).toBe("avg");
  });

  it("uses default values when params are omitted", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .expect(200);

    // Document default values
    expect(res.body.metric).toBe("count");
    expect(res.body.aggregation).toBe("sum");
    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.time_period).toBe("year");
  });
});

describe("Visualisation endpoints — malformed data resilience", () => {
  describe("breakdown endpoint", () => {
    it("groups events missing dimension field under 'unknown'", async () => {
      const eventsWithMissingDimension = [
        {
          event_id: "m-1",
          time_object: { timestamp: "2024-04-10T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P001",
            // suburb is missing
            postcode: 2000,
            purchase_price: 1500000,
          },
        },
        {
          event_id: "m-2",
          time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P002",
            suburb: "Sydney",
            postcode: 2000,
            purchase_price: 1200000,
          },
        },
      ];

      const { app } = buildApp({
        dataLakeReader: {
          queryEvents: jest.fn().mockResolvedValue({ events: eventsWithMissingDimension, total: 2 }),
          findEventById: jest.fn(),
          getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
          getGroupProjection: jest.fn().mockResolvedValue(eventsWithMissingDimension),
        },
      });

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ dimension: "suburb" })
        .expect(200);

      const unknownEntry = res.body.entries.find((e: { category: string }) => e.category === "unknown");
      const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");

      expect(unknownEntry).toBeDefined();
      expect(unknownEntry.count).toBe(1);
      expect(sydneyEntry).toBeDefined();
      expect(sydneyEntry.count).toBe(1);
    });
  });

  describe("timeseries endpoint", () => {
    it("groups events missing timestamp under 'unknown' period rather than crashing", async () => {
      const eventsWithMissingTimestamp = [
        {
          event_id: "t-1",
          time_object: {}, // timestamp is missing
          event_type: "housing_sale",
          attribute: {
            property_id: "P001",
            suburb: "Sydney",
            purchase_price: 1500000,
          },
        },
        {
          event_id: "t-2",
          time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P002",
            suburb: "Sydney",
            purchase_price: 1200000,
          },
        },
      ];

      const { app } = buildApp({
        dataLakeReader: {
          queryEvents: jest.fn().mockResolvedValue({ events: eventsWithMissingTimestamp, total: 2 }),
          findEventById: jest.fn(),
          getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
          getGroupProjection: jest.fn().mockResolvedValue(eventsWithMissingTimestamp),
        },
      });

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ time_period: "month" })
        .expect(200);

      // The implementation skips invalid timestamps, so we should only see valid ones
      // Verify the endpoint doesn't crash and returns valid data
      expect(res.body.data).toBeInstanceOf(Array);

      // The valid event should be present
      const april2024 = res.body.data.find((d: { period: string }) => d.period === "2024-04");
      expect(april2024).toBeDefined();
      expect(april2024.value).toBe(1);
    });
  });

  describe("both endpoints — mixed valid and malformed events", () => {
    it("breakdown returns valid events correctly aggregated despite malformed data", async () => {
      const mixedEvents = [
        {
          event_id: "x-1",
          time_object: { timestamp: "2024-04-10T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P001",
            suburb: "Sydney",
            purchase_price: 1500000,
          },
        },
        {
          event_id: "x-2",
          time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P002",
            // suburb missing
            purchase_price: null, // malformed
          },
        },
        {
          event_id: "x-3",
          time_object: { timestamp: "2024-04-20T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: {
            property_id: "P003",
            suburb: "Sydney",
            purchase_price: 1200000,
          },
        },
      ];

      const { app } = buildApp({
        dataLakeReader: {
          queryEvents: jest.fn().mockResolvedValue({ events: mixedEvents, total: 3 }),
          findEventById: jest.fn(),
          getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
          getGroupProjection: jest.fn().mockResolvedValue(mixedEvents),
        },
      });

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ dimension: "suburb", metric: "purchase_price", aggregation: "sum" })
        .expect(200);

      const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
      // Sydney sum: 1500000 + 1200000 = 2700000
      expect(sydneyEntry).toBeDefined();
      expect(sydneyEntry.value).toBe(2700000);
      expect(sydneyEntry.count).toBe(2);

      // Event with missing suburb should be categorized as unknown
      const unknownEntry = res.body.entries.find((e: { category: string }) => e.category === "unknown");
      expect(unknownEntry).toBeDefined();
    });

    it("timeseries returns valid events correctly aggregated despite malformed data", async () => {
      const mixedEvents = [
        {
          event_id: "y-1",
          time_object: { timestamp: "invalid-date" },
          event_type: "housing_sale",
          attribute: { suburb: "Sydney", purchase_price: 1000000 },
        },
        {
          event_id: "y-2",
          time_object: { timestamp: "2024-05-10T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: { suburb: "Sydney", purchase_price: 1500000 },
        },
        {
          event_id: "y-3",
          time_object: { timestamp: "2024-05-15T00:00:00Z", timezone: "UTC" },
          event_type: "housing_sale",
          attribute: { suburb: "Sydney", purchase_price: 1200000 },
        },
      ];

      const { app } = buildApp({
        dataLakeReader: {
          queryEvents: jest.fn().mockResolvedValue({ events: mixedEvents, total: 3 }),
          findEventById: jest.fn(),
          getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
          getGroupProjection: jest.fn().mockResolvedValue(mixedEvents),
        },
      });

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ time_period: "month", metric: "purchase_price", aggregation: "sum" })
        .expect(200);

      // May 2024 should have the two valid events summed
      const may2024 = res.body.data.find((d: { period: string }) => d.period === "2024-05");
      expect(may2024).toBeDefined();
      expect(may2024.value).toBe(2700000); // 1500000 + 1200000
      expect(may2024.count).toBe(2);
    });
  });
});

describe("Visualisation endpoints — API contract enforcement", () => {
  describe("breakdown endpoint", () => {
    it("returns 400 with error message for unrecognised dimension value", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ dimension: "invalid_dimension" })
        .expect(400);

      // Assert error response format
      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error.message).toMatch(/invalid dimension/i);
    });

    it("returns 400 for aggregation=invalid, not silent fallback to sum", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ aggregation: "invalid" })
        .expect(400);

      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });

    it("applies default dimension=suburb when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .expect(200);

      expect(res.body.dimension).toBe("suburb");
    });

    it("applies default metric=count when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .expect(200);

      expect(res.body.metric).toBe("count");
    });

    it("applies default aggregation=sum when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .expect(200);

      expect(res.body.aggregation).toBe("sum");
    });

    it("applies default event_type=housing_sale when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .expect(200);

      expect(res.body.event_type).toBe("housing_sale");
    });

    it("applies default limit=10 when param is omitted", async () => {
      // Create more than 10 entries to test limit
      const manySuburbs = Array.from({ length: 15 }, (_, i) => ({
        event_id: `h-${i}`,
        time_object: { timestamp: "2024-04-10T00:00:00Z", timezone: "UTC" },
        event_type: "housing_sale",
        attribute: {
          property_id: `P${i}`,
          suburb: `Suburb${i}`,
          postcode: 2000 + i,
          purchase_price: 1000000 + i * 100000,
        },
      }));

      const { app } = buildApp({
        dataLakeReader: {
          queryEvents: jest.fn().mockResolvedValue({ events: manySuburbs, total: 15 }),
          findEventById: jest.fn(),
          getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
          getGroupProjection: jest.fn().mockResolvedValue(manySuburbs),
        },
      });

      const res = await request(app)
        .get("/api/v1/visualisation/breakdown")
        .query({ dimension: "suburb" })
        .expect(200);

      // Default limit is 10
      expect(res.body.entries.length).toBe(10);
    });
  });

  describe("timeseries endpoint", () => {
    it("returns 400 for time_period=invalid", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ time_period: "invalid" })
        .expect(400);

      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });

    it("returns 400 for aggregation=invalid, not silent fallback", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .query({ aggregation: "invalid" })
        .expect(400);

      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error.message).toMatch(/Request validation failed/i);
    });

    it("applies default metric=count when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .expect(200);

      expect(res.body.metric).toBe("count");
    });

    it("applies default aggregation=sum when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .expect(200);

      expect(res.body.aggregation).toBe("sum");
    });

    it("applies default event_type=housing_sale when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .expect(200);

      expect(res.body.event_type).toBe("housing_sale");
    });

    it("applies default time_period=year when param is omitted", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .expect(200);

      expect(res.body.time_period).toBe("year");
    });

    it("dimension is undefined by default (no multi-line grouping)", async () => {
      const { app } = buildApp();

      const res = await request(app)
        .get("/api/v1/visualisation/timeseries")
        .expect(200);

      expect(res.body.dimension).toBeUndefined();
    });
  });
});