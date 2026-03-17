import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { AggregationType } from "../../http/types/visualisation.types.js";

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

  const allEvents = await deps.dataLakeReader.getAllEvents();

  // Filter by event type
  const filtered = allEvents.filter((e) => e.event_type === event_type);

  // Group by dimension and aggregate
  const groups = new Map<string, { values: number[]; count: number }>();

  for (const event of filtered) {
    const attr = event.attribute as Record<string, unknown>;
    const categoryValue = getDimensionValue(attr, dimension, event);
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

/**
 * Extract dimension value from event attributes.
 * Handles special cases like derived fields (contract_year).
 */
function getDimensionValue(
  attr: Record<string, unknown>,
  dimension: string,
  event: EventRecord
): unknown {
  // Handle derived dimensions
  if (dimension === "contract_year") {
    const contractDate = attr.contract_date;
    if (typeof contractDate === "string" && contractDate.length >= 4) {
      return contractDate.slice(0, 4);
    }
    return "unknown";
  }

  // Direct attribute lookup
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
  // For "count" metric, just return the count
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