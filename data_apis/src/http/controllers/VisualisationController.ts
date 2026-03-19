import "reflect-metadata";
import { Controller } from "@tsoa/runtime";
import { Get, Route, Tags, Query, SuccessResponse } from "tsoa";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { getBreakdown } from "../../application/visualisation/getBreakdown.js";
import { AggregationType, BreakdownResponse } from "../../application/visualisation/visualisation.types.js";
import { toBreakdownResponse } from "../mappers/visualisationMapper.js";

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
   * Groups events by a category (e.g., suburb, pillar) and aggregates a metric (e.g., purchase_price).
   */
  @Get("breakdown")
  @SuccessResponse(200, "Breakdown data for bar/pie charts")
  public async getBreakdown(
    /** Event type to filter: "housing_sale" or "esg_metric" */
    @Query() event_type?: string,
    /** Dimension to group by (e.g., "suburb", "pillar", "zoning") */
    @Query() dimension?: string,
    /** Metric to aggregate (e.g., "purchase_price", "metric_value", or "count") */
    @Query() metric?: string,
    /** Aggregation function: "avg", "sum", "count", "min", "max" */
    @Query() aggregation?: AggregationType,
    /** Maximum number of categories to return (default: 10) */
    @Query() limit?: number,
    /** Filter: start year (inclusive) */
    @Query() year_from?: number,
    /** Filter: end year (inclusive) */
    @Query() year_to?: number
  ): Promise<BreakdownResponse> {
    const result = await getBreakdown(
      {
        event_type,
        dimension,
        metric,
        aggregation,
        limit,
        year_from,
        year_to,
      },
      this.deps
    );
    return toBreakdownResponse(result);
  }
}
