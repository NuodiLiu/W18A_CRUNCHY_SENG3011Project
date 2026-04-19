import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  DatasetType,
  DATASET_TYPE_MAP,
  validateDimension,
  validateMetric,
  validateAggregation,
  DERIVED_DIMENSION_SOURCES,
  ATTRIBUTE_COUNT_DATASETS,
} from "../../domain/models/aggregation.js";

export interface GetBreakdownDeps {
  dataLakeReader: DataLakeReader;
}

export interface BreakdownQuery {
  dataset_type?: DatasetType;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  limit?: number;
}

export interface BreakdownResult {
  dimension: string;
  metric: string;
  aggregation: string;
  dataset_type: string;
  entries: Array<{
    category: string;
    value: number;
    count: number;
  }>;
}

export async function getBreakdown(
  query: BreakdownQuery,
  deps: GetBreakdownDeps
): Promise<BreakdownResult> {
  const {
    dataset_type = "housing",
    dimension = "suburb",
    metric = "count",
    aggregation = "sum",
    limit = 10,
  } = query;

  validateDimension(dimension);
  validateMetric(metric);
  validateAggregation(aggregation);

  const eventType = DATASET_TYPE_MAP[dataset_type];
  const dimField = DERIVED_DIMENSION_SOURCES[dimension] ?? dimension;
  // For datasets where "count" is an actual numeric attribute field (e.g. crime),
  // pass it as the metricField so aggregation uses attribute->>'count' rather than COUNT(*).
  const metricField =
    metric !== "count" ? metric
    : ATTRIBUTE_COUNT_DATASETS.has(dataset_type) ? "count"
    : null;

  const rows = await deps.dataLakeReader.aggregateByDimension(
    eventType, dimField, metricField, aggregation, limit,
  );

  return {
    dimension,
    metric,
    aggregation,
    dataset_type,
    entries: rows.map((r) => ({
      category: r.group_key,
      value: metric === "count" && !ATTRIBUTE_COUNT_DATASETS.has(dataset_type) ? r.count : r.value,
      count: r.count,
    })),
  };
}
