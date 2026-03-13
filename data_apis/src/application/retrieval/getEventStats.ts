import { EventRecord, HousingSaleAttribute } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { EventStatsResponse } from "../../http/types/events.types.js";

export interface GetEventStatsDeps {
  dataLakeReader: DataLakeReader;
}

function getContractYear(attribute: Record<string, unknown>): string {
  const contractDate = attribute.contract_date;

  if (typeof contractDate !== "string" || contractDate.length < 4) {
    return "unknown";
  }

  return contractDate.slice(0, 4);
}

function getGroupKey(event: EventRecord, groupBy?: string): string {
  if (!groupBy) {
    return event.event_type;
  }

  const attribute = event.attribute as HousingSaleAttribute & Record<string, unknown>;

  switch (groupBy) {
    case "suburb":
      return String(attribute.suburb ?? "unknown");
    case "postcode":
      return String(attribute.postcode ?? "unknown");
    case "zoning":
      return String(attribute.zoning ?? "unknown");
    case "nature_of_property":
      return String(attribute.nature_of_property ?? "unknown");
    case "primary_purpose":
      return String(attribute.primary_purpose ?? "unknown");
    case "contract_year":
      return getContractYear(attribute);
    default:
      return event.event_type;
  }
}

export async function getEventStats(
  groupBy: string | undefined,
  deps: GetEventStatsDeps
): Promise<EventStatsResponse> {
  const events = await deps.dataLakeReader.getAllEvents();
  const counts = new Map<string, number>();

  for (const event of events) {
    const key = getGroupKey(event, groupBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    total_events: events.length,
    groups: Array.from(counts.entries()).map(([key, count]) => ({
      key,
      count,
    })),
  };
}