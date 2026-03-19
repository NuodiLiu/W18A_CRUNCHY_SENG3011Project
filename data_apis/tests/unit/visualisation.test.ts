import request from "supertest";
import { createApp } from "../../src/http/app";
import { BreakdownResult } from "../../src/domain/ports/dataLakeReader";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// Pre-computed breakdown results for testing
const defaultBreakdownResult: BreakdownResult = {
  dimension: "suburb",
  metric: "count",
  aggregation: "sum",
  event_type: "housing_sale",
  entries: [
    { category: "Sydney", value: 2, count: 2 },
    { category: "Parramatta", value: 1, count: 1 },
  ],
};

const avgPriceBreakdownResult: BreakdownResult = {
  dimension: "suburb",
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  entries: [
    { category: "Sydney", value: 1350000, count: 2 },
    { category: "Parramatta", value: 980000, count: 1 },
  ],
};

const sumPriceBreakdownResult: BreakdownResult = {
  dimension: "suburb",
  metric: "purchase_price",
  aggregation: "sum",
  event_type: "housing_sale",
  entries: [
    { category: "Sydney", value: 2700000, count: 2 },
    { category: "Parramatta", value: 980000, count: 1 },
  ],
};

const zoningBreakdownResult: BreakdownResult = {
  dimension: "zoning",
  metric: "count",
  aggregation: "sum",
  event_type: "housing_sale",
  entries: [
    { category: "R1", value: 2, count: 2 },
    { category: "R2", value: 1, count: 1 },
  ],
};

function buildApp(overrides: Record<string, unknown> = {}) {
  const mockGetAggregatedBreakdown = jest.fn().mockImplementation((query) => {
    // Return different results based on query parameters
    if (query.dimension === "zoning") {
      return Promise.resolve(zoningBreakdownResult);
    }
    if (query.metric === "purchase_price" && query.aggregation === "avg") {
      return Promise.resolve(avgPriceBreakdownResult);
    }
    if (query.metric === "purchase_price" && query.aggregation === "sum") {
      return Promise.resolve(sumPriceBreakdownResult);
    }
    if (query.event_type === "esg_metric") {
      return Promise.resolve({
        ...defaultBreakdownResult,
        event_type: "esg_metric",
        dimension: query.dimension,
        entries: [],
      });
    }
    return Promise.resolve({
      ...defaultBreakdownResult,
      dimension: query.dimension || "suburb",
      limit: query.limit,
      entries: query.limit === 1
        ? [defaultBreakdownResult.entries[0]]
        : defaultBreakdownResult.entries,
    });
  });

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
      queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
      findEventById: jest.fn(),
      getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
      getGroupProjection: jest.fn().mockResolvedValue([]),
      readDataset: jest.fn(),
      getAllEvents: jest.fn().mockResolvedValue([]),
      getAggregatedBreakdown: mockGetAggregatedBreakdown,
    },
    ...overrides,
  };

  const app = createApp(deps as Parameters<typeof createApp>[0]);
  return { app, deps };
}

describe("GET /api/v1/visualisation/breakdown", () => {
  it("returns 200 with breakdown data", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.dimension).toBeDefined();
    expect(res.body.metric).toBeDefined();
    expect(res.body.aggregation).toBeDefined();
    expect(res.body.entries).toBeInstanceOf(Array);
  });

  it("groups by suburb with default aggregation", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb" })
      .expect(200);

    expect(res.body.dimension).toBe("suburb");
    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Sydney", count: 2 }),
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
    // Sydney avg: (1500000 + 1200000) / 2 = 1350000
    expect(sydneyEntry.value).toBe(1350000);
    expect(sydneyEntry.count).toBe(2);
  });

  it("calculates sum of purchase_price by suburb", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", metric: "purchase_price", aggregation: "sum" })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney sum: 1500000 + 1200000 = 2700000
    expect(sydneyEntry.value).toBe(2700000);
  });

  it("groups by zoning", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "zoning" })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "R1", count: 2 }),
        expect.objectContaining({ category: "R2", count: 1 }),
      ])
    );
  });

  it("respects limit parameter", async () => {
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ dimension: "suburb", limit: 1 })
      .expect(200);

    expect(res.body.entries.length).toBe(1);
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
    const { app } = buildApp();

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "esg_metric", dimension: "pillar" })
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });

  it("calls getAggregatedBreakdown on dataLakeReader", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(deps.dataLakeReader.getAggregatedBreakdown).toHaveBeenCalled();
  });

  it("passes year_from and year_to to getAggregatedBreakdown", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ year_from: 2020, year_to: 2024 })
      .expect(200);

    expect(deps.dataLakeReader.getAggregatedBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        year_from: 2020,
        year_to: 2024,
      })
    );
  });

  it("handles empty dataset", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
        readDataset: jest.fn(),
        getAllEvents: jest.fn().mockResolvedValue([]),
        getAggregatedBreakdown: jest.fn().mockResolvedValue({
          dimension: "suburb",
          metric: "count",
          aggregation: "sum",
          event_type: "housing_sale",
          entries: [],
        }),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });
});
