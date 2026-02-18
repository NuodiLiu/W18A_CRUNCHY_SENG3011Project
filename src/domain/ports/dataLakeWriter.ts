/**
 * Port: Data lake writer — write event datasets (segments + manifest) to S3.
 */

import { EventDataset } from "../models/event.js";

export interface DataLakeWriter {
  /**
   * Write the dataset to the data lake bucket.
   * Produces: datasets/<datasetId>/manifest.json
   *           datasets/<datasetId>/segments/part-XXXXX.jsonl
   *
   * @returns dataset_id — the S3 URI of manifest.json
   */
  writeDataset(dataset: EventDataset, datasetId: string): Promise<string>;
}
