import request from "supertest";
import { loadConfig } from "../../src/config/index";
import { createApp } from "../../src/http/app";
import { DynamoJobRepository } from "../../src/infra/aws/dynamoJobRepository";
import { S3ConfigStore } from "../../src/infra/aws/s3ConfigStore";
import { SQSQueueService } from "../../src/infra/aws/sqsQueueService";
import { S3PresignService } from "../../src/infra/aws/s3PresignService";
import { PostgresEventRepository } from "../../src/infra/postgres/postgresEventRepository";
import { EventRecord } from "../../src/domain/models/event";

const config = loadConfig();
const pgRepo = new PostgresEventRepository(config);
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);

const app = createApp({ jobRepo, configStore, queue, fileUploadService, dataLakeReader: pgRepo });

const HOUSING_DATASET_ID = "housing_vis_test";
const ESG_DATASET_ID = "esg_vis_test";

// Housing sale events spanning multiple months and suburbs
const housingEvents: EventRecord[] = [
  // April 2024 - Sydney
  {
    event_id: "h-1",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-04-05T00:00:00Z", timezone: "UTC" },
    attribute: {
      property_id: "PROP-001",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1500000,
      area: 120,
      zoning: "R1",
      contract_date: "2024-04-05",
    },
  },
  // April 2024 - Sydney
  {
    event_id: "h-2",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-04-15T00:00:00Z", timezone: "UTC" },
    attribute: {
      property_id: "PROP-002",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1200000,
      area: 95,
      zoning: "R1",
      contract_date: "2024-04-15",
    },
  },
  // May 2024 - Parramatta
  {
    event_id: "h-3",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-05-10T00:00:00Z", timezone: "UTC" },
    attribute: {
      property_id: "PROP-003",
      suburb: "Parramatta",
      postcode: 2150,
      purchase_price: 980000,
      area: 85,
      zoning: "R2",
      contract_date: "2024-05-10",
    },
  },
  // June 2024 - Sydney
  {
    event_id: "h-4",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-06-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      property_id: "PROP-004",
      suburb: "Sydney",
      postcode: 2000,
      purchase_price: 1800000,
      area: 150,
      zoning: "R1",
      contract_date: "2024-06-01",
    },
  },
  // June 2024 - Parramatta
  {
    event_id: "h-5",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-06-20T00:00:00Z", timezone: "UTC" },
    attribute: {
      property_id: "PROP-005",
      suburb: "Parramatta",
      postcode: 2150,
      purchase_price: 1100000,
      area: 110,
      zoning: "R2",
      contract_date: "2024-06-20",
    },
  },
];

// ESG events spanning multiple years and companies
const esgEvents: EventRecord[] = [
  // 2020 - CompanyA
  {
    event_id: "e-1",
    event_type: "esg_metric",
    time_object: { timestamp: "2020-01-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      permid: "111",
      company_name: "CompanyA",
      metric_name: "CO2_EMISSIONS",
      metric_value: 100,
      metric_year: 2020,
      pillar: "Environmental",
      industry: "Technology",
    },
  },
  // 2020 - CompanyB
  {
    event_id: "e-2",
    event_type: "esg_metric",
    time_object: { timestamp: "2020-06-01T00:00:00Z", timezone: "UTC" },
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
  // 2020 - CompanyC (Social pillar)
  {
    event_id: "e-3",
    event_type: "esg_metric",
    time_object: { timestamp: "2020-03-01T00:00:00Z", timezone: "UTC" },
    attribute: {
      permid: "333",
      company_name: "CompanyC",
      metric_name: "EMPLOYEE_DIVERSITY",
      metric_value: 75,
      metric_year: 2020,
      pillar: "Social",
      industry: "Mining",
    },
  },
  // 2021 - CompanyA
  {
    event_id: "e-4",
    event_type: "esg_metric",
    time_object: { timestamp: "2021-01-15T00:00:00Z", timezone: "UTC" },
    attribute: {
      permid: "111",
      company_name: "CompanyA",
      metric_name: "CO2_EMISSIONS",
      metric_value: 95,
      metric_year: 2021,
      pillar: "Environmental",
      industry: "Technology",
    },
  },
  // 2021 - CompanyB
  {
    event_id: "e-5",
    event_type: "esg_metric",
    time_object: { timestamp: "2021-06-20T00:00:00Z", timezone: "UTC" },
    attribute: {
      permid: "222",
      company_name: "CompanyB",
      metric_name: "CO2_EMISSIONS",
      metric_value: 140,
      metric_year: 2021,
      pillar: "Environmental",
      industry: "Finance",
    },
  },
  // 2022 - CompanyA
  {
    event_id: "e-6",
    event_type: "esg_metric",
    time_object: { timestamp: "2022-01-10T00:00:00Z", timezone: "UTC" },
    attribute: {
      permid: "111",
      company_name: "CompanyA",
      metric_name: "CO2_EMISSIONS",
      metric_value: 90,
      metric_year: 2022,
      pillar: "Environmental",
      industry: "Technology",
    },
  },
];

beforeAll(async () => {
  await pgRepo.writeEvents(housingEvents, HOUSING_DATASET_ID);
  await pgRepo.writeEvents(esgEvents, ESG_DATASET_ID);
});

afterAll(async () => {
  const ids = [
    ...housingEvents.map((e) => e.event_id),
    ...esgEvents.map((e) => e.event_id),
  ];
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.pgConnectionString });
  await pool.query("DELETE FROM events WHERE event_id = ANY($1::text[])", [ids]);
  await pool.end();
  await pgRepo.close();
});


