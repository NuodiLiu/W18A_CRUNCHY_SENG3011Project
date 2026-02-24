describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadFresh() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    return require("../../src/config/index").loadConfig();
  }

  it("returns default values when no env vars are set", () => {
    const config = loadFresh();
    expect(config.appMode).toBe("api");
    expect(config.port).toBe(3000);
    expect(config.region).toBe("ap-southeast-2");
  });

  it("uses PROJECT_PREFIX and ENV_SUFFIX in resource names", () => {
    process.env.PROJECT_PREFIX = "myproj";
    process.env.ENV_SUFFIX = "staging";
    const config = loadFresh();
    expect(config.sqsQueueName).toBe("myproj-staging-import-jobs");
    expect(config.ddbJobsTable).toBe("myproj-staging-jobs");
    expect(config.s3ConfigBucket).toBe("myproj-staging-config");
  });

  it("reads explicit env var overrides", () => {
    process.env.APP_MODE = "worker";
    process.env.PORT = "8080";
    process.env.AWS_REGION = "us-east-1";
    const config = loadFresh();
    expect(config.appMode).toBe("worker");
    expect(config.port).toBe(8080);
    expect(config.region).toBe("us-east-1");
  });

  it("sets optional endpoints to undefined when not provided", () => {
    const config = loadFresh();
    expect(config.dynamoEndpoint).toBeUndefined();
    expect(config.s3Endpoint).toBeUndefined();
    expect(config.sqsEndpoint).toBeUndefined();
  });

  it("reads optional endpoint env vars when set", () => {
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
    process.env.S3_ENDPOINT = "http://localhost:4566";
    process.env.SQS_ENDPOINT = "http://localhost:4566";
    const config = loadFresh();
    expect(config.dynamoEndpoint).toBe("http://localhost:8000");
    expect(config.s3Endpoint).toBe("http://localhost:4566");
    expect(config.sqsEndpoint).toBe("http://localhost:4566");
  });

  it("uses individual table env vars over prefix convention", () => {
    process.env.DDB_JOBS_TABLE = "custom-jobs";
    process.env.SQS_QUEUE_NAME = "custom-queue";
    const config = loadFresh();
    expect(config.ddbJobsTable).toBe("custom-jobs");
    expect(config.sqsQueueName).toBe("custom-queue");
  });
});
