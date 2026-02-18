import {
  canonicalizeSourceSpec,
  computeConnectionId,
} from "../../src/application/ingestion/createImportJob";
import { SourceSpec } from "../../src/domain/models/jobConfig";

describe("canonicalizeSourceSpec", () => {
  it("sorts s3_uris alphabetically", () => {
    const spec: SourceSpec = {
      s3_uris: ["s3://bucket/c.csv", "s3://bucket/a.csv", "s3://bucket/b.csv"],
      timezone: "UTC",
    };
    const result = canonicalizeSourceSpec(spec);
    expect(result.s3_uris).toEqual([
      "s3://bucket/a.csv",
      "s3://bucket/b.csv",
      "s3://bucket/c.csv",
    ]);
  });

  it("strips trailing slashes from s3_prefix", () => {
    const spec: SourceSpec = {
      s3_prefix: "s3://bucket/prefix///",
      timezone: "UTC",
    };
    const result = canonicalizeSourceSpec(spec);
    expect(result.s3_prefix).toBe("s3://bucket/prefix");
  });

  it("does not mutate the original spec", () => {
    const spec: SourceSpec = {
      s3_uris: ["s3://b/z.csv", "s3://b/a.csv"],
      timezone: "UTC",
    };
    const originalUris = [...spec.s3_uris!];
    canonicalizeSourceSpec(spec);
    expect(spec.s3_uris).toEqual(originalUris);
  });

  it("preserves other fields unchanged", () => {
    const spec: SourceSpec = {
      s3_uris: ["s3://b/a.csv"],
      delimiter: "\t",
      has_header: false,
      timezone: "Australia/Sydney",
      time_column: "year",
    };
    const result = canonicalizeSourceSpec(spec);
    expect(result.delimiter).toBe("\t");
    expect(result.has_header).toBe(false);
    expect(result.timezone).toBe("Australia/Sydney");
    expect(result.time_column).toBe("year");
  });
});

describe("computeConnectionId", () => {
  const spec: SourceSpec = {
    s3_uris: ["s3://bucket/data.csv"],
    timezone: "UTC",
  };

  it("returns a 64-char hex string (sha256)", () => {
    const id = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce same output", () => {
    const id1 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    const id2 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    expect(id1).toBe(id2);
  });

  it("changes when connector_type differs", () => {
    const id1 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    const id2 = computeConnectionId("other_type", spec, "esg_v1", "esg_metrics");
    expect(id1).not.toBe(id2);
  });

  it("changes when source_spec differs", () => {
    const spec2: SourceSpec = {
      s3_uris: ["s3://bucket/other.csv"],
      timezone: "UTC",
    };
    const id1 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    const id2 = computeConnectionId("esg_csv_batch", spec2, "esg_v1", "esg_metrics");
    expect(id1).not.toBe(id2);
  });

  it("changes when mapping_profile differs", () => {
    const id1 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    const id2 = computeConnectionId("esg_csv_batch", spec, "esg_v2", "esg_metrics");
    expect(id1).not.toBe(id2);
  });

  it("changes when dataset_type differs", () => {
    const id1 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "esg_metrics");
    const id2 = computeConnectionId("esg_csv_batch", spec, "esg_v1", "other_type");
    expect(id1).not.toBe(id2);
  });
});
