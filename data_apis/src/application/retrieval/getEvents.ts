import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader, EventQuery } from "../../domain/ports/dataLakeReader.js";

export interface GetEventsDeps {
  dataLakeReader: DataLakeReader;
}

export interface GetEventsResult {
  events: EventRecord[];
  total: number;
}

export async function getEvents(
  query: EventQuery,
  deps: GetEventsDeps,
): Promise<GetEventsResult> {
  return deps.dataLakeReader.queryEvents(query);
}
