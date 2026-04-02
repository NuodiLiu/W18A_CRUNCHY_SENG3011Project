import { getEventById, GetEventByIdDeps } from "../../src/application/retrieval/getEventById";
import { getEvents, GetEventsDeps } from "../../src/application/retrieval/getEvents";
import { getEventStats, GetEventStatsDeps } from "../../src/application/retrieval/getEventStats";

const fakeEvent = {
  event_id: "h-1",
  event_type: "housing_sale",
  time_object: {
    timestamp: "2024-04-10T00:00:00Z",
    timezone: "UTC",
  },
  attribute: {
    property_id: "P001",
    suburb: "Sydney",
    postcode: 2000,
  },
};

function makeEventByIdDeps(event: typeof fakeEvent | undefined): GetEventByIdDeps {
  return {
    dataLakeReader: {
      queryEvents: jest.fn(),
      findEventById: jest.fn().mockResolvedValue(event),
      deleteEvent: jest.fn(),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn(),
      readDataset: jest.fn(),
    },
  };
}

function makeGetEventsDeps(events: typeof fakeEvent[], total: number): GetEventsDeps {
  return {
    dataLakeReader: {
      queryEvents: jest.fn().mockResolvedValue({ events, total }),
      findEventById: jest.fn(),
      deleteEvent: jest.fn(),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn(),
      readDataset: jest.fn(),
    },
  };
}

function makeStatsDeps(rows: Record<string, unknown>[]): GetEventStatsDeps {
  return {
    dataLakeReader: {
      queryEvents: jest.fn(),
      findEventById: jest.fn(),
      deleteEvent: jest.fn(),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn().mockResolvedValue(rows),
      readDataset: jest.fn(),
    },
  };
}

describe("getEventById", () => {
  it("returns event when it exists", async () => {
    const deps = makeEventByIdDeps(fakeEvent);
    const result = await getEventById("h-1", deps);

    expect(result).toEqual(fakeEvent);
  });

  it("returns undefined when event does not exist", async () => {
    const deps = makeEventByIdDeps(undefined);
    const result = await getEventById("missing-id", deps);

    expect(result).toBeUndefined();
  });

  it("calls dataLakeReader.findEventById with the correct eventId", async () => {
    const deps = makeEventByIdDeps(fakeEvent);
    await getEventById("h-1", deps);

    expect(deps.dataLakeReader.findEventById).toHaveBeenCalledWith("h-1");
  });

  it("throws error when dataLakeReader fails", async () => {
    const deps: GetEventByIdDeps = {
      dataLakeReader: {
        queryEvents: jest.fn(),
        findEventById: jest.fn().mockRejectedValue(new Error("reader failed")),
      deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn(),
        getGroupProjection: jest.fn(),
        readDataset: jest.fn(),
      },
    };

    await expect(getEventById("h-1", deps)).rejects.toThrow("reader failed");
  });
});

describe("getEvents", () => {
  it("returns events and total", async () => {
    const deps = makeGetEventsDeps([fakeEvent], 1);
    const result = await getEvents({ dataset_type: "housing", limit: 10, offset: 0 }, deps);

    expect(result).toEqual({
      events: [fakeEvent],
      total: 1,
    });
  });

  it("returns empty result when no events match", async () => {
    const deps = makeGetEventsDeps([], 0);
    const result = await getEvents({ dataset_type: "housing", limit: 10, offset: 0 }, deps);

    expect(result).toEqual({
      events: [],
      total: 0,
    });
  });

  it("calls dataLakeReader.queryEvents with the correct query", async () => {
    const deps = makeGetEventsDeps([fakeEvent], 1);
    const query = {
      dataset_type: "housing" as const,
      suburb: "Sydney",
      postcode: 2000,
      limit: 10,
      offset: 0,
    };

    await getEvents(query, deps);

    expect(deps.dataLakeReader.queryEvents).toHaveBeenCalledWith(query);
  });

  it("throws error when queryEvents fails", async () => {
    const deps: GetEventsDeps = {
      dataLakeReader: {
        queryEvents: jest.fn().mockRejectedValue(new Error("reader failed")),
        findEventById: jest.fn(),
      deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn(),
        getGroupProjection: jest.fn(),
        readDataset: jest.fn(),
      },
    };

    await expect(
      getEvents({ dataset_type: "housing", limit: 10, offset: 0 }, deps)
    ).rejects.toThrow("reader failed");
  });
});

