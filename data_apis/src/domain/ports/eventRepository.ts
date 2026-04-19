import { EventRecord } from "../models/event.js";

/** Write-side port: persist normalised events to the queryable store. */
export interface EventRepository {
  writeEvents(events: EventRecord[], datasetId: string): Promise<void>;
  /** Signal that a batch import is complete so the read model can be refreshed. */
  refreshReadModel(): Promise<void>;
}
