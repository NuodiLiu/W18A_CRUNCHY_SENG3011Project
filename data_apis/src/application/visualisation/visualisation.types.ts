/**
 * Visualisation types - shared between application and HTTP layers.
 * Located in application layer to avoid circular dependencies.
 */

// ─── Aggregation Types ────────────────────────────────────────────────────────

export type AggregationType = "avg" | "sum" | "count" | "min" | "max";

export const VALID_AGGREGATIONS: AggregationType[] = ["avg", "sum", "count", "min", "max"];

// ─── Breakdown Types (bar/pie charts) ─────────────────────────────────────────

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

// ─── Dimension/Metric Constants ───────────────────────────────────────────────

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
