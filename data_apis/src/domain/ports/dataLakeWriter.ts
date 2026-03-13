import { EventRecord, TimeObject } from "../models/event.js";

export interface DatasetMetadata {
  data_source: string;
  dataset_type: string;
  time_object: TimeObject;
  total_events: number;
}

export interface DataLakeWriter {
  /** Write one batch of events as a single segment file. Call repeatedly before finalise(). */
  writeChunk(events: EventRecord[], datasetId: string): Promise<void>;
  /** Write the manifest and return the dataset URI (s3://…/manifest.json). */
  finalise(datasetId: string, metadata: DatasetMetadata): Promise<string>;
}
