/**
 * Unit tests for the "crime" (nsw_crime) dataset type registration.
 *
 * Covers:
 *   - DATASET_TYPE_MAP maps "crime" → "nsw_crime"
 *   - resolveEventType works for "crime"
 *   - CRIME_DIMENSIONS and CRIME_METRICS are valid dimension/metric values
 *   - validateDimension does not throw for any CRIME_DIMENSION
 *   - validateMetric does not throw for "count" (the only crime metric)
 *   - getEvents passes offence_category through to dataLakeReader
 *   - HTTP GET /api/v1/events?dataset_type=crime routes to nsw_crime
 *   - HTTP GET /api/v1/events?offence_category filters are forwarded
 */

import request from "supertest";
import { createApp } from "../../src/http/app";
import {
  DATASET_TYPE_MAP,
  resolveEventType,
  CRIME_DIMENSIONS,
  CRIME_METRICS,
  validateDimension,
  validateMetric,
} from "../../src/domain/models/aggregation";
import { getEvents } from "../../src/application/retrieval/getEvents";

// ── Shared mock crime events ──────────────────────────────────────────────────

const fakeCrimeEvents = [
  {
    event_id: "c-1",
    event_type: "nsw_crime",
    time_object: { timestamp: "2023-06-01T00:00:00Z", timezone: "Australia/Sydney" },
    attribute: {
      postcode: 2000,
      suburb: "Sydney CBD",
      offence_category: "Assault",
      count: 145,
    },
  },
  {
    event_id: "c-2",
    event_type: "nsw_crime",
    time_object: { timestamp: "2023-07-01T00:00:00Z", timezone: "Australia/Sydney" },
    attribute: {
      postcode: 2000,
      suburb: "Sydney CBD",
      offence_category: "Drug offences",
      count: 97,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockReader(crimeEvents = fakeCrimeEvents) {
  return {
    queryEvents: jest.fn().mockResolvedValue({ events: crimeEvents, total: crimeEvents.length }),
    findEventById: jest.fn(),
    deleteEvent: jest.fn(),
    getDistinctEventTypes: jest.fn().mockResolvedValue(["nsw_crime"]),
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
  it('maps "crime" to "nsw_crime"', () => {
    expect(DATASET_TYPE_MAP["crime"]).toBe("nsw_crime");
  });
});

describe("resolveEventType", () => {
  it('resolves "crime" to "nsw_crime"', () => {
    expect(resolveEventType("crime")).toBe("nsw_crime");
  });
});

// ── 2. Dimension / metric allowlists ──────────────────────────────────────────

describe("CRIME_DIMENSIONS", () => {
  it("contains suburb, postcode, offence_category", () => {
    expect(CRIME_DIMENSIONS).toContain("suburb");
    expect(CRIME_DIMENSIONS).toContain("postcode");
    expect(CRIME_DIMENSIONS).toContain("offence_category");
  });

  it.each([...CRIME_DIMENSIONS])('validateDimension("%s") does not throw', (dim) => {
    expect(() => validateDimension(dim)).not.toThrow();
  });
});

describe("CRIME_METRICS", () => {
  it("contains count", () => {
    expect(CRIME_METRICS).toContain("count");
  });

  it.each([...CRIME_METRICS])('validateMetric("%s") does not throw', (metric) => {
    expect(() => validateMetric(metric)).not.toThrow();
  });
});

// ── 3. getEvents application service ─────────────────────────────────────────

describe("getEvents with crime dataset_type", () => {
  it("passes dataset_type:crime directly to dataLakeReader.queryEvents", async () => {
    const reader = makeMockReader();
    const deps = { dataLakeReader: reader };
    await getEvents({ dataset_type: "crime", limit: 10, offset: 0 }, deps);
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "crime" }),
    );
  });

  it("passes offence_category filter through to queryEvents", async () => {
    const reader = makeMockReader();
    const deps = { dataLakeReader: reader };
    await getEvents(
      { dataset_type: "crime", offence_category: "Assault", limit: 10, offset: 0 },
      deps,
    );
    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ offence_category: "Assault" }),
    );
  });

  it("returns the events and total from the reader", async () => {
    const reader = makeMockReader();
    const result = await getEvents({ dataset_type: "crime", limit: 10, offset: 0 }, { dataLakeReader: reader });
    expect(result.events).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

// ── 4. HTTP layer ─────────────────────────────────────────────────────────────

describe("GET /api/v1/events?dataset_type=crime", () => {
  it("returns 200 with crime events", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=crime&limit=10")
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].event_type).toBe("nsw_crime");
  });

  it("calls queryEvents with dataset_type=crime", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app).get("/api/v1/events?dataset_type=crime").expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ dataset_type: "crime" }),
    );
  });

  it("forwards offence_category query param", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    await request(app)
      .get("/api/v1/events?dataset_type=crime&offence_category=Assault")
      .expect(200);

    expect(reader.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ offence_category: "Assault" }),
    );
  });

  it("returns 200 with postcode filter for crime", async () => {
    const reader = makeMockReader();
    const { app } = buildApp(reader);

    const res = await request(app)
      .get("/api/v1/events?dataset_type=crime&postcode=2000")
      .expect(200);

    expect(res.body.total).toBe(2);
  });
});
