/**
 * Domain model for aggregation concepts used in visualisation.
 *
 * Contains value-object validation, dimension/metric allowlists,
 * derived-dimension mapping, and aggregation computation — all
 * business rules that belong in the domain layer.
 */

import { ValidationError } from "../errors.js";

// ─── Aggregation Type ──────────────────────────────────────────────────────────

export type AggregationType = "avg" | "sum" | "count" | "min" | "max";

export const VALID_AGGREGATIONS: readonly AggregationType[] = [
  "avg",
  "sum",
  "count",
  "min",
  "max",
];

// ─── Dimension & Metric Allowlists ────────────────────────────────────────────

/** Housing sale event dimensions that can be used for grouping. */
export const HOUSING_DIMENSIONS = [
  "suburb",
  "postcode",
  "zoning",
  "nature_of_property",
  "primary_purpose",
  "contract_year",
] as const;

/** Housing sale event metrics that can be aggregated. */
export const HOUSING_METRICS = ["purchase_price", "area"] as const;

/** ESG metric event dimensions that can be used for grouping. */
export const ESG_DIMENSIONS = [
  "pillar",
  "company_name",
  "industry",
  "metric_year",
  "headquarter_country",
] as const;

/** ESG metric event metrics that can be aggregated. */
export const ESG_METRICS = ["metric_value"] as const;

const VALID_DIMENSIONS = new Set<string>([
  ...HOUSING_DIMENSIONS,
  ...ESG_DIMENSIONS,
]);

const VALID_METRICS = new Set<string>([...HOUSING_METRICS, ...ESG_METRICS]);

// ─── Validation (Value-Object guards) ──────────────────────────────────────────

export function validateDimension(dimension: string): void {
  if (!VALID_DIMENSIONS.has(dimension)) {
    throw new ValidationError(
      `Invalid dimension "${dimension}". Valid dimensions: ${[...VALID_DIMENSIONS].join(", ")}`,
    );
  }
}

export function validateMetric(metric: string): void {
  if (metric !== "count" && !VALID_METRICS.has(metric)) {
    throw new ValidationError(
      `Invalid metric "${metric}". Valid metrics: count, ${[...VALID_METRICS].join(", ")}`,
    );
  }
}

export function validateAggregation(aggregation: string): void {
  if (!(VALID_AGGREGATIONS as readonly string[]).includes(aggregation)) {
    throw new ValidationError(
      `Invalid aggregation "${aggregation}". Valid aggregations: ${VALID_AGGREGATIONS.join(", ")}`,
    );
  }
}

// ─── Derived Dimensions ────────────────────────────────────────────────────────

/**
 * Some dimensions are derived from a different source field in the event
 * attribute object (e.g. `contract_year` is derived from `contract_date`).
 */
export const DERIVED_DIMENSION_SOURCES: Record<string, string> = {
  contract_year: "contract_date",
};

/** Return the attribute path to project for a given dimension. */
export function dimensionProjectionField(dimension: string): string {
  const source = DERIVED_DIMENSION_SOURCES[dimension] ?? dimension;
  return `attribute.${source}`;
}

// ─── Attribute Extraction ──────────────────────────────────────────────────────

/** Extract the value for a dimension from event attributes. */
export function getDimensionValue(
  attr: Record<string, unknown>,
  dimension: string,
): unknown {
  if (dimension === "contract_year") {
    const contractDate = attr.contract_date;
    if (typeof contractDate === "string" && contractDate.length >= 4) {
      return contractDate.slice(0, 4);
    }
    return "unknown";
  }
  return attr[dimension];
}

/** Extract a numeric metric value from event attributes. */
export function getMetricValue(
  attr: Record<string, unknown>,
  metric: string,
): number | null {
  const value = attr[metric];
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

// ─── Aggregation Computation ───────────────────────────────────────────────────

/** Compute the aggregated value for a group. */
export function calculateAggregation(
  values: number[],
  count: number,
  aggregation: string,
  metric: string,
): number {
  if (metric === "count") {
    return count;
  }

  if (values.length === 0) return 0;

  switch (aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "count":
      return count;
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

// ─── Time Period Extraction ────────────────────────────────────────────────────

/** Extract a time-period bucket string from an ISO timestamp. Returns null for invalid dates. */
export function extractTimePeriod(
  timestamp: string,
  period: string,
): string | null {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  switch (period) {
    case "year":
      return String(year);
    case "month":
      return `${year}-${month}`;
    case "day":
      return `${year}-${month}-${day}`;
    default:
      return String(year);
  }
}
