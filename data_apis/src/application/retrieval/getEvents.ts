import {
  DataLakeReader,
  EventQuery,
  EventQueryResult,
} from "../../domain/ports/dataLakeReader.js";

export interface GetEventsDeps {
  dataLakeReader: DataLakeReader;
}

export async function getEvents(
  query: EventQuery,
  deps: GetEventsDeps
): Promise<EventQueryResult> {
  return deps.dataLakeReader.queryEvents(query);
}
