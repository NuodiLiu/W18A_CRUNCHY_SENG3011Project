import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  DatasetType,
  DATASET_TYPE_MAP,
  validateDimension,
  validateMetric,
  validateAggregation,
  DERIVED_DIMENSION_SOURCES,
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
  const metricField = metric !== "count" ? metric : null;

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
      value: metric === "count" ? r.count : r.value,
      count: r.count,
    })),
  };
}
