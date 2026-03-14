import { EventRecord, EsgMetricAttribute, HousingSaleAttribute } from "../../domain/models/event.js";
import { DataLakeReader, EventQuery } from "../../domain/ports/dataLakeReader.js";

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

function getGroupKey(event: EventRecord, groupBy?: string): string {
  if (!groupBy) return event.event_type;

  const attr = event.attribute as Record<string, unknown>;

  switch (groupBy) {
    // ESG fields
    case "pillar":
      return String((attr as Partial<EsgMetricAttribute>).pillar ?? "unknown");
    case "company_name":
      return String((attr as Partial<EsgMetricAttribute>).company_name ?? "unknown");
    case "metric_year":
      return String((attr as Partial<EsgMetricAttribute>).metric_year ?? "unknown");
    case "industry":
      return String((attr as Partial<EsgMetricAttribute>).industry ?? "unknown");
    // Housing fields
    case "suburb":
      return String((attr as Partial<HousingSaleAttribute>).suburb ?? "unknown");
    case "postcode":
      return String((attr as Partial<HousingSaleAttribute>).postcode ?? "unknown");
    case "zoning":
      return String((attr as Partial<HousingSaleAttribute>).zoning ?? "unknown");
    case "nature_of_property":
      return String((attr as Partial<HousingSaleAttribute>).nature_of_property ?? "unknown");
    case "primary_purpose":
      return String((attr as Partial<HousingSaleAttribute>).primary_purpose ?? "unknown");
    case "contract_year": {
      const cd = (attr as Partial<HousingSaleAttribute>).contract_date;
      return typeof cd === "string" && cd.length >= 4 ? cd.slice(0, 4) : "unknown";
    }
    default:
      return event.event_type;
  }
}

export async function getEventStats(
  groupBy: string | undefined,
  deps: GetEventStatsDeps
): Promise<EventStats> {
  // Load all events (no filter, no pagination limit)
  const { events } = await deps.dataLakeReader.queryEvents({ limit: Number.MAX_SAFE_INTEGER } as EventQuery);
  const counts = new Map<string, number>();

  for (const event of events) {
    const key = getGroupKey(event, groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    total_events: events.length,
    groups: Array.from(counts.entries()).map(([key, count]) => ({ key, count })),
  };
}