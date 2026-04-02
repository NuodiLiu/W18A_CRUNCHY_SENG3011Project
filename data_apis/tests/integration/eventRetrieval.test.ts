import request from "supertest";
import { loadConfig } from "../../src/config/index";
import { createApp } from "../../src/http/app";
import { DynamoJobRepository } from "../../src/infra/aws/dynamoJobRepository";
import { S3ConfigStore } from "../../src/infra/aws/s3ConfigStore";
import { SQSQueueService } from "../../src/infra/aws/sqsQueueService";
import { S3PresignService } from "../../src/infra/aws/s3PresignService";
import { PostgresEventRepository } from "../../src/infra/postgres/postgresEventRepository";
import { EventRecord } from "../../src/domain/models/event";

// --- setup ---

const config = loadConfig();
const pgRepo = new PostgresEventRepository(config);
const jobRepo = new DynamoJobRepository(config);
const configStore = new S3ConfigStore(config);
const queue = new SQSQueueService(config);
const fileUploadService = new S3PresignService(config);

const app = createApp({
  jobRepo,
  configStore,
  queue,
  fileUploadService,
  dataLakeReader: pgRepo,
});

// ── Seed data ─────────────────────────────────────────────────

const DATASET_ID = "esg_test_retrieval";

const sampleEvents: EventRecord[] = [
  {
    event_id: "evt-001",
    event_type: "esg_metric",
    time_object: { timestamp: "2024-01-15T00:00:00Z", timezone: "UTC" },
    attribute: {
      company_name: "TestCorp",
      permid: "P12345",
      metric_name: "carbon_emissions",
      pillar: "Environmental",
      metric_year: 2023,
      industry: "Technology",
      value: 42.5,
    },
  },
  {
    event_id: "evt-002",
    event_type: "esg_metric",
    time_object: { timestamp: "2024-01-16T00:00:00Z", timezone: "UTC" },
    attribute: {
      company_name: "TestCorp",
      permid: "P12345",
      metric_name: "water_usage",
      pillar: "Environmental",
      metric_year: 2024,
      industry: "Technology",
      value: 18.0,
    },
  },
  {
    event_id: "evt-003",
    event_type: "housing_sale",
    time_object: { timestamp: "2024-02-01T00:00:00Z", timezone: "AEST" },
    attribute: {
      property_id: "PROP-001",
      dealing_number: 99001,
      unit_number: "5",
      street_number: "12",
      street_name: "Anzac Pde",
      suburb: "Kensington",
      postcode: 2033,
      purchase_price: 1500000,
      legal_description: "Lot 1 DP100200",
      area: 85,
      area_type: "sqm",
      contract_date: "2024-02-01",
      settlement_date: "2024-03-15",
      district_code: 10,
      zoning: "R1",
      nature_of_property: "Residential",
      primary_purpose: "Dwelling",
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────

async function seedData() {
  await pgRepo.writeEvents(sampleEvents, DATASET_ID);
}

async function cleanupData() {
  const ids = sampleEvents.map((e) => e.event_id);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.pgConnectionString });

  try {
    await pool.query("DELETE FROM events WHERE event_id = ANY($1::text[])", [ids]);
  } finally {
    await pool.end();
  }
}

async function clearSeededDataset() {
  await cleanupData();
}

async function restoreSeededDataset() {
  await seedData();
}

// ── Lifecycle ────────────────────────────────────────────────

beforeAll(async () => {
  await seedData();
});

afterAll(async () => {
  await cleanupData();
  await pgRepo.close();
});

// ── Tests ────────────────────────────────────────────────────

describe("GET /api/v1/events/:eventId — integration", () => {
  it("returns a single event by ID", async () => {
    const res = await request(app)
      .get("/api/v1/events/evt-001")
      .expect(200);

    expect(res.body.event_id).toBe("evt-001");
    expect(res.body.event_type).toBe("esg_metric");
    expect(res.body.attribute.company_name).toBe("TestCorp");
  });

  it("returns 404 for non-existent event ID", async () => {
    await request(app)
      .get("/api/v1/events/evt-nonexistent")
      .expect(404);
  });
});

describe("GET /api/v1/events/types — integration", () => {
  it("returns distinct event types", async () => {
    const res = await request(app)
      .get("/api/v1/events/types")
      .expect(200);

    expect(res.body.event_types).toBeDefined();
    expect(res.body.event_types).toContain("esg_metric");
    expect(res.body.event_types).toContain("housing_sale");
  });

  it("returns empty array when no event types exist", async () => {
    await clearSeededDataset();

    try {
      const res = await request(app)
        .get("/api/v1/events/types")
        .expect(200);

      expect(res.body.event_types).toEqual([]);
    } finally {
      await restoreSeededDataset();
    }
  });
});

describe("GET /api/v1/events/stats — integration", () => {
  it("returns stats with total_events", async () => {
    const res = await request(app)
      .get("/api/v1/events/stats")
      .expect(200);

    expect(res.body.total_events).toBe(3);
    expect(res.body.groups).toBeDefined();
  });

  it("groups by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/events/stats?group_by=pillar")
      .expect(200);

    expect(res.body.total_events).toBe(3);
    const envGroup = res.body.groups.find(
      (g: Record<string, unknown>) => g.key === "Environmental"
    );
    expect(envGroup).toBeDefined();
    expect(envGroup.count).toBe(2);
  });

  it("groups by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/events/stats?group_by=suburb")
      .expect(200);

    expect(res.body.total_events).toBe(3);

    const suburbGroup = res.body.groups.find(
      (g: Record<string, unknown>) => g.key === "Kensington"
    );

    expect(suburbGroup).toBeDefined();
    expect(suburbGroup.count).toBe(1);
  });

  it("returns empty result when dataset is empty", async () => {
    await clearSeededDataset();

    try {
      const res = await request(app)
        .get("/api/v1/events/stats")
        .expect(200);

      expect(res.body.total_events).toBe(0);
      expect(res.body.groups).toEqual([]);
    } finally {
      await restoreSeededDataset();
    }
  });
});