describe("getEventStats", () => {
  it("groups by event_type when groupBy is undefined", async () => {
    const deps = makeStatsDeps([
      { event_type: "housing_sale" },
      { event_type: "housing_sale" },
      { event_type: "esg_metric" },
    ]);

    const result = await getEventStats(undefined, deps);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalledWith(["event_type"]);
    expect(result).toEqual({
      total_events: 3,
      groups: expect.arrayContaining([
        { key: "housing_sale", count: 2 },
        { key: "esg_metric", count: 1 },
      ]),
    });
  });

  it("falls back to event_type when groupBy is unsupported", async () => {
    const deps = makeStatsDeps([
      { event_type: "housing_sale" },
      { event_type: "housing_sale" },
      { event_type: "esg_metric" },
    ]);

    const result = await getEventStats("unsupported", deps);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalledWith(["event_type"]);
    expect(result).toEqual({
      total_events: 3,
      groups: expect.arrayContaining([
        { key: "housing_sale", count: 2 },
        { key: "esg_metric", count: 1 },
      ]),
    });
  });

  it('returns "unknown" when grouping by pillar and pillar is missing', async () => {
    const deps = makeStatsDeps([
      { event_type: "esg_metric", attribute: {} },
      { event_type: "esg_metric", attribute: { pillar: "Environmental" } },
    ]);

    const result = await getEventStats("pillar", deps);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalledWith([
      "event_type",
      "attribute.pillar",
    ]);
    expect(result).toEqual({
      total_events: 2,
      groups: expect.arrayContaining([
        { key: "unknown", count: 1 },
        { key: "Environmental", count: 1 },
      ]),
    });
  });

  it('returns "unknown" when grouping by contract_year and contract_date is missing', async () => {
    const deps = makeStatsDeps([
      { event_type: "housing_sale", attribute: {} },
      { event_type: "housing_sale", attribute: { contract_date: "2024-03-01" } },
    ]);

    const result = await getEventStats("contract_year", deps);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalledWith([
      "event_type",
      "attribute.contract_date",
    ]);
    expect(result).toEqual({
      total_events: 2,
      groups: expect.arrayContaining([
        { key: "unknown", count: 1 },
        { key: "2024", count: 1 },
      ]),
    });
  });

  it("counts duplicate keys correctly", async () => {
    const deps = makeStatsDeps([
      { event_type: "housing_sale", attribute: { suburb: "Sydney" } },
      { event_type: "housing_sale", attribute: { suburb: "Sydney" } },
      { event_type: "housing_sale", attribute: { suburb: "Parramatta" } },
    ]);

    const result = await getEventStats("suburb", deps);

    expect(result).toEqual({
      total_events: 3,
      groups: expect.arrayContaining([
        { key: "Sydney", count: 2 },
        { key: "Parramatta", count: 1 },
      ]),
    });
  });

  it("returns empty groups when there are no rows", async () => {
    const deps = makeStatsDeps([]);
    const result = await getEventStats("suburb", deps);

    expect(result).toEqual({
      total_events: 0,
      groups: [],
    });
  });

  it("calls dataLakeReader.getGroupProjection with suburb fields", async () => {
    const deps = makeStatsDeps([
      { event_type: "housing_sale", attribute: { suburb: "Sydney" } },
    ]);

    await getEventStats("suburb", deps);

    expect(deps.dataLakeReader.getGroupProjection).toHaveBeenCalledWith([
      "event_type",
      "attribute.suburb",
    ]);
  });

  it("throws error when getGroupProjection fails", async () => {
    const deps: GetEventStatsDeps = {
      dataLakeReader: {
        queryEvents: jest.fn(),
        findEventById: jest.fn(),
      deleteEvent: jest.fn(),
        getDistinctEventTypes: jest.fn(),
        getGroupProjection: jest.fn().mockRejectedValue(new Error("reader failed")),
        readDataset: jest.fn(),
      },
    };

    await expect(getEventStats("pillar", deps)).rejects.toThrow("reader failed");
  });
});