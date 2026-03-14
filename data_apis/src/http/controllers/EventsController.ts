import "reflect-metadata";
import { Controller, Get, Route, Tags, Path, Query, Response, SuccessResponse } from "tsoa";
import { NotFoundError, NotImplementedError } from "../../domain/errors.js";
import {
  EventDatasetResponse,
  EventTypesResponse,
  EventStatsResponse,
  EventRecordResponse,
} from "../types/events.types.js";
import { ErrorBody } from "../types/common.types.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { getEventById } from "../../application/retrieval/getEventById.js";
import { getEventStats } from "../../application/retrieval/getEventStats.js";
import { toEventRecordResponseAuto } from "../mappers/eventsMapper.js";

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
  @Get("/")
  @SuccessResponse(200, "List of ESG metric events")
  @Response<ErrorBody>(501, "Not yet implemented")
  public async getEvents(
    @Query() company_name?: string,
    @Query() permid?: string,
    @Query() metric_name?: string,
    /** Environmental | Social | Governance */
    @Query() pillar?: string,
    @Query() year_from?: number,
    @Query() year_to?: number,
    @Query() limit: number = 50,
    @Query() offset: number = 0
  ): Promise<EventDatasetResponse> {
    throw new NotImplementedError("GET /api/v1/events");
  }

  /**
   * Returns the list of distinct event_type values present in the ingested dataset.
   * Useful for populating filter dropdowns in the reporting frontend.
   */
  @Get("types")
  @SuccessResponse(200, "Array of distinct event type strings")
  public async getEventTypes(): Promise<EventTypesResponse> {
    const eventTypes = await this.deps.dataLakeReader.getDistinctEventTypes();
    return { event_types: eventTypes };
  }

  /**
   * Returns aggregate statistics over the event dataset.
   * Supports grouping by ESG fields (pillar, company_name, metric_year, industry)
   * or Housing fields (suburb, postcode, zoning, contract_year, etc.).
   */
  @Get("stats")
  @SuccessResponse(200, "Aggregated statistics")
  public async getEventStats(
    /** Dimension to group by: pillar | company_name | metric_year | industry | suburb | postcode | zoning | contract_year */
    @Query() group_by?: string
  ): Promise<EventStatsResponse> {
    const stats = await getEventStats(group_by, this.deps);
    return { total_events: stats.total_events, groups: stats.groups };
  }

  /**
   * Retrieves a single EventRecord by its unique identifier.
   * Returns the time_object, event_type, and full attribute payload.
   */
  @Get("{eventId}")
  @SuccessResponse(200, "A single event record")
  @Response<ErrorBody>(404, "Event not found")
  public async getEventById(
    @Path() eventId: string
  ): Promise<EventRecordResponse> {
    const event = await getEventById(eventId, this.deps);
    if (!event) {
      throw new NotFoundError("Event", eventId);
    }
    return toEventRecordResponseAuto(event);
  }
}