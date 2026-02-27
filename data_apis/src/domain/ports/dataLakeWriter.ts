import { EventDataset } from "../models/event.js";

export interface DataLakeWriter {
  // returns dataset_id (s3 URI of manifest.json)
  writeDataset(dataset: EventDataset, datasetId: string): Promise<string>;
}
