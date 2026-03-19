import { VisualisationReader, BreakdownResult, BreakdownQuery as DomainBreakdownQuery } from "../../domain/ports/dataLakeReader.js";

export interface GetBreakdownDeps {
  visualisationReader: VisualisationReader;
}

export interface BreakdownQuery {
  event_type?: string;
  dimension?: string;
  metric?: string;
  aggregation?: "avg" | "sum" | "count" | "min" | "max";
  limit?: number;
  year_from?: number;
  year_to?: number;
}

// Re-export for convenience
export { BreakdownResult };

/**
 * Aggregates event data by a dimension (e.g., suburb, pillar) for bar/pie charts.
 * Delegates to the data layer for efficient filtering and aggregation.
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
    year_from,
    year_to,
  } = query;

  // Delegate to data layer - filtering happens at database level
  return deps.visualisationReader.getAggregatedBreakdown({
    event_type,
    dimension,
    metric,
    aggregation,
    limit,
    year_from,
    year_to,
  });
}
