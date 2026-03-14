/* eslint-disable @typescript-eslint/no-unused-vars */
import "reflect-metadata";
import { Controller, Get, Post, Route, Tags, Body, Path, Response, SuccessResponse } from "tsoa";
import { NotImplementedError } from "../../domain/errors.js";
import {
  PreprocessJobRequest,
  PreprocessJobAccepted,
  PreprocessJobStatusResponse,
  PipelinesResponse,
} from "../types/preprocessing.types.js";
import { ErrorBody } from "../types/common.types.js";

@Route("api/v1/preprocessing")
@Tags("Preprocessing")
export class PreprocessingController extends Controller {
  /**
   * Submit an asynchronous preprocessing job.
   * Accepts an S3 input URI and a pipeline name with optional parameters.
   * Returns a job_id immediately for status polling.
   */
  @Post("jobs")
  @SuccessResponse(202, "Job accepted and enqueued")
  @Response<ErrorBody>(400, "Validation error — missing required fields or unknown pipeline")
  @Response<ErrorBody>(501, "Not yet implemented")
  public async createJob(
    @Body() _body: PreprocessJobRequest
  ): Promise<PreprocessJobAccepted> {
    throw new NotImplementedError("POST /api/v1/preprocessing/jobs");
  }

  /**
   * Query the status and result locations of a submitted preprocessing job.
   * Returns output_s3_uri, manifest_uri, and quality_report_uri on success,
   * or an error message on failure.
   */
  @Get("jobs/{jobId}")
  @SuccessResponse(200, "Job status and result locations")
  @Response<ErrorBody>(404, "Job not found")
  @Response<ErrorBody>(501, "Not yet implemented")
  public async getJob(@Path("jobId") _jobId: string): Promise<PreprocessJobStatusResponse> {
    throw new NotImplementedError("GET /api/v1/preprocessing/jobs/:jobId");
  }

  /**
   * Returns the catalogue of built-in pipeline templates.
   * Each entry includes a unique id, human-readable name, category, and
   * a JSON Schema describing its accepted params.
   */
  @Get("pipelines")
  @SuccessResponse(200, "List of available pipeline templates")
  @Response<ErrorBody>(501, "Not yet implemented")
  public async getPipelines(): Promise<PipelinesResponse> {
    throw new NotImplementedError("GET /api/v1/preprocessing/pipelines");
  }
}
