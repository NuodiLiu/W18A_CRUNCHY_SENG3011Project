import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  DatasetType,
  DATASET_TYPE_MAP,
  validateDimension,
  validateMetric,
  validateAggregation,
  validateFilterKey,
  DERIVED_DIMENSION_SOURCES,
  ATTRIBUTE_COUNT_DATASETS,
} from "../../domain/models/aggregation.js";

export interface TimeSeriesQuery {
  dataset_type?: DatasetType;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  time_period?: "year" | "month" | "day";
  filters?: Record<string, string>;
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
  dataset_type: string;
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
    dataset_type = "housing",
    dimension,
    metric = "count",
    aggregation = "sum",
    time_period = "year",
    filters,
  } = query;

  if (dimension) validateDimension(dimension);
  validateMetric(metric);
  validateAggregation(aggregation);
  if (filters) for (const k of Object.keys(filters)) validateFilterKey(k);

  const eventType = DATASET_TYPE_MAP[dataset_type];
  const dimField = dimension ? (DERIVED_DIMENSION_SOURCES[dimension] ?? dimension) : undefined;
  const metricField =
    metric !== "count" ? metric
    : ATTRIBUTE_COUNT_DATASETS.has(dataset_type) ? "count"
    : null;

  const resolvedFilters = filters
    ? Object.fromEntries(
        Object.entries(filters).map(([k, v]) => [DERIVED_DIMENSION_SOURCES[k] ?? k, v]),
      )
    : undefined;

  const rows = await deps.dataLakeReader.aggregateByTimePeriod(
    eventType, time_period, metricField, aggregation, dimField, resolvedFilters,
  );

  return {
    metric,
    aggregation,
    dataset_type,
    time_period,
    dimension,
    entries: rows.map((r) => ({
      period: r.group_key,
      series: r.series_key,
      value: metric === "count" && !ATTRIBUTE_COUNT_DATASETS.has(dataset_type) ? r.count : r.value,
      count: r.count,
    })),
  };
}
