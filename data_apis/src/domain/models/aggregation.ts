/**
 * Domain model for aggregation concepts used in visualisation.
 *
 * Contains value-object validation, dimension/metric allowlists,
 * derived-dimension mapping, and aggregation computation — all
 * business rules that belong in the domain layer.
 */

import { ValidationError } from "../errors.js";

// ─── Dataset type → DB event_type mapping ────────────────────────────────────

export type DatasetType =
  | "esg"
  | "housing"
  | "shopping_centre"
  | "school_enrolment"
  | "transport_facility"
  | "hsc_top_achiever"
  | "crime"
  | "abs_community_profile"
  | "nsw_population"
  | "nsw_weather"
  | "aus_population"
  | "aus_gdp";

export const DATASET_TYPE_MAP: Record<DatasetType, string> = {
  esg:                    "esg_metric",
  housing:                "housing_sale",
  shopping_centre:        "shopping_centre",
  school_enrolment:       "school_enrolment",
  transport_facility:     "transport_facility",
  hsc_top_achiever:       "distinguished_achiever",
  crime:                  "nsw_crime",
  abs_community_profile:  "abs_census_2021",
  nsw_population:         "nsw_population",
  nsw_weather:            "nsw_weather",
  aus_population:         "aus_population",
  aus_gdp:                "aus_gdp",
};

export function resolveEventType(datasetType: DatasetType): string {
  return DATASET_TYPE_MAP[datasetType];
}

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

export const SHOPPING_CENTRE_DIMENSIONS = ["suburb", "suburb_group"] as const;
export const SHOPPING_CENTRE_METRICS = ["stores"] as const;

export const SCHOOL_ENROLMENT_DIMENSIONS = ["school_code", "school_name", "census_year"] as const;
export const SCHOOL_ENROLMENT_METRICS = ["year_12_enrolment"] as const;

export const TRANSPORT_FACILITY_DIMENSIONS = ["suburb", "transport_mode"] as const;

export const HSC_TOP_ACHIEVER_DIMENSIONS = ["school", "course", "year"] as const;

export const CRIME_DIMENSIONS = ["suburb", "postcode", "offence_category"] as const;
export const CRIME_METRICS = ["count"] as const;

/** 2021 ABS Census Community Profile dimensions and metrics. */
export const ABS_COMMUNITY_PROFILE_DIMENSIONS = ["suburb", "sal_code"] as const;

/** NSW suburb-level population demographic breakdown (2016 & 2011 Census). */
export const NSW_POPULATION_DIMENSIONS = ["suburb", "lga", "category", "sub_category", "suburb_code"] as const;
export const NSW_POPULATION_METRICS = ["males", "females", "persons"] as const;

/** NSW monthly weather trends by suburb. */
export const NSW_WEATHER_DIMENSIONS = ["suburb", "lga", "month"] as const;
export const NSW_WEATHER_METRICS = ["avg_temp", "avg_rainfall"] as const;

/** Australian national population (quarterly). */
export const AUS_POPULATION_DIMENSIONS = ["country", "quarter", "year"] as const;
export const AUS_POPULATION_METRICS = ["population"] as const;

/** Australian national GDP (quarterly). */
export const AUS_GDP_DIMENSIONS = ["country", "quarter", "year"] as const;
export const AUS_GDP_METRICS = ["real_gdp_aud_millions", "nominal_gdp_aud_millions"] as const;

export const ABS_COMMUNITY_PROFILE_METRICS = [
  "total_population",
  "median_age",
  "median_mortgage_monthly",
  "median_rent_weekly",
  "median_personal_income_weekly",
  "median_household_income_weekly",
  "median_family_income_weekly",
  "owned_outright",
  "owned_mortgage",
  "rented_total",
  "separate_houses",
  "flats_apartments",
  "labour_force_pct",
  "unemployment_pct",
  "employed_fulltime",
  "employed_parttime",
  "unemployed",
] as const;

/**
 * Dataset types where the string "count" refers to a numeric attribute field
 * (i.e. attribute->>'count') rather than the "count rows" pseudo-metric.
 */
export const ATTRIBUTE_COUNT_DATASETS = new Set<DatasetType>(["crime"]);
export const DISTINGUISHED_ACHIEVER_DIMENSIONS = ["school", "course", "year"] as const;
/** Population event dimensions that can be used for grouping. */
export const POPULATION_DIMENSIONS = ["country", "quarter"] as const;

/** Population event metrics that can be aggregated. */
export const POPULATION_METRICS = ["population"] as const;

/** GDP event dimensions that can be used for grouping. */
export const GDP_DIMENSIONS = ["country"] as const;

/** GDP event metrics that can be aggregated. */
export const GDP_METRICS = ["gdp_value"] as const;

const VALID_DIMENSIONS = new Set<string>([
  ...HOUSING_DIMENSIONS,
  ...ESG_DIMENSIONS,
  ...SHOPPING_CENTRE_DIMENSIONS,
  ...SCHOOL_ENROLMENT_DIMENSIONS,
  ...TRANSPORT_FACILITY_DIMENSIONS,
  ...HSC_TOP_ACHIEVER_DIMENSIONS,
  ...CRIME_DIMENSIONS,
  ...ABS_COMMUNITY_PROFILE_DIMENSIONS,
  ...NSW_POPULATION_DIMENSIONS,
  ...NSW_WEATHER_DIMENSIONS,
  ...DISTINGUISHED_ACHIEVER_DIMENSIONS,
  ...AUS_POPULATION_DIMENSIONS,
  ...AUS_GDP_DIMENSIONS,
  ...POPULATION_DIMENSIONS,
  ...GDP_DIMENSIONS,
]);

const VALID_METRICS = new Set<string>([
  ...HOUSING_METRICS,
  ...ESG_METRICS,
  ...SHOPPING_CENTRE_METRICS,
  ...SCHOOL_ENROLMENT_METRICS,
  ...CRIME_METRICS,
  ...ABS_COMMUNITY_PROFILE_METRICS,
  ...NSW_POPULATION_METRICS,
  ...NSW_WEATHER_METRICS,
  ...AUS_POPULATION_METRICS,
  ...AUS_GDP_METRICS,
  ...POPULATION_METRICS,
  ...GDP_METRICS,
]);

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
