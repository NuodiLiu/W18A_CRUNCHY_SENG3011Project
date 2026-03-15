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
];

function buildApp(overrides: Record<string, unknown> = {}) {
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
      queryEvents: jest.fn().mockResolvedValue({ events: fakeHousingEvents, total: fakeHousingEvents.length }),
      findEventById: jest.fn(),
      getDistinctEventTypes: jest.fn().mockResolvedValue(["housing_sale"]),
      getGroupProjection: jest.fn().mockResolvedValue([]),
      getAllEvents: jest.fn().mockResolvedValue(fakeHousingEvents),
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

  it("calls getAllEvents on dataLakeReader", async () => {
    const { app, deps } = buildApp();

    await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(deps.dataLakeReader.getAllEvents).toHaveBeenCalled();
  });

  it("handles empty dataset", async () => {
    const { app } = buildApp({
      dataLakeReader: {
        queryEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
        findEventById: jest.fn(),
        getDistinctEventTypes: jest.fn().mockResolvedValue([]),
        getGroupProjection: jest.fn().mockResolvedValue([]),
        getAllEvents: jest.fn().mockResolvedValue([]),
      },
    });

    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });
});