describe("GET /api/v1/visualisation/breakdown — integration", () => {
  it("returns housing breakdown by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb" })
      .expect(200);

    expect(res.body.dimension).toBe("suburb");
    expect(res.body.event_type).toBe("housing_sale");
    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Sydney", count: 3 }),
        expect.objectContaining({ category: "Parramatta", count: 2 }),
      ])
    );
  });

  it("returns housing breakdown by zoning", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "zoning" })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "R1", count: 3 }),
        expect.objectContaining({ category: "R2", count: 2 }),
      ])
    );
  });

  it("calculates average purchase_price by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "avg",
      })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney avg: (1500000 + 1200000 + 1800000) / 3 = 1500000
    expect(sydneyEntry.value).toBe(1500000);

    const parramattaEntry = res.body.entries.find((e: { category: string }) => e.category === "Parramatta");
    // Parramatta avg: (980000 + 1100000) / 2 = 1040000
    expect(parramattaEntry.value).toBe(1040000);
  });

  it("calculates total purchase_price by suburb (sum)", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "sum",
      })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney sum: 1500000 + 1200000 + 1800000 = 4500000
    expect(sydneyEntry.value).toBe(4500000);
  });

  it("finds min and max purchase_price by suburb", async () => {
    const minRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "min",
      })
      .expect(200);

    const sydneyMin = minRes.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydneyMin.value).toBe(1200000);

    const maxRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "max",
      })
      .expect(200);

    const sydneyMax = maxRes.body.entries.find((e: { category: string }) => e.category === "Sydney");
    expect(sydneyMax.value).toBe(1800000);
  });

  it("calculates total area by suburb (sum)", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "area",
        aggregation: "sum",
      })
      .expect(200);

    const sydneyEntry = res.body.entries.find((e: { category: string }) => e.category === "Sydney");
    // Sydney area: 120 + 95 + 150 = 365
    expect(sydneyEntry.value).toBe(365);
  });

  it("breaks down esg metrics by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "esg_metric",
        dimension: "pillar",
      })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Environmental", count: 5 }),
        expect.objectContaining({ category: "Social", count: 1 }),
      ])
    );
  });

  it("aggregates esg metric_value by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "esg_metric",
        dimension: "pillar",
        metric: "metric_value",
        aggregation: "sum",
      })
      .expect(200);

    const envEntry = res.body.entries.find((e: { category: string }) => e.category === "Environmental");
    // Environmental sum: 100 + 150 + 95 + 140 + 90 = 575
    expect(envEntry.value).toBe(575);
  });

  it("breaks down esg metrics by company_name", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "esg_metric",
        dimension: "company_name",
      })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "CompanyA", count: 3 }),
        expect.objectContaining({ category: "CompanyB", count: 2 }),
        expect.objectContaining({ category: "CompanyC", count: 1 }),
      ])
    );
  });

  it("breaks down esg metrics by industry", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "esg_metric",
        dimension: "industry",
      })
      .expect(200);

    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Technology" }),
        expect.objectContaining({ category: "Finance" }),
        expect.objectContaining({ category: "Mining" }),
      ])
    );
  });

  it("respects limit parameter", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        limit: 1,
      })
      .expect(200);

    expect(res.body.entries.length).toBe(1);
    // Should be sorted by count descending, so Sydney first
    expect(res.body.entries[0].category).toBe("Sydney");
  });
});

