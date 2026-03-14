import { EventRecord, TimeObject } from "../models/event.js";

export interface DataLakeReader {
  getAllEvents(): Promise<EventRecord[]>;

   getDatasetMetadata?(): Promise<{
    dataset_id: string;
    dataset_type: string;
    data_source: string;
    time_object: TimeObject;
  }>;
}