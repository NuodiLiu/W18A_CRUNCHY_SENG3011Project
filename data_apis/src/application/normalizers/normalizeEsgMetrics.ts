import { RawRecord } from "../../domain/ports/connector.js";
import { EventRecord } from "../../domain/models/event.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { randomUUID } from "node:crypto";

// converts raw csv rows into typed esg_metric event records
export function normalizeEsgMetrics(
  records: RawRecord[],
  config: JobConfig,
  runTimestamp: string,
): EventRecord[] {
  return records.map((r) => {
    const row = r.raw_row;
    const year = parseInt(row.metric_year, 10) || 0;
    const timestamp = year ? `${year}-01-01T00:00:00Z` : runTimestamp;

    // PK format is "COMP#4298015915" — extract the numeric id as permid
    const permid = (row.PK ?? row.permid ?? "").replace(/^COMP#/, "");

    return {
      event_id: randomUUID(),
      time_object: {
        timestamp,
        duration: 1,
        duration_unit: "year",
        timezone: config.timezone,
      },
      event_type: "esg_metric",
      attribute: {
        permid,
        company_name: row.company_name ?? "",
        metric_name: row.metric_name ?? "",
        metric_value: row.metric_value && row.metric_value !== "null"
          ? Number(row.metric_value)
          : null,
        metric_year: year,
        metric_unit: row.metric_unit ?? "",
        metric_description: row.metric_description ?? "",
        pillar: row.pillar ?? "",
        industry: row.industry ?? "",
        headquarter_country: row.headquarter_country ?? "",
        data_type: row.data_type ?? "",
        disclosure: row.disclosure ?? "",
        provider_name: row.provider_name ?? "",
        nb_points_of_observations: row.nb_points_of_observations && row.nb_points_of_observations !== "null"
          ? Number(row.nb_points_of_observations)
          : null,
        reported_date: row.reported_date && row.reported_date !== "null" ? row.reported_date : null,
        metric_period: row.metric_period && row.metric_period !== "null" ? row.metric_period : null,
      },
    };
  });
}
