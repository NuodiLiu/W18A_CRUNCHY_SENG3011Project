import "reflect-metadata";
import { Controller, Post, Get, Route, Tags, Body, Path, Response, SuccessResponse } from "tsoa";
import { importRequestSchema } from "../validators/importRequest.js";
import {
  createImportJob,
  CreateImportJobDeps,
} from "../../application/ingestion/createImportJob.js";
import { getJobStatus, GetJobStatusDeps } from "../../application/ingestion/getJobStatus.js";
import { ValidationError, NotFoundError } from "../../domain/errors.js";
import {
  CreateImportBody,
  CreateImportResponse,
  JobStatusResponse,
} from "../types/collection.types.js";
import { ErrorBody } from "../types/common.types.js";

export interface CollectionControllerDeps extends CreateImportJobDeps, GetJobStatusDeps {}

/** @Route("api/v1/collection") is handled by tsoa for Express routing */
@Route("api/v1/collection")
@Tags("Collection")
export class CollectionController extends Controller {
  constructor(private readonly deps: CollectionControllerDeps) {
    super();
  }

  /**
   * Submit a new ESG CSV batch import job.
   * Accepts an S3 source location, connector config, and ingestion mode.
   * Returns immediately with a job_id for asynchronous status polling.
   */
  @Post("imports")
  @SuccessResponse(202, "Job accepted and enqueued")
  @Response<ErrorBody>(400, "Validation error")
  public async createImport(@Body() body: CreateImportBody): Promise<CreateImportResponse> {
    // Runtime validation via Zod (stricter than tsoa's generated checks)
    const parsed = importRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Import request validation failed",
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await createImportJob(parsed.data, this.deps);
    this.setStatus(202);
    return {
      job_id: result.job_id,
      connection_id: result.connection_id,
      status_url: result.status_url,
    };
  }

  /**
   * Poll the status of a previously submitted import job.
   * Returns lifecycle fields including status, output location, and timestamps.
   */
  @Get("jobs/{jobId}")
  @Response<ErrorBody>(404, "Job not found")
  public async getJobStatus(@Path() jobId: string): Promise<JobStatusResponse> {
    const result = await getJobStatus(jobId, this.deps);
    if (!result) {
      throw new NotFoundError("Job", jobId);
    }
    return result;
  }
}
