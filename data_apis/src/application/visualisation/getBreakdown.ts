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

/**
 * Aggregates event data by a dimension (e.g., suburb, pillar) for bar/pie charts.
 * Uses getGroupProjection to only fetch the fields needed for aggregation.
 */
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

  // Validate inputs against allowlist before building projection fields
  validateDimension(dimension);
  validateMetric(metric);
  validateAggregation(aggregation);

  // Only request the fields we actually need
  const fields = [dimensionProjectionField(dimension)];
  if (metric !== "count") {
    fields.push(`attribute.${metric}`);
  }

  const rows = await deps.dataLakeReader.getGroupProjection(fields, event_type);

  // Group by dimension and aggregate
  const groups = new Map<string, { values: number[]; count: number }>();

  for (const row of rows) {
    const attr = (row.attribute ?? {}) as Record<string, unknown>;
    const categoryValue = getDimensionValue(attr, dimension);
    const category = String(categoryValue ?? "unknown");

    if (!groups.has(category)) {
      groups.set(category, { values: [], count: 0 });
    }

    const group = groups.get(category)!;
    group.count++;

    // Only collect metric values if we need them for aggregation
    if (metric !== "count") {
      const metricValue = getMetricValue(attr, metric);
      if (metricValue !== null && !isNaN(metricValue)) {
        group.values.push(metricValue);
      }
    }
  }

  // Calculate aggregated values
  const entries = Array.from(groups.entries()).map(([category, group]) => ({
    category,
    value: calculateAggregation(group.values, group.count, aggregation, metric),
    count: group.count,
  }));

  // Sort by value descending and limit
  entries.sort((a, b) => b.value - a.value);
  const limited = entries.slice(0, limit);

  return {
    dimension,
    metric,
    aggregation,
    event_type,
    entries: limited,
  };
}