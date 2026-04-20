import { EventRecord } from "../models/event.js";
import { DatasetType } from "../models/aggregation.js";

export interface EventQuery {
  dataset_type?: DatasetType;

  //esg
  company_name?: string;
  permid?: string;
  metric_name?: string;
  pillar?: string;
  year_from?: number;
  year_to?: number;

  //housing ones
  postcode?: number;
  suburb?: string;
  street_name?: string;
  nature_of_property?: string;

  // crime
  offence_category?: string;

  //pagination
  limit?: number;
  offset?: number;
}

export interface EventQueryResult {
  events: EventRecord[];
  total: number;
}

// result row from SQL-level aggregation
export interface AggRow {
  group_key: string;        // dimension value or time period
  series_key?: string;      // secondary grouping (e.g. suburb for multi-line)
  value: number;
  count: number;
}

export interface DataLakeReader {
  queryEvents(query: EventQuery): Promise<EventQueryResult>;
  findEventById(eventId: string): Promise<EventRecord | undefined>;
  deleteEvent(eventId: string): Promise<boolean>;
  getDistinctEventTypes(): Promise<string[]>;
  getGroupProjection(fields: string[], eventType?: string): Promise<Record<string, unknown>[]>;
  readDataset(
    datasetId: string,
    onBatch: (events: EventRecord[]) => Promise<void>,
  ): Promise<void>;

  // sql-level aggregation for visualisation (avoids reading all rows into memory)
  aggregateByDimension(
    eventType: string,
    dimensionField: string,
    metricField: string | null,
    aggregation: string,
    limit: number,
    filters?: Record<string, string>,
  ): Promise<AggRow[]>;

  aggregateByTimePeriod(
    eventType: string,
    timePeriod: "year" | "month" | "day",
    metricField: string | null,
    aggregation: string,
    dimensionField?: string,
    filters?: Record<string, string>,
  ): Promise<AggRow[]>;
}