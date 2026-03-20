import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  validateDimension,
  validateMetric,
  validateAggregation,
  dimensionProjectionField,
  getDimensionValue,
  getMetricValue,
  calculateAggregation,
  extractTimePeriod,
} from "../../domain/models/aggregation.js";

export interface TimeSeriesQuery {
  event_type?: string;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  time_period?: "year" | "month" | "day"; // How to bucket time periods
}

export interface TimeSeriesEntry {
  period: string; // "2020", "2020-01", "2020-01-15", etc.
  series?: string; // Category name if grouping by dimension (e.g., suburb name)
  value: number; // Aggregated metric value
  count: number; // Number of events in this period
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
 * Uses getGroupProjection to only fetch the fields needed for aggregation.
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

  // Validate inputs against allowlist before building projection fields
  if (dimension) {
    validateDimension(dimension);
  }
  validateMetric(metric);
  validateAggregation(aggregation);

  // Only request the fields we actually need
  const fields = ["time_object.timestamp"];
  if (dimension) {
    fields.push(dimensionProjectionField(dimension));
  }
  if (metric !== "count") {
    fields.push(`attribute.${metric}`);
  }

  const rows = await deps.dataLakeReader.getGroupProjection(fields, event_type);

  // Group by time period and optionally by dimension
  // Structure: Map<period, Map<series, { values: number[], count: number }>>
  const groups = new Map<
    string,
    Map<string, { values: number[]; count: number }>
  >();

  for (const row of rows) {
    const timeObj = (row.time_object ?? {}) as Record<string, unknown>;
    const attr = (row.attribute ?? {}) as Record<string, unknown>;

    // Extract period from time_object.timestamp
    const period = extractTimePeriod(String(timeObj.timestamp ?? ""), time_period);
    if (period === null) continue; // skip rows with invalid timestamps

    // Extract series (dimension) if grouping
    const series = dimension
      ? String(getDimensionValue(attr, dimension) ?? "unknown")
      : "total";

    // Initialize nested maps
    if (!groups.has(period)) {
      groups.set(period, new Map());
    }
    const seriesMap = groups.get(period)!;
    if (!seriesMap.has(series)) {
      seriesMap.set(series, { values: [], count: 0 });
    }

    const group = seriesMap.get(series)!;
    group.count++;

    // Collect metric values if needed
    if (metric !== "count") {
      const metricValue = getMetricValue(attr, metric);
      if (metricValue !== null && !isNaN(metricValue)) {
        group.values.push(metricValue);
      }
    }
  }

  // Flatten to entries and sort by period
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