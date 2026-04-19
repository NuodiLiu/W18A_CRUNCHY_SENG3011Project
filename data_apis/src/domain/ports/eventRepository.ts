import { EventRecord } from "../models/event.js";

/** Write-side port: persist normalised events to the queryable store. */
export interface EventRepository {
  writeEvents(events: EventRecord[], datasetId: string): Promise<void>;
}
