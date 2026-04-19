import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  validateDimension,
  validateMetric,
  validateAggregation,
  DERIVED_DIMENSION_SOURCES,
} from "../../domain/models/aggregation.js";

export interface TimeSeriesQuery {
  event_type?: string;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  time_period?: "year" | "month" | "day";
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

  if (dimension) validateDimension(dimension);
  validateMetric(metric);
  validateAggregation(aggregation);

  const dimField = dimension ? (DERIVED_DIMENSION_SOURCES[dimension] ?? dimension) : undefined;
  const metricField = metric !== "count" ? metric : null;

  const rows = await deps.dataLakeReader.aggregateByTimePeriod(
    event_type, time_period, metricField, aggregation, dimField,
  );

  return {
    metric,
    aggregation,
    event_type,
    time_period,
    dimension,
    entries: rows.map((r) => ({
      period: r.group_key,
      series: r.series_key,
      value: metric === "count" ? r.count : r.value,
      count: r.count,
    })),
  };
}
