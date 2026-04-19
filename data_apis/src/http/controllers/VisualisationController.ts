import "reflect-metadata";
import { Controller, Get, Route, Tags, Query, Request, SuccessResponse } from "tsoa";
import type { Request as ExRequest } from "express";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { getBreakdown } from "../../application/visualisation/getBreakdown.js";
import { getTimeSeries } from "../../application/visualisation/getTimeSeries.js";
import { toBreakdownResponse, toTimeSeriesResponse } from "../mappers/visualisationMapper.js";
import {
  BreakdownResponse,
  TimeSeriesResponse,
} from "../../application/visualisation/visualisation.types.js";
import { AggregationType, DatasetType, parseFiltersParam } from "../../domain/models/aggregation.js";

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
   *
   * Accepts `filters[<attribute>]=<value>` (Rails/PHP bracket syntax) to narrow
   * the result set — e.g. `?filters[suburb]=Sydney&filters[postcode]=2000`
   * restricts the breakdown to events matching those attributes.
   */
  @Get("breakdown")
  @SuccessResponse(200, "Breakdown data for bar/pie charts")
  public async getBreakdown(
    @Request() req: ExRequest,
    @Query() dataset_type?: DatasetType,
    @Query() dimension?: string,
    @Query() metric?: string,
    @Query() aggregation?: AggregationType,
    @Query() limit?: number
  ): Promise<BreakdownResponse> {
    const filters = parseFiltersParam(req.query.filters);
    const result = await getBreakdown(
      {
        dataset_type,
        dimension,
        metric,
        aggregation,
        limit,
        filters,
      },
      this.deps
    );
    return toBreakdownResponse(result);
  }

  /**
   * Returns time series data for line charts.
   * Aggregates events by time period, optionally grouped by a dimension for multi-line charts.
   *
   * Accepts `filters[<attribute>]=<value>` (bracket syntax) to narrow the
   * result set — e.g. `?filters[suburb]=Sydney` returns the timeseries for
   * Sydney only.
   */
  @Get("timeseries")
  @SuccessResponse(200, "Time series data for line charts")
  public async getTimeSeries(
    @Request() req: ExRequest,
    @Query() dataset_type?: DatasetType,
    /** Time granularity: "year" | "month" | "day" (default: "year") */
    @Query() time_period?: "year" | "month" | "day",
    /** Optional dimension to group by for multi-line chart (e.g., "suburb", "pillar") */
    @Query() dimension?: string,
    /** Metric to aggregate (e.g., "purchase_price", "metric_value", or "count") */
    @Query() metric?: string,
    /** Aggregation function: "avg", "sum", "count", "min", "max" */
    @Query() aggregation?: AggregationType
  ): Promise<TimeSeriesResponse> {
    const filters = parseFiltersParam(req.query.filters);
    const result = await getTimeSeries(
      {
        dataset_type,
        dimension,
        metric,
        aggregation,
        time_period,
        filters,
      },
      this.deps
    );
    return toTimeSeriesResponse(result);
  }
}