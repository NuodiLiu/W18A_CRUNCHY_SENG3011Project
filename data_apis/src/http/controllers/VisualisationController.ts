import "reflect-metadata";
import { Controller, Get, Route, Tags, Query, SuccessResponse } from "tsoa";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { getBreakdown } from "../../application/visualisation/getBreakdown.js";
import { getTimeSeries } from "../../application/visualisation/getTimeSeries.js";
import { toBreakdownResponse, toTimeSeriesResponse } from "../mappers/visualisationMapper.js";
import {
  BreakdownResponse,
  TimeSeriesResponse,
} from "../../application/visualisation/visualisation.types.js";
import { AggregationType } from "../../domain/models/aggregation.js";

export interface VisualisationControllerDeps {
  dataLakeReader: DataLakeReader;
}

@Route("api/v1/visualisation")
@Tags("Visualisation")
export class VisualisationController extends Controller {
  constructor(private readonly deps: VisualisationControllerDeps) {
    super();
  }

  /**
   * Returns aggregated data grouped by a dimension for bar/pie charts.
   */
  @Get("breakdown")
  @SuccessResponse(200, "Breakdown data for bar/pie charts")
  public async getBreakdown(
    @Query() event_type?: string,
    @Query() dimension?: string,
    @Query() metric?: string,
    @Query() aggregation?: AggregationType,
    @Query() limit?: number
  ): Promise<BreakdownResponse> {
    const result = await getBreakdown(
      {
        event_type,
        dimension,
        metric,
        aggregation,
        limit,
      },
      this.deps
    );
    return toBreakdownResponse(result);
  }

  /**
   * Returns time series data for line charts.
   * Aggregates events by time period, optionally grouped by a dimension for multi-line charts.
   */
  @Get("timeseries")
  @SuccessResponse(200, "Time series data for line charts")
  public async getTimeSeries(
    /** Event type to filter: "housing_sale" or "esg_metric" */
    @Query() event_type?: string,
    /** Time granularity: "year" | "month" | "day" (default: "year") */
    @Query() time_period?: "year" | "month" | "day",
    /** Optional dimension to group by for multi-line chart (e.g., "suburb", "pillar") */
    @Query() dimension?: string,
    /** Metric to aggregate (e.g., "purchase_price", "metric_value", or "count") */
    @Query() metric?: string,
    /** Aggregation function: "avg", "sum", "count", "min", "max" */
    @Query() aggregation?: AggregationType
  ): Promise<TimeSeriesResponse> {
    const result = await getTimeSeries(
      {
        event_type,
        dimension,
        metric,
        aggregation,
        time_period,
      },
      this.deps
    );
    return toTimeSeriesResponse(result);
  }
}