describe("GET /api/v1/visualisation/timeseries — integration", () => {
  it("returns housing count by month", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        time_period: "month",
      })
      .expect(200);

    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: "2024-04", value: 2 }),
        expect.objectContaining({ period: "2024-05", value: 1 }),
        expect.objectContaining({ period: "2024-06", value: 2 }),
      ])
    );
  });

  it("returns housing count by year", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        time_period: "year",
      })
      .expect(200);

    const year2024 = res.body.data.find((d: { period: string }) => d.period === "2024");
    expect(year2024.value).toBe(5);
  });

  it("returns average purchase_price over time by month", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        metric: "purchase_price",
        aggregation: "avg",
        time_period: "month",
      })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    // April avg: (1500000 + 1200000) / 2 = 1350000
    expect(april.value).toBe(1350000);

    const june = res.body.data.find((d: { period: string }) => d.period === "2024-06");
    // June avg: (1800000 + 1100000) / 2 = 1450000
    expect(june.value).toBe(1450000);
  });

  it("returns total purchase_price over time by month (sum)", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        metric: "purchase_price",
        aggregation: "sum",
        time_period: "month",
      })
      .expect(200);

    const april = res.body.data.find((d: { period: string }) => d.period === "2024-04");
    // April sum: 1500000 + 1200000 = 2700000
    expect(april.value).toBe(2700000);

    const june = res.body.data.find((d: { period: string }) => d.period === "2024-06");
    // June sum: 1800000 + 1100000 = 2900000
    expect(june.value).toBe(2900000);
  });

  it("returns purchase_price min/max over time", async () => {
    const minRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        metric: "purchase_price",
        aggregation: "min",
        time_period: "month",
      })
      .expect(200);

    const aprilMin = minRes.body.data.find((d: { period: string }) => d.period === "2024-04");
    expect(aprilMin.value).toBe(1200000);

    const maxRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        metric: "purchase_price",
        aggregation: "max",
        time_period: "month",
      })
      .expect(200);

    const aprilMax = maxRes.body.data.find((d: { period: string }) => d.period === "2024-04");
    expect(aprilMax.value).toBe(1500000);
  });

  it("returns multi-line housing timeseries by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        time_period: "month",
      })
      .expect(200);

    // April should have both Sydney and Parramatta entries
    const aprilEntries = res.body.data.filter((d: { period: string }) => d.period === "2024-04");
    const aprilSydney = aprilEntries.find((d: { series?: string }) => d.series === "Sydney");
    expect(aprilSydney).toBeDefined();
    expect(aprilSydney.value).toBe(2);

    // May should only have Parramatta
    const mayEntries = res.body.data.filter((d: { period: string }) => d.period === "2024-05");
    const mayParramatta = mayEntries.find((d: { series?: string }) => d.series === "Parramatta");
    expect(mayParramatta).toBeDefined();
    expect(mayParramatta.value).toBe(1);
  });

  it("returns multi-line housing timeseries with average price by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "avg",
        time_period: "month",
      })
      .expect(200);

    const aprilEntries = res.body.data.filter((d: { period: string }) => d.period === "2024-04");
    const aprilSydney = aprilEntries.find((d: { series?: string }) => d.series === "Sydney");
    // April Sydney avg: (1500000 + 1200000) / 2 = 1350000
    expect(aprilSydney.value).toBe(1350000);
  });

  it("returns esg metrics over time by year", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        time_period: "year",
      })
      .expect(200);

    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: "2020", value: 3 }),
        expect.objectContaining({ period: "2021", value: 2 }),
        expect.objectContaining({ period: "2022", value: 1 }),
      ])
    );
  });

  it("returns esg metric_value over time by year", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        metric: "metric_value",
        aggregation: "sum",
        time_period: "year",
      })
      .expect(200);

    const year2020 = res.body.data.find((d: { period: string }) => d.period === "2020");
    // 2020 sum: 100 + 150 + 75 = 325
    expect(year2020.value).toBe(325);

    const year2021 = res.body.data.find((d: { period: string }) => d.period === "2021");
    // 2021 sum: 95 + 140 = 235
    expect(year2021.value).toBe(235);

    const year2022 = res.body.data.find((d: { period: string }) => d.period === "2022");
    // 2022 sum: 90
    expect(year2022.value).toBe(90);
  });

  it("returns average esg metric_value by year", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        metric: "metric_value",
        aggregation: "avg",
        time_period: "year",
      })
      .expect(200);

    const year2020 = res.body.data.find((d: { period: string }) => d.period === "2020");
    // 2020 avg: (100 + 150 + 75) / 3 = 108.33...
    expect(year2020.value).toBeCloseTo(108.33, 1);
  });

  it("returns multi-line esg timeseries by company_name", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        dimension: "company_name",
        time_period: "year",
      })
      .expect(200);

    // CompanyA should have 3 entries (2020, 2021, 2022)
    const companyAEntries = res.body.data.filter((d: { series?: string }) => d.series === "CompanyA");
    expect(companyAEntries.length).toBe(3);

    // CompanyB should have 2 entries (2020, 2021)
    const companyBEntries = res.body.data.filter((d: { series?: string }) => d.series === "CompanyB");
    expect(companyBEntries.length).toBe(2);

    // CompanyC should have 1 entry (2020)
    const companyCEntries = res.body.data.filter((d: { series?: string }) => d.series === "CompanyC");
    expect(companyCEntries.length).toBe(1);
  });

  it("returns multi-line esg timeseries with metric_value by company_name", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        dimension: "company_name",
        metric: "metric_value",
        aggregation: "sum",
        time_period: "year",
      })
      .expect(200);

    const companyA2020 = res.body.data.find(
      (d: { period: string; series?: string }) => d.period === "2020" && d.series === "CompanyA"
    );
    expect(companyA2020.value).toBe(100);

    const companyA2021 = res.body.data.find(
      (d: { period: string; series?: string }) => d.period === "2021" && d.series === "CompanyA"
    );
    expect(companyA2021.value).toBe(95);

    const companyA2022 = res.body.data.find(
      (d: { period: string; series?: string }) => d.period === "2022" && d.series === "CompanyA"
    );
    expect(companyA2022.value).toBe(90);
  });

  it("returns esg timeseries by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        dimension: "pillar",
        time_period: "year",
      })
      .expect(200);

    const env2020 = res.body.data.find(
      (d: { period: string; series?: string }) => d.period === "2020" && d.series === "Environmental"
    );
    expect(env2020.value).toBe(2);

    const social2020 = res.body.data.find(
      (d: { period: string; series?: string }) => d.period === "2020" && d.series === "Social"
    );
    expect(social2020.value).toBe(1);
  });

  it("data points are sorted by period ascending", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "esg_metric",
        time_period: "year",
      })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    const uniquePeriods = [...new Set(periods)];
    const sorted = [...uniquePeriods].sort();
    expect(uniquePeriods).toEqual(sorted);
  });

  it("returns day-level granularity", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        time_period: "day",
      })
      .expect(200);

    const periods = res.body.data.map((d: { period: string }) => d.period);
    // Should have specific dates
    expect(periods).toEqual(
      expect.arrayContaining([
        "2024-04-05",
        "2024-04-15",
        "2024-05-10",
        "2024-06-01",
        "2024-06-20",
      ])
    );
  });
});

