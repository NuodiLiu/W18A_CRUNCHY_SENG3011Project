import { EventRecord, HousingSaleAttribute, TimeObject } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { EventDatasetResponse } from "../../http/types/events.types.js";

export interface GetEventsDeps {
  dataLakeReader: DataLakeReader;
}

export interface GetEventsQuery {
  suburb?: string;
  postcode?: string | number;
  zoning?: string;
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
  // uses option chaining ?.{} to safely call it only if present
  // metadata not available then falls back to default unknown vals

  const allEvents = await deps.dataLakeReader.getAllEvents();
  const metadata = await deps.dataLakeReader.getDatasetMetadata?.();
  const {
    dataset_id = "unknown",
    dataset_type = "unknown",
    data_source = "unknown",
    time_object = { timestamp: new Date().toISOString(), timezone: "UTC" },
  } = metadata ?? {};

  // Filter events
  let filtered: EventRecord<HousingSaleAttribute>[] = allEvents as EventRecord<HousingSaleAttribute>[];

  if (query.suburb) {
    filtered = filtered.filter(e => e.attribute.suburb === query.suburb);
  }
  
  if (query.postcode) {
    filtered = filtered.filter(e => String(e.attribute.postcode) === String(query.postcode));
  }

  if (query.zoning) {
    filtered = filtered.filter(e => e.attribute.zoning === query.zoning);
  }
  
  if (query.year_from !== undefined || query.year_to !== undefined) {
    filtered = filtered.filter(e => {
      const year = new Date(e.attribute.contract_date).getUTCFullYear();
      return (!query.year_from || year >= query.year_from) && (!query.year_to || year <= query.year_to);
    });
  }
  
  // Pagination
  const start = query.offset || 0;
  const end = start + (query.limit || filtered.length);
  const paginated = filtered.slice(start, end);

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