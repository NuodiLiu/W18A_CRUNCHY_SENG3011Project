/**
 * HTTP response types for visualisation endpoints.
 * These are consumed by frontend charting libraries or other services.
 * Domain types (dimensions, metrics, aggregation) live in domain/models/aggregation.ts.
 */

// ─── Timeseries Endpoint ──────────────────────────────────────

export interface TimeSeriesDataPoint {
    /** Time period (e.g., "2020", "2020-Q1", "2020-01") */
    period: string;
    /** Aggregated value for this period */
    value: number;
    /** Number of events in this period */
    count: number;
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
    /** Time granularity used (year, month, day) */
    time_period: string;
    /** Dimension used for grouping (if any) */
    dimension?: string;
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
