import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { EventTypesResponse } from "../../http/types/events.types.js";

export interface GetEventTypesDeps {
  dataLakeReader: DataLakeReader;
}

export async function getEventTypes(
  deps: GetEventTypesDeps
): Promise<EventTypesResponse> {

  const events = await deps.dataLakeReader.getAllEvents();

  const types = new Set<string>();

  for (const event of events) {
    types.add(event.event_type);
  }

  return {
    event_types: Array.from(types)
  };
}