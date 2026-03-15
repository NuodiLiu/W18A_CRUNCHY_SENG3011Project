import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { AggregationType } from "../../http/types/visualisation.types.js";

export interface TimeSeriesQuery {
  event_type?: string;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  time_period?: "year" | "month" | "day"; // storing based on time period
}

export interface TimeSeriesEntry {
  period: string;
  series?: string;
  value: number;
  count: number;
}

export interface TimeSeriesResult {
  metric: string;
  aggregation: string;
  event_type: string;
  time_period: string;
  dimension?: string;
  entries: TimeSeriesEntry[];
}

export interface GetTimeSeriesDeps {
  dataLakeReader: DataLakeReader;
}

/**
 * Aggregates event data by time period for line charts.
 * Optionally groups by a dimension (e.g., suburb) for multi-line charts.
 */
export async function getTimeSeries(
  query: TimeSeriesQuery,
  deps: GetTimeSeriesDeps
): Promise<TimeSeriesResult> {
  const {
    event_type = "housing_sale",
    dimension,
    metric = "count",
    aggregation = "sum",
    time_period = "year",
  } = query;

  const allEvents = await deps.dataLakeReader.getAllEvents();

  // Filter by event type
  const filtered = allEvents.filter((e) => e.event_type === event_type);

  // Group by time period and optionally by dimension
  // Structure: Map<period, Map<series, { values: number[], count: number }>>
  const groups = new Map<
    string,
    Map<string, { values: number[]; count: number }>
  >();

  for (const event of filtered) {
    const attr = event.attribute as Record<string, unknown>;
    
    const period = extractTimePeriod(event.time_object.timestamp, time_period);
    
    const series = dimension
      ? String(getDimensionValue(attr, dimension, event) ?? "unknown")
      : "total";

    if (!groups.has(period)) {
      groups.set(period, new Map());
    }
    const seriesMap = groups.get(period)!;
    if (!seriesMap.has(series)) {
      seriesMap.set(series, { values: [], count: 0 });
    }

    const group = seriesMap.get(series)!;
    group.count++;

    if (metric !== "count") {
      const metricValue = getMetricValue(attr, metric);
      if (metricValue !== null && !isNaN(metricValue)) {
        group.values.push(metricValue);
      }
    }
  }

  const entries: TimeSeriesEntry[] = [];
  const sortedPeriods = Array.from(groups.keys()).sort();

  for (const period of sortedPeriods) {
    const seriesMap = groups.get(period)!;
    for (const [series, group] of seriesMap.entries()) {
      entries.push({
        period,
        series: dimension ? series : undefined,
        value: calculateAggregation(group.values, group.count, aggregation, metric),
        count: group.count,
      });
    }
  }

  return {
    metric,
    aggregation,
    event_type,
    time_period,
    dimension,
    entries,
  };
}

/**
 * Extract time period from ISO timestamp based on granularity.
 */
function extractTimePeriod(timestamp: string, period: string): string {
  const date = new Date(timestamp);
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

/**
 * Extract dimension value from event attributes.
 */
function getDimensionValue(
  attr: Record<string, unknown>,
  dimension: string,
  event: any
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

/**
 * Extract metric value from event attributes.
 */
function getMetricValue(attr: Record<string, unknown>, metric: string): number | null {
  const value = attr[metric];
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Calculate aggregation over a set of values.
 */
function calculateAggregation(
  values: number[],
  count: number,
  aggregation: string,
  metric: string
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