/* eslint-disable @typescript-eslint/no-unused-vars */
import "reflect-metadata";
import { Controller, Get, Route, Tags, Path, Query, Response, SuccessResponse } from "tsoa";
import { NotImplementedError, NotFoundError } from "../../domain/errors.js";
import {
  EventDatasetResponse,
  EventTypesResponse,
  EventStatsResponse,
  EventRecordResponse,
  HousingSaleAttributeResponse
} from "../types/events.types.js";
import { ErrorBody } from "../types/common.types.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { getEventById } from "../../application/retrieval/getEventById.js";
import { getEventStats } from "../../application/retrieval/getEventStats.js";
import { getEvents } from "../../application/retrieval/getEvents.js";
import { getEventTypes } from "../../application/retrieval/getEventTypes.js";

export interface EventsControllerDeps {
  dataLakeReader: DataLakeReader;
}

@Route("api/v1/events")
@Tags("Events")
export class EventsController extends Controller {
  constructor(private readonly deps: EventsControllerDeps) {
      super();
    }
  /**
   * Query normalized ESG metric events from the data lake.
   * Supports filtering by company, metric name, ESG pillar, and year range.
   * Results are paginated via limit/offset.
   */
  @Get()
  @SuccessResponse(200, "List of housing events")
  public async getEvents(
    @Query() suburb?: string,
    @Query() postcode?: string | number,
    @Query() zoning?: string,
    @Query() year_from?: number,
    @Query() year_to?: number,
    @Query() limit: number = 50,
    @Query() offset: number = 0
  ): Promise<EventDatasetResponse> {
    return getEvents(
    {
      suburb,
      postcode,
      zoning,
      year_from: year_from ? Number(year_from) : undefined,
      year_to: year_to ? Number(year_to) : undefined,
      limit: Number(limit),
      offset: Number(offset)
    },
    this.deps
  );
  }

  /**
   * Returns the list of distinct event_type values present in the ingested dataset.
   * Useful for populating filter dropdowns in the reporting frontend.
   */
  @Get("types")
  @SuccessResponse(200, "Array of distinct event type strings")
  public async getEventTypes(): Promise<EventTypesResponse> {
    return getEventTypes(this.deps);
  }

  /**
   * Returns aggregate statistics over the ESG event dataset.
   * Supports grouping by pillar, company, year, or industry.
   */
  @Get("stats")
  @SuccessResponse(200, "Aggregated statistics")
  public async getEventStats(
    /** Dimension to group by: pillar | company_name | metric_year | industry */
    @Query() group_by?: string
  ): Promise<EventStatsResponse> {
    return getEventStats(group_by, this.deps);
  }

  /**
   * Retrieves a single ESG EventRecord by its unique identifier.
   * Returns the time_object, event_type, and full ESG metric attribute payload.
   */
  @Get("{eventId}")
  @SuccessResponse(200, "A single ESG metric event record")
  @Response<ErrorBody>(404, "Event not found")
  public async getEventById(
    @Path() eventId: string
  ): Promise<EventRecordResponse> {
    const event = await getEventById(eventId, this.deps);

    if (!event) {
      throw new NotFoundError("Event", eventId);
    }

    return event as EventRecordResponse;
  }
}