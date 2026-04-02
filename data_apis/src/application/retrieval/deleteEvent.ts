import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";

export interface DeleteEventDeps {
  dataLakeReader: DataLakeReader;
}

export async function deleteEvent(
  eventId: string,
  deps: DeleteEventDeps
): Promise<boolean> {
  return deps.dataLakeReader.deleteEvent(eventId);
}