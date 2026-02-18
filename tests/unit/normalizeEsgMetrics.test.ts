import { normalizeEsgMetrics } from "../../src/application/normalizers/normalizeEsgMetrics";
import { RawRecord } from "../../src/domain/ports/connector";
import { JobConfig } from "../../src/domain/models/jobConfig";

// minimal config shared by all tests
const baseConfig: JobConfig = {
  job_id: "job-1",
  connection_id: "conn-1",
  connector_type: "esg_csv_batch",
  source_spec: {
    s3_uris: ["s3://bucket/data.csv"],
    timezone: "UTC",
  },
  mapping_profile: "esg_v1",
  data_source: "clarity_ai",
  dataset_type: "esg_metrics",
  timezone: "UTC",
  ingestion_mode: "full_refresh",
};

const RUN_TS = "2026-02-18T00:00:00.000Z";

function makeRawRecord(overrides: Record<string, string> = {}): RawRecord {
  return {
    raw_row: {
      permid: "5035919245",
      company_name: "Apple Inc.",
      metric_name: "CO2DIRECTSCOPE1",
      metric_value: "22400",
      metric_year: "2022",
      metric_unit: "Tonnes CO2",
      metric_description: "Direct GHG emissions",
      pillar: "E",
      industry: "Technology",
      headquarter_country: "US",
      data_type: "Score",
      disclosure: "ESTIMATED",
      provider_name: "Clarity AI",
      nb_points_of_observations: "150",
      reported_date: "2023-04-15",
      metric_period: "FY2022",
      ...overrides,
    },
    source_file: "s3://bucket/data.csv",
    row_number: 1,
  };
}

describe("normalizeEsgMetrics", () => {
  it("maps all 15 attribute fields correctly", () => {
    const events = normalizeEsgMetrics([makeRawRecord()], baseConfig, RUN_TS);
    expect(events).toHaveLength(1);

    const attr = events[0].attribute;
    expect(attr.permid).toBe("5035919245");
    expect(attr.company_name).toBe("Apple Inc.");
    expect(attr.metric_name).toBe("CO2DIRECTSCOPE1");
    expect(attr.metric_value).toBe(22400);
    expect(attr.metric_year).toBe(2022);
    expect(attr.metric_unit).toBe("Tonnes CO2");
    expect(attr.metric_description).toBe("Direct GHG emissions");
    expect(attr.pillar).toBe("E");
    expect(attr.industry).toBe("Technology");
    expect(attr.headquarter_country).toBe("US");
    expect(attr.data_type).toBe("Score");
    expect(attr.disclosure).toBe("ESTIMATED");
    expect(attr.provider_name).toBe("Clarity AI");
    expect(attr.nb_points_of_observations).toBe(150);
    expect(attr.reported_date).toBe("2023-04-15");
    expect(attr.metric_period).toBe("FY2022");
  });

  it("converts metric_year to ISO timestamp YYYY-01-01T00:00:00Z", () => {
    const events = normalizeEsgMetrics([makeRawRecord()], baseConfig, RUN_TS);
    expect(events[0].time_object.timestamp).toBe("2022-01-01T00:00:00Z");
  });

  it("falls back to runTimestamp when metric_year is missing", () => {
    const events = normalizeEsgMetrics(
      [makeRawRecord({ metric_year: "" })],
      baseConfig,
      RUN_TS,
    );
    expect(events[0].time_object.timestamp).toBe(RUN_TS);
    expect(events[0].attribute.metric_year).toBe(0);
  });

  it("sets event_type to esg_metric", () => {
    const events = normalizeEsgMetrics([makeRawRecord()], baseConfig, RUN_TS);
    expect(events[0].event_type).toBe("esg_metric");
  });

  it("sets duration_unit to year", () => {
    const events = normalizeEsgMetrics([makeRawRecord()], baseConfig, RUN_TS);
    expect(events[0].time_object.duration).toBe(1);
    expect(events[0].time_object.duration_unit).toBe("year");
  });

  it("uses config timezone", () => {
    const config = { ...baseConfig, timezone: "Australia/Sydney" };
    const events = normalizeEsgMetrics([makeRawRecord()], config, RUN_TS);
    expect(events[0].time_object.timezone).toBe("Australia/Sydney");
  });

  it("returns null for metric_value when empty", () => {
    const events = normalizeEsgMetrics(
      [makeRawRecord({ metric_value: "" })],
      baseConfig,
      RUN_TS,
    );
    expect(events[0].attribute.metric_value).toBeNull();
  });

  it("returns null for nb_points_of_observations when empty", () => {
    const events = normalizeEsgMetrics(
      [makeRawRecord({ nb_points_of_observations: "" })],
      baseConfig,
      RUN_TS,
    );
    expect(events[0].attribute.nb_points_of_observations).toBeNull();
  });

  it("returns null for reported_date and metric_period when empty", () => {
    const events = normalizeEsgMetrics(
      [makeRawRecord({ reported_date: "", metric_period: "" })],
      baseConfig,
      RUN_TS,
    );
    expect(events[0].attribute.reported_date).toBeNull();
    expect(events[0].attribute.metric_period).toBeNull();
  });

  it("defaults missing string fields to empty string", () => {
    const events = normalizeEsgMetrics(
      [{ raw_row: { metric_year: "2022" }, source_file: "s3://b/f.csv", row_number: 1 }],
      baseConfig,
      RUN_TS,
    );
    const attr = events[0].attribute;
    expect(attr.permid).toBe("");
    expect(attr.company_name).toBe("");
    expect(attr.pillar).toBe("");
  });

  it("handles multiple records", () => {
    const records = [
      makeRawRecord({ permid: "111", metric_year: "2020" }),
      makeRawRecord({ permid: "222", metric_year: "2021" }),
      makeRawRecord({ permid: "333", metric_year: "2022" }),
    ];
    const events = normalizeEsgMetrics(records, baseConfig, RUN_TS);
    expect(events).toHaveLength(3);
    expect(events[0].attribute.permid).toBe("111");
    expect(events[1].attribute.permid).toBe("222");
    expect(events[2].attribute.permid).toBe("333");
    expect(events[0].time_object.timestamp).toBe("2020-01-01T00:00:00Z");
    expect(events[1].time_object.timestamp).toBe("2021-01-01T00:00:00Z");
    expect(events[2].time_object.timestamp).toBe("2022-01-01T00:00:00Z");
  });

  it("returns empty array for empty input", () => {
    const events = normalizeEsgMetrics([], baseConfig, RUN_TS);
    expect(events).toEqual([]);
  });
});
