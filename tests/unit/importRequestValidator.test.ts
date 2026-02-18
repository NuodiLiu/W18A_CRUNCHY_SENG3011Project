import { importRequestSchema } from "../../src/http/validators/importRequest";

const validPayload = {
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://bucket/file.csv"],
    timezone: "UTC",
  },
  mapping_profile: "esg_v1",
  data_source: "clarity_ai",
  dataset_type: "esg_metrics",
  ingestion_mode: "full_refresh",
};

describe("importRequestSchema", () => {
  it("accepts a fully valid payload", () => {
    const result = importRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts incremental ingestion_mode", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      ingestion_mode: "incremental",
    });
    expect(result.success).toBe(true);
  });

  it("applies default delimiter and has_header", () => {
    const result = importRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_spec.delimiter).toBe(",");
      expect(result.data.source_spec.has_header).toBe(true);
    }
  });

  it("rejects unknown connector_type", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      connector_type: "unknown_type",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing connector_type", () => {
    const { connector_type: _ct, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing source_spec", () => {
    const { source_spec: _ss, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing mapping_profile", () => {
    const { mapping_profile: _mp, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing data_source", () => {
    const { data_source: _ds, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing dataset_type", () => {
    const { dataset_type: _dt, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing ingestion_mode", () => {
    const { ingestion_mode: _im, ...rest } = validPayload;
    const result = importRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ingestion_mode value", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      ingestion_mode: "snapshot",
    });
    expect(result.success).toBe(false);
  });

  it("rejects source_spec with neither s3_uris nor s3_prefix", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: { timezone: "UTC" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects source_spec with empty s3_uris and no s3_prefix", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: { s3_uris: [], timezone: "UTC" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts source_spec with s3_prefix instead of s3_uris", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: {
        s3_prefix: "s3://bucket/prefix/",
        timezone: "UTC",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects s3_uris not starting with s3://", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: {
        s3_uris: ["http://bucket/file.csv"],
        timezone: "UTC",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects s3_prefix not starting with s3://", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: {
        s3_prefix: "/local/path",
        timezone: "UTC",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timezone in source_spec", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: {
        s3_uris: ["s3://bucket/file.csv"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional idempotency_key", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      idempotency_key: "abc-def",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.idempotency_key).toBe("abc-def");
    }
  });

  it("allows custom delimiter and has_header overrides", () => {
    const result = importRequestSchema.safeParse({
      ...validPayload,
      source_spec: {
        s3_uris: ["s3://bucket/file.tsv"],
        timezone: "UTC",
        delimiter: "\t",
        has_header: false,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_spec.delimiter).toBe("\t");
      expect(result.data.source_spec.has_header).toBe(false);
    }
  });
});
