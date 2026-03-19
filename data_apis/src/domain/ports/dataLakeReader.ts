import { EventRecord } from "../models/event.js";

// ─── Visualisation Query Types ────────────────────────────────────────────────

export interface BreakdownQuery {
  /** Event type to filter: "housing_sale" or "esg_metric" */
  event_type: string;
  /** Dimension to group by (e.g., "suburb", "pillar") */
  dimension: string;
  /** Metric to aggregate (e.g., "purchase_price", "metric_value", or "count") */
  metric: string;
  /** Aggregation function: "avg", "sum", "count", "min", "max" */
  aggregation: "avg" | "sum" | "count" | "min" | "max";
  /** Maximum number of categories to return */
  limit?: number;
  /** Filter: start year (inclusive) */
  year_from?: number;
  /** Filter: end year (inclusive) */
  year_to?: number;
}

export interface BreakdownResultEntry {
  category: string;
  value: number;
  count: number;
}

export interface BreakdownResult {
  dimension: string;
  metric: string;
  aggregation: string;
  event_type: string;
  entries: BreakdownResultEntry[];
}

// ─── Retrieval Query Types ────────────────────────────────────────────────────

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
  /** Read all events from a specific dataset, invoking the callback per-segment for streaming. */
  readDataset(
    datasetId: string,
    onBatch: (events: EventRecord[]) => Promise<void>,
  ): Promise<void>;
  /** Fetch all events without pagination (for aggregation/visualisation). */
  getAllEvents(): Promise<EventRecord[]>;
}

// ─── Visualisation-specific interface (separate from DataLakeReader) ─────────

export interface VisualisationReader {
  /** Get aggregated breakdown data for visualisation (filters and aggregates at database level). */
  getAggregatedBreakdown(query: BreakdownQuery): Promise<BreakdownResult>;
}