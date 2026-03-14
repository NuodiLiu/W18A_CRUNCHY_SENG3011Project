import request from "supertest";
import { createApp } from "../../src/http/app";
import { PIPELINE_CATALOGUE } from "../../src/application/preprocessing/getPipelines";

function buildApp() {
  const deps = {
    jobRepo: {
      create: jest.fn(),
      findById: jest.fn(),
      claimJob: jest.fn(),
      updateStatus: jest.fn(),
    },
    configStore: { putConfig: jest.fn(), getConfig: jest.fn() },
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
      queryEvents: jest.fn(),
      findEventById: jest.fn(),
      getDistinctEventTypes: jest.fn(),
      getGroupProjection: jest.fn(),
    },
  };
  return { app: createApp(deps as Parameters<typeof createApp>[0]), deps };
}

describe("GET /api/v1/preprocessing/pipelines", () => {
  it("returns 200", async () => {
    const { app } = buildApp();
    await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
  });

  it("response has a pipelines array", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    expect(Array.isArray(res.body.pipelines)).toBe(true);
    expect(res.body.pipelines.length).toBeGreaterThan(0);
  });

  it("includes housing_clean_v1 pipeline", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    const ids: string[] = res.body.pipelines.map((p: { id: string }) => p.id);
    expect(ids).toContain("housing_clean_v1");
  });

  it("housing_clean_v1 has required fields", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    const housing = res.body.pipelines.find((p: { id: string }) => p.id === "housing_clean_v1");
    expect(housing).toBeDefined();
    expect(housing.name).toBeTruthy();
    expect(housing.description).toBeTruthy();
    expect(housing.category).toBe("general");
    expect(housing.params_schema).toBeDefined();
  });

  it("housing_clean_v1 params_schema has expected filter params", () => {
    const housing = PIPELINE_CATALOGUE.find((p) => p.id === "housing_clean_v1")!;
    const props = (housing.params_schema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("suburb");
    expect(props).toHaveProperty("postcode");
    expect(props).toHaveProperty("price_min");
    expect(props).toHaveProperty("price_max");
    expect(props).toHaveProperty("date_from");
    expect(props).toHaveProperty("date_to");
    expect(props).toHaveProperty("dedup_by_dealing");
  });

  it("pipelines response matches PIPELINE_CATALOGUE exactly", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/preprocessing/pipelines").expect(200);
    expect(res.body.pipelines).toEqual(PIPELINE_CATALOGUE);
  });
});
