import { EventRecord } from "../models/event.js";

export interface EventQuery {
  company_name?: string;
  permid?: string;
  metric_name?: string;
  pillar?: string;
  year_from?: number;
  year_to?: number;
  limit?: number;
  offset?: number;
}

export interface EventQueryResult {
  events: EventRecord[];
  total: number;
}

export interface DataLakeReader {
  queryEvents(query: EventQuery): Promise<EventQueryResult>;
  findEventById(eventId: string): Promise<EventRecord | undefined>;
  getDistinctEventTypes(): Promise<string[]>;
  /** Project only the fields needed for aggregation (avoids full record transfer). */
  getGroupProjection(fields: string[]): Promise<Record<string, unknown>[]>;
  /** Fetch all events without pagination (for aggregation/visualisation). */
  getAllEvents(): Promise<EventRecord[]>;
}