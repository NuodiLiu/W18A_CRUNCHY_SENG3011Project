import { EventRecord } from "../../domain/models/event.js";
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
): Promise<EventDatasetResponse> {

  const events = await deps.dataLakeReader.getAllEvents();

  let filtered: EventRecord[] = events;

  if (query.company_name) {
    filtered = filtered.filter(
      e => e.attribute.company_name === query.company_name
    );
  }

  if (query.permid) {
    filtered = filtered.filter(
      e => e.attribute.permid === query.permid
    );
  }

  if (query.metric_name) {
    filtered = filtered.filter(
      e => e.attribute.metric_name === query.metric_name
    );
  }

  if (query.pillar) {
    filtered = filtered.filter(
      e => e.attribute.pillar === query.pillar
    );
  }

  if (query.year_from) {
    filtered = filtered.filter(
      e => e.attribute.metric_year >= query.year_from!
    );
  }

  if (query.year_to) {
    filtered = filtered.filter(
      e => e.attribute.metric_year <= query.year_to!
    );
  }

  const total = filtered.length;

  const paginated = filtered.slice(
    query.offset,
    query.offset + query.limit
  );

  return {
    total_events: total,
    events: paginated
  };
}