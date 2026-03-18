import { createConnector } from "../../src/infra/connectors/connectorFactory";
import { EsgCsvBatchConnector } from "../../src/infra/connectors/esgCsvBatchConnector";
import { AppConfig } from "../../src/config/index";
import { UnprocessableError } from "../../src/domain/errors";

const fakeConfig: AppConfig = {
  appMode: "api",
  port: 3000,
  region: "ap-southeast-2",
  sqsQueueName: "test-queue",
  ddbJobsTable: "test-jobs",
  ddbStateTable: "test-state",
  ddbIdempotencyTable: "test-idempotency",
  ddbEventsTable: "test-events",
  s3ConfigBucket: "test-config",
  s3DatalakeBucket: "test-datalake",
};

describe("createConnector", () => {
  it("returns an EsgCsvBatchConnector for 'esg_csv_batch'", () => {
    const connector = createConnector("esg_csv_batch", fakeConfig);
    expect(connector).toBeInstanceOf(EsgCsvBatchConnector);
  });

  it("throws UnprocessableError for unknown connector type", () => {
    expect(() => createConnector("unknown_type", fakeConfig)).toThrow(
      UnprocessableError
    );
  });

  it("error message includes the unknown type name", () => {
    expect(() => createConnector("foo_bar", fakeConfig)).toThrow(
      /foo_bar/
    );
  });

  it("returns a new instance on each call", () => {
    const c1 = createConnector("esg_csv_batch", fakeConfig);
    const c2 = createConnector("esg_csv_batch", fakeConfig);
    expect(c1).not.toBe(c2);
  });
});
