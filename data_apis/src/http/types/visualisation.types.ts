/**
 * HTTP response types for visualisation endpoints.
 * These are consumed by frontend charting libraries or other services.
 */

// ─── Timeseries Endpoint (for teammate) ──────────────────────────────────────

export interface TimeSeriesDataPoint {
  /** Time period (e.g., "2020", "2020-Q1", "2020-01") */
  period: string;
  /** Aggregated value for this period */
  value: number;
  /** Series identifier when using group_by (e.g., suburb name, pillar) */
  series?: string;
}

export interface TimeSeriesResponse {
  /** The metric being aggregated (e.g., "purchase_price", "metric_value") */
  metric: string;
  /** Aggregation function used (avg, sum, count, min, max) */
  aggregation: string;
  /** Event type filter applied */
  event_type: string;
  /** Time series data points */
  data: TimeSeriesDataPoint[];
}

// ─── Breakdown Endpoint (bar charts) ─────────────────────────────────────────

export interface BreakdownEntry {
  /** Category label (e.g., suburb name, pillar name) */
  category: string;
  /** Aggregated value for this category */
  value: number;
  /** Number of events in this category */
  count: number;
}

export interface BreakdownResponse {
  /** The dimension used for grouping (e.g., "suburb", "pillar") */
  dimension: string;
  /** The metric being aggregated */
  metric: string;
  /** Aggregation function used */
  aggregation: string;
  /** Event type filter applied */
  event_type: string;
  /** Breakdown entries, sorted by value descending */
  entries: BreakdownEntry[];
}

// ─── Shared Types ────────────────────────────────────────────────────────────

export type AggregationType = "avg" | "sum" | "count" | "min" | "max";

export const VALID_AGGREGATIONS: AggregationType[] = ["avg", "sum", "count", "min", "max"];

/** Housing sale event dimensions that can be used for grouping */
export const HOUSING_DIMENSIONS = [
  "suburb",
  "postcode",
  "zoning",
  "nature_of_property",
  "primary_purpose",
  "contract_year",
] as const;

/** Housing sale event metrics that can be aggregated */
export const HOUSING_METRICS = ["purchase_price", "area"] as const;

/** ESG metric event dimensions that can be used for grouping */
export const ESG_DIMENSIONS = [
  "pillar",
  "company_name",
  "industry",
  "metric_year",
  "headquarter_country",
] as const;

/** ESG metric event metrics that can be aggregated */
export const ESG_METRICS = ["metric_value"] as const;
