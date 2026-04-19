import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import {
  AggregationType,
  validateDimension,
  validateMetric,
  validateAggregation,
  DERIVED_DIMENSION_SOURCES,
} from "../../domain/models/aggregation.js";

export interface GetBreakdownDeps {
  dataLakeReader: DataLakeReader;
}

export interface BreakdownQuery {
  event_type?: string;
  dimension?: string;
  metric?: string;
  aggregation?: AggregationType;
  limit?: number;
}

export interface BreakdownResult {
  dimension: string;
  metric: string;
  aggregation: string;
  event_type: string;
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
    event_type = "housing_sale",
    dimension = "suburb",
    metric = "count",
    aggregation = "sum",
    limit = 10,
  } = query;

  validateDimension(dimension);
  validateMetric(metric);
  validateAggregation(aggregation);

  const dimField = DERIVED_DIMENSION_SOURCES[dimension] ?? dimension;
  const metricField = metric !== "count" ? metric : null;

  const rows = await deps.dataLakeReader.aggregateByDimension(
    event_type, dimField, metricField, aggregation, limit,
  );

  return {
    dimension,
    metric,
    aggregation,
    event_type,
    entries: rows.map((r) => ({
      category: r.group_key,
      value: metric === "count" ? r.count : r.value,
      count: r.count,
    })),
  };
}
