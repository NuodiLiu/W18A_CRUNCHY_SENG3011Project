/* eslint-disable @typescript-eslint/no-unused-vars */
import "reflect-metadata";
import { Controller, Get, Post, Route, Tags, Body, Path, Response, SuccessResponse } from "tsoa";
import { NotFoundError } from "../../domain/errors.js";
import {
  PreprocessJobRequest,
  PreprocessJobAccepted,
  PreprocessJobStatusResponse,
  PipelinesResponse,
} from "../types/preprocessing.types.js";
import { ErrorBody } from "../types/common.types.js";
import { getPipelines } from "../../application/preprocessing/getPipelines.js";
import { createPreprocessJob, CreatePreprocessJobDeps } from "../../application/preprocessing/createPreprocessJob.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { toPreprocessJobAccepted, toPreprocessJobStatusResponse } from "../mappers/preprocessingMapper.js";

export interface PreprocessingControllerDeps extends CreatePreprocessJobDeps {
  jobRepo: JobRepository;
}

@Route("api/v1/preprocessing")
@Tags("Preprocessing")
export class PreprocessingController extends Controller {
  constructor(private readonly deps: PreprocessingControllerDeps) {
    super();
  }

  /**
   * Submit an asynchronous preprocessing job.
   * Accepts a dataset_id and a pipeline name with optional parameters.
   * Returns a job_id immediately for status polling.
   */
  @Post("jobs")
  @SuccessResponse(202, "Job accepted and enqueued")
  @Response<ErrorBody>(400, "Validation error — missing required fields or unknown pipeline")
  public async createJob(
    @Body() _body: PreprocessJobRequest
  ): Promise<PreprocessJobAccepted> {
    this.setStatus(202);
    const result = await createPreprocessJob(
      {
        dataset_id: body.dataset_id,
        pipeline: body.pipeline,
        params: body.params,
      },
      this.deps,
    );
    return toPreprocessJobAccepted(result);
  }

  /**
   * Query the status and result of a submitted preprocessing job.
   * Returns output_dataset_id and quality_report on DONE.
   */
  @Get("jobs/{jobId}")
  @SuccessResponse(200, "Job status and result")
  @Response<ErrorBody>(404, "Job not found")
<<<<<<< HEAD
  public async getJob(@Path() jobId: string): Promise<PreprocessJobStatusResponse> {
    const job = await this.deps.jobRepo.findById(jobId);
    if (!job || job.job_type !== "preprocess") {
      throw new NotFoundError("Preprocessing job", jobId);
    }
    return toPreprocessJobStatusResponse(job);
=======
  @Response<ErrorBody>(501, "Not yet implemented")
  public async getJob(@Path("jobId") _jobId: string): Promise<PreprocessJobStatusResponse> {
    throw new NotImplementedError("GET /api/v1/preprocessing/jobs/:jobId");
>>>>>>> develop
  }

  /**
   * Returns the catalogue of built-in pipeline templates.
   * Each entry includes a unique id, human-readable name, category, and
   * a JSON Schema describing its accepted params.
   */
  @Get("pipelines")
  @SuccessResponse(200, "List of available pipeline templates")
  public async getPipelines(): Promise<PipelinesResponse> {
    return { pipelines: getPipelines() };
  }
}
