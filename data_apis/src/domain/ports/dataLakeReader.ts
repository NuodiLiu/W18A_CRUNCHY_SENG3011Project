import { EventRecord } from "../models/event.js";

export interface DataLakeReader {
  getAllEvents(): Promise<EventRecord[]>;
}