describe("GET /api/v1/visualisation/timeseries — empty dataset", () => {
  const EMPTY_DATASET_ID = "empty_vis_test";

  beforeAll(async () => {
    // Seed an empty dataset (no events)
    await pgRepo.writeEvents([], EMPTY_DATASET_ID);
  });

  it("returns 200 with empty data array when no events exist for event_type", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "nonexistent_event_type" })
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.event_type).toBe("nonexistent_event_type");
  });
});

describe("LocalStack boundary conditions", () => {
  const LARGE_DATASET_ID = "large_vis_test";
  const SPECIAL_CHARS_DATASET_ID = "special_chars_vis_test";

  // Generate 100+ events for large dataset test
  const largeDataset: EventRecord[] = Array.from({ length: 120 }, (_, i) => ({
    event_id: `large-${i}`,
    event_type: "housing_sale",
    time_object: {
      timestamp: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      timezone: "UTC",
    },
    attribute: {
      property_id: `PROP-LARGE-${i}`,
      suburb: i % 3 === 0 ? "Sydney" : i % 3 === 1 ? "Parramatta" : "Chatswood",
      postcode: 2000 + (i % 10),
      purchase_price: 1000000 + i * 10000,
      area: 80 + (i % 50),
      zoning: i % 2 === 0 ? "R1" : "R2",
      contract_date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    },
  }));

  // Events with special characters in attribute values
  const specialCharsEvents: EventRecord[] = [
    {
      event_id: "special-1",
      event_type: "housing_sale",
      time_object: { timestamp: "2024-07-01T00:00:00Z", timezone: "UTC" },
      attribute: {
        property_id: "PROP-SPECIAL-1",
        suburb: "O'Connor",
        postcode: 2602,
        purchase_price: 850000,
        area: 95,
        zoning: "R1",
        contract_date: "2024-07-01",
      },
    },
    {
      event_id: "special-2",
      event_type: "housing_sale",
      time_object: { timestamp: "2024-07-02T00:00:00Z", timezone: "UTC" },
      attribute: {
        property_id: "PROP-SPECIAL-2",
        suburb: "Smith & Jones Bay",
        postcode: 2011,
        purchase_price: 2500000,
        area: 200,
        zoning: "R1",
        contract_date: "2024-07-02",
      },
    },
    {
      event_id: "special-3",
      event_type: "housing_sale",
      time_object: { timestamp: "2024-07-03T00:00:00Z", timezone: "UTC" },
      attribute: {
        property_id: "PROP-SPECIAL-3",
        suburb: "Surry Hills (East)",
        postcode: 2010,
        purchase_price: 1800000,
        area: 120,
        zoning: "R2",
        contract_date: "2024-07-03",
      },
    },
  ];

  beforeAll(async () => {
    await pgRepo.writeEvents(largeDataset, LARGE_DATASET_ID);
    await pgRepo.writeEvents(specialCharsEvents, SPECIAL_CHARS_DATASET_ID);
  });

  afterAll(async () => {
    const ids = [
      ...largeDataset.map((e) => e.event_id),
      ...specialCharsEvents.map((e) => e.event_id),
    ];
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: config.pgConnectionString });
    await pool.query("DELETE FROM events WHERE event_id = ANY($1::text[])", [ids]);
    await pool.end();
  });

  it("handles large dataset (100+ events) without truncating results", async () => {
    const breakdownRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb", limit: 100 })
      .expect(200);

    // Calculate expected counts
    const sydneyCount = largeDataset.filter((e) => e.attribute.suburb === "Sydney").length;
    const parramattaCount = largeDataset.filter((e) => e.attribute.suburb === "Parramatta").length;
    const chatswoodCount = largeDataset.filter((e) => e.attribute.suburb === "Chatswood").length;

    // Verify all suburbs are present and counts are correct
    // Note: counts will include events from other tests, so we check >= expected
    const sydneyEntry = breakdownRes.body.entries.find(
      (e: { category: string }) => e.category === "Sydney"
    );
    const parramattaEntry = breakdownRes.body.entries.find(
      (e: { category: string }) => e.category === "Parramatta"
    );
    const chatswoodEntry = breakdownRes.body.entries.find(
      (e: { category: string }) => e.category === "Chatswood"
    );

    expect(sydneyEntry).toBeDefined();
    expect(sydneyEntry.count).toBeGreaterThanOrEqual(sydneyCount);
    expect(parramattaEntry).toBeDefined();
    expect(parramattaEntry.count).toBeGreaterThanOrEqual(parramattaCount);
    expect(chatswoodEntry).toBeDefined();
    expect(chatswoodEntry.count).toBeGreaterThanOrEqual(chatswoodCount);

    // Timeseries should also handle large datasets
    const timeseriesRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({ event_type: "housing_sale", time_period: "month" })
      .expect(200);

    // Should have multiple months of data
    expect(timeseriesRes.body.data.length).toBeGreaterThan(0);

    // Verify total count across all periods matches our dataset size
    const totalCount = timeseriesRes.body.data.reduce(
      (sum: number, d: { value: number }) => sum + d.value,
      0
    );
    // Total should include large dataset + other test events
    expect(totalCount).toBeGreaterThanOrEqual(120);
  });

  it("handles special characters in attribute values without mangling", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb", limit: 50 })
      .expect(200);

    // Check that suburbs with special characters are present and correctly stored
    const oconnorEntry = res.body.entries.find(
      (e: { category: string }) => e.category === "O'Connor"
    );
    const smithJonesEntry = res.body.entries.find(
      (e: { category: string }) => e.category === "Smith & Jones Bay"
    );
    const surryHillsEntry = res.body.entries.find(
      (e: { category: string }) => e.category === "Surry Hills (East)"
    );

    expect(oconnorEntry).toBeDefined();
    expect(oconnorEntry.category).toBe("O'Connor");

    expect(smithJonesEntry).toBeDefined();
    expect(smithJonesEntry.category).toBe("Smith & Jones Bay");

    expect(surryHillsEntry).toBeDefined();
    expect(surryHillsEntry.category).toBe("Surry Hills (East)");
  });

  it("aggregates data correctly with special characters in dimension grouping", async () => {
    const res = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        time_period: "month",
      })
      .expect(200);

    // Filter to July 2024 where our special character events are
    const july2024Entries = res.body.data.filter(
      (d: { period: string }) => d.period === "2024-07"
    );

    // Should have entries for our special character suburbs
    const oconnorEntry = july2024Entries.find(
      (d: { series?: string }) => d.series === "O'Connor"
    );
    const smithJonesEntry = july2024Entries.find(
      (d: { series?: string }) => d.series === "Smith & Jones Bay"
    );

    expect(oconnorEntry).toBeDefined();
    expect(smithJonesEntry).toBeDefined();
  });
});

describe("Visualisation endpoints — combined scenarios", () => {
  it("can generate a dashboard with breakdown and timeseries together", async () => {
    // Get current breakdown
    const breakdownRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "avg",
      })
      .expect(200);

    // Get timeseries for comparison
    const timeseriesRes = await request(app)
      .get("/api/v1/visualisation/timeseries")
      .query({
        event_type: "housing_sale",
        dimension: "suburb",
        metric: "purchase_price",
        aggregation: "avg",
        time_period: "month",
      })
      .expect(200);

    // Validate dashboard data
    expect(breakdownRes.body.entries.length).toBeGreaterThan(0);
    expect(timeseriesRes.body.data.length).toBeGreaterThan(0);

    // Both should have Sydney
    const sydneyInBreakdown = breakdownRes.body.entries.some(
      (e: { category: string }) => e.category === "Sydney"
    );
    expect(sydneyInBreakdown).toBe(true);

    const sydneyInTimeseries = timeseriesRes.body.data.some(
      (d: { series?: string }) => d.series === "Sydney"
    );
    expect(sydneyInTimeseries).toBe(true);
  });

  it("supports querying both event types independently", async () => {
    // Housing breakdown
    const housingRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "housing_sale", dimension: "suburb" })
      .expect(200);

    expect(housingRes.body.event_type).toBe("housing_sale");
    expect(housingRes.body.entries.length).toBeGreaterThan(0);

    // ESG breakdown
    const esgRes = await request(app)
      .get("/api/v1/visualisation/breakdown")
      .query({ event_type: "esg_metric", dimension: "pillar" })
      .expect(200);

    expect(esgRes.body.event_type).toBe("esg_metric");
    expect(esgRes.body.entries.length).toBeGreaterThan(0);

    // Should not have overlapping dimensions
    const housingDims = housingRes.body.entries.map((e: { category: string }) => e.category);
    const esgDims = esgRes.body.entries.map((e: { category: string }) => e.category);
    const overlap = housingDims.filter((d: string) => esgDims.includes(d));
    expect(overlap.length).toBe(0);
  });
});