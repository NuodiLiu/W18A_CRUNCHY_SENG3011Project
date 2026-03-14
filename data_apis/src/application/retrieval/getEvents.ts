import { EventRecord, HousingSaleAttribute, TimeObject } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { EventDatasetResponse } from "../../http/types/events.types.js";

export interface GetEventsDeps {
  dataLakeReader: DataLakeReader;
}

export interface GetEventsQuery {
  company_name?: string;
  permid?: string;
  metric_name?: string;
  pillar?: string;
  year_from?: number;
  year_to?: number;
  limit: number;
  offset: number;
}

export async function getEvents(
  query: GetEventsQuery,
  deps: GetEventsDeps
): Promise<EventDatasetResponse<HousingSaleAttribute>> {

  // pull all events and metadata from the datalake
  const allEvents = await deps.dataLakeReader.getAllEvents();

  // case if no events exist
  if (allEvents.length === 0) {
    return {
      dataset_id: "-1",
      dataset_type: "N/A",
      data_source: "N/A",
      time_object: { timestamp: new Date().toISOString(), timezone: "UTC" },
      events: [],
    };
  }

  // Pull the dataset metadata from the datalake reader
  // uses option chaining ?.() to safely call it only if present
  // metadata not available then falls back to default unknown vals
  const { dataset_id, dataset_type, data_source, time_object }: {
    dataset_id: string;
    dataset_type: string;
    data_source: string;
    time_object: TimeObject;
  } = await (deps.dataLakeReader as any).getDatasetMetadata?.() ?? {
    dataset_id: "unknown",
    dataset_type: "unknown",
    data_source: "unknown",
    time_object: { timestamp: new Date().toISOString(), timezone: "UTC" },
  };

  // Filter events
  let filtered: EventRecord<HousingSaleAttribute>[] = allEvents as EventRecord<HousingSaleAttribute>[];

  if (query.company_name) {
    filtered = filtered.filter(e => e.attribute.company_name === query.company_name);
  }
  if (query.permid) {
    filtered = filtered.filter(e => e.attribute.permid === query.permid);
  }
  if (query.metric_name) {
    filtered = filtered.filter(e => e.attribute.metric_name === query.metric_name);
  }
  if (query.pillar) {
    filtered = filtered.filter(e => e.attribute.pillar === query.pillar);
  }
  if (query.year_from !== undefined) {
    filtered = filtered.filter(
      e => typeof e.attribute.metric_year === "number" && e.attribute.metric_year >= query.year_from!
    );
  }
  if (query.year_to !== undefined) {
    filtered = filtered.filter(
      e => typeof e.attribute.metric_year === "number" && e.attribute.metric_year <= query.year_to!
    );
  }

  const paginated = filtered.slice(query.offset, query.offset + query.limit);

  return {
    dataset_id,
    dataset_type,
    data_source,
    time_object,
    events: paginated.map(e => ({
      event_id: e.event_id,
      time_object: e.time_object,
      event_type: e.event_type,
      attribute: e.attribute,
    })),
  };
}