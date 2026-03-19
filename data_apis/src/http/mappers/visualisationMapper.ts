import { BreakdownResult } from "../../application/visualisation/getBreakdown.js";
import { BreakdownResponse, BreakdownEntry } from "../../application/visualisation/visualisation.types.js";

/**
 * Maps the breakdown result from the application layer to the HTTP response format.
 */
export function toBreakdownResponse(result: BreakdownResult): BreakdownResponse {
  return {
    dimension: result.dimension,
    metric: result.metric,
    aggregation: result.aggregation,
    event_type: result.event_type,
    entries: result.entries.map(toBreakdownEntry),
  };
}

function toBreakdownEntry(entry: { category: string; value: number; count: number }): BreakdownEntry {
  return {
    category: entry.category,
    value: entry.value,
    count: entry.count,
  };
}