describe("GET /api/v1/events — integration", () => {
  it("returns all events with total", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.total).toBe(sampleEvents.length);
    expect(res.body.events).toHaveLength(sampleEvents.length);
  });

  it("returns correct event structure", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .expect(200);

    const evt = res.body.events.find((e: { event_id: string }) => e.event_id === "evt-001");
    expect(evt).toBeDefined();
    expect(evt.event_type).toBe("esg_metric");
    expect(evt.time_object.timestamp).toBe("2024-01-15T00:00:00Z");
    expect(evt.time_object.timezone).toBe("UTC");
  });

  it("respects limit param", async () => {
    const res = await request(app)
      .get("/api/v1/events?limit=1")
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.total).toBe(sampleEvents.length);
  });

  it("respects offset param", async () => {
    const resAll = await request(app).get("/api/v1/events").expect(200);
    const resOffset = await request(app).get("/api/v1/events?offset=1").expect(200);

    expect(resOffset.body.events).toHaveLength(sampleEvents.length - 1);
    expect(resOffset.body.events[0].event_id).not.toBe(resAll.body.events[0].event_id);
  });

  it("supports limit and offset pagination", async () => {
    const res = await request(app)
      .get("/api/v1/events?limit=1&offset=0")
      .expect(200);

    expect(res.body.events.length).toBe(1);
  });

  it("filters by company_name", async () => {
    const res = await request(app)
      .get("/api/v1/events?company_name=TestCorp")
      .expect(200);

    expect(res.body.events.length).toBe(2);
    for (const evt of res.body.events) {
      expect(evt.attribute.company_name).toBe("TestCorp");
    }
  });

  it("returns empty events for non-matching filter", async () => {
    const res = await request(app)
      .get("/api/v1/events?company_name=NonExistent")
      .expect(200);

    expect(res.body.events).toEqual([]);
  });

  it("filters by dataset_type=esg (returns only ESG events)", async () => {
    const res = await request(app)
      .get("/api/v1/events?dataset_type=esg")
      .expect(200);

    expect(res.body.events.length).toBe(2);
    for (const evt of res.body.events) {
      expect(evt.event_type).toBe("esg_metric");
    }
  });

  it("filters by dataset_type=housing (returns only housing events)", async () => {
    const res = await request(app)
      .get("/api/v1/events?dataset_type=housing")
      .expect(200);

    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].event_type).toBe("housing_sale");
  });

  it("filters by suburb", async () => {
    const res = await request(app)
      .get("/api/v1/events?suburb=Kensington")
      .expect(200);

    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].attribute.suburb).toBe("Kensington");
  });

  it("filters by postcode", async () => {
    const res = await request(app)
      .get("/api/v1/events?postcode=2033")
      .expect(200);

    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].attribute.postcode).toBe(2033);
  });

  it("filters by street_name (partial match)", async () => {
    const res = await request(app)
      .get("/api/v1/events?street_name=Anzac")
      .expect(200);

    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].attribute.street_name).toBe("Anzac Pde");
  });

  it("filters by nature_of_property", async () => {
    const res = await request(app)
      .get("/api/v1/events?nature_of_property=Residential")
      .expect(200);

    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].attribute.nature_of_property).toBe("Residential");
  });

  it("supports combined filters together", async () => {
    const res = await request(app)
      .get("/api/v1/events?dataset_type=housing&suburb=Kensington&postcode=2033")
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].event_type).toBe("housing_sale");
    expect(res.body.events[0].attribute.suburb).toBe("Kensington");
    expect(res.body.events[0].attribute.postcode).toBe(2033);
  });

  it("filters by pillar", async () => {
    const res = await request(app)
      .get("/api/v1/events?pillar=Environmental")
      .expect(200);

    expect(res.body.events.length).toBe(2);
    for (const evt of res.body.events) {
      expect(evt.attribute.pillar).toBe("Environmental");
    }
  });

  it("filters by permid", async () => {
    const res = await request(app)
      .get("/api/v1/events?permid=P12345")
      .expect(200);

    expect(res.body.events.length).toBe(2);
    for (const evt of res.body.events) {
      expect(evt.attribute.permid).toBe("P12345");
    }
  });

  it("returns empty for suburb that does not exist", async () => {
    const res = await request(app)
      .get("/api/v1/events?suburb=Atlantis")
      .expect(200);

    expect(res.body.events).toEqual([]);
  });
});

describe("DELETE /api/v1/events/:eventId — integration", () => {
  it("deletes an existing event", async () => {
    // First verify the event exists
    await request(app)
      .get("/api/v1/events/evt-001")
      .expect(200);

    // Delete the event
    await request(app)
      .delete("/api/v1/events/evt-001")
      .expect(204);

    // Verify the event is gone
    await request(app)
      .get("/api/v1/events/evt-001")
      .expect(404);

    // Restore the event for subsequent tests
    const eventToRestore = sampleEvents.find((e) => e.event_id === "evt-001");
    if (eventToRestore) {
      await pgRepo.writeEvents([eventToRestore], DATASET_ID);
    }
  });

  it("returns 404 for non-existent event ID", async () => {
    await request(app)
      .delete("/api/v1/events/evt-nonexistent")
      .expect(404);
  });
});
