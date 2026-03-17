import { BreakdownResult } from "../../application/visualisation/getBreakdown.js";
import { TimeSeriesResult } from "../../application/visualisation/getTimeSeries.js";
import {
  BreakdownResponse,
  BreakdownEntry,
  TimeSeriesResponse,
  TimeSeriesDataPoint,
} from "@application/visualisation/visualisation.types.js";

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

function toBreakdownEntry(entry: {
  category: string;
  value: number;
  count: number;
}): BreakdownEntry {
  return {
    category: entry.category,
    value: entry.value,
    count: entry.count,
  };
}

/**
 * Maps the time series result from the application layer to the HTTP response format.
 */
export function toTimeSeriesResponse(result: TimeSeriesResult): TimeSeriesResponse {
  return {
    metric: result.metric,
    aggregation: result.aggregation,
    event_type: result.event_type,
    data: result.entries.map(toTimeSeriesDataPoint),
  };
}

function toTimeSeriesDataPoint(entry: {
  period: string;
  series?: string;
  value: number;
  count: number;
}): TimeSeriesDataPoint {
  return {
    period: entry.period,
    value: entry.value,
    series: entry.series,
  };
}