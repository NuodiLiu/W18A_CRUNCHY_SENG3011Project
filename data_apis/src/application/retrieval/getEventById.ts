import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";

export interface GetEventByIdDeps {
  dataLakeReader: DataLakeReader;
}

export async function getEventById(
  eventId: string,
  deps: GetEventByIdDeps
): Promise<EventRecord | undefined> {
  return deps.dataLakeReader.findEventById(eventId);
}