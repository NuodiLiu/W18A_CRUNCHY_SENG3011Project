import { EsgMetricAttribute, HousingSaleAttribute } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";

export interface EventStatGroup {
  key: string;
  count: number;
}

export interface EventStats {
  total_events: number;
  groups: EventStatGroup[];
}

export interface GetEventStatsDeps {
  dataLakeReader: DataLakeReader;
}

// Map group_by param → the fields we need S3 Select to project
function getProjectionFields(groupBy?: string): string[] {
  switch (groupBy) {
    case "pillar":
    case "company_name":
    case "metric_year":
    case "industry":
      return ["event_type", `attribute.${groupBy}`];
    case "suburb":
    case "postcode":
    case "zoning":
    case "nature_of_property":
    case "primary_purpose":
      return ["event_type", `attribute.${groupBy}`];
    case "contract_year":
      return ["event_type", "attribute.contract_date"];
    default:
      return ["event_type"];
  }
}

function getGroupKey(row: Record<string, unknown>, groupBy?: string): string {
  if (!groupBy) return String(row.event_type ?? "unknown");

  const attr = (row.attribute ?? {}) as Record<string, unknown>;

  switch (groupBy) {
    case "pillar":
    case "company_name":
    case "industry":
    case "suburb":
    case "zoning":
    case "nature_of_property":
    case "primary_purpose":
      return String(attr[groupBy] ?? "unknown");
    case "metric_year":
    case "postcode":
      return String(attr[groupBy] ?? "unknown");
    case "contract_year": {
      const cd = attr.contract_date;
      return typeof cd === "string" && cd.length >= 4 ? cd.slice(0, 4) : "unknown";
    }
    default:
      return String(row.event_type ?? "unknown");
  }
}

export async function getEventStats(
  groupBy: string | undefined,
  deps: GetEventStatsDeps
): Promise<EventStats> {
  const fields = getProjectionFields(groupBy);
  const rows = await deps.dataLakeReader.getGroupProjection(fields);
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = getGroupKey(row, groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    total_events: rows.length,
    groups: Array.from(counts.entries()).map(([key, count]) => ({ key, count })),
  };
}