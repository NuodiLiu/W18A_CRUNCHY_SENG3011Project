import "reflect-metadata";
import { Controller, Post, Get, Route, Tags, Body, Path, Response, SuccessResponse } from "tsoa";
import { importRequestSchema } from "../validators/importRequest.js";
import { presignRequestSchema } from "../validators/presignRequest.js";
import { multipartInitRequestSchema, multipartCompleteRequestSchema } from "../validators/multipartRequest.js";
import {
  createImportJob,
  CreateImportJobDeps,
} from "../../application/ingestion/createImportJob.js";
import { getJobStatus, GetJobStatusDeps } from "../../application/ingestion/getJobStatus.js";
import { presignUpload, PresignUploadDeps } from "../../application/uploads/presignUpload.js";
import { initMultipartUpload, MultipartInitDeps } from "../../application/uploads/multipartInit.js";
import { completeMultipartUpload, MultipartCompleteDeps } from "../../application/uploads/multipartComplete.js";
import { ValidationError, NotFoundError } from "../../domain/errors.js";
import {
  CreateImportBody,
  CreateImportResponse,
  JobStatusResponse,
} from "../types/collection.types.js";
import {
  PresignRequestBody,
  PresignResponse,
  MultipartInitRequestBody,
  MultipartInitResponse,
  MultipartCompleteRequestBody,
  MultipartCompleteResponse,
} from "../types/upload.types.js";
import { ErrorBody } from "../types/common.types.js";

export interface CollectionControllerDeps extends CreateImportJobDeps, GetJobStatusDeps, PresignUploadDeps, MultipartInitDeps, MultipartCompleteDeps {}

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
   * Generate a pre-signed S3 PUT URL for uploading a CSV file.
   * Use the returned s3_uri in POST /collection/imports as source_spec.s3_uris.
   */
  @Post("uploads/presign")
  @SuccessResponse(200, "Pre-signed URL generated")
  @Response<ErrorBody>(400, "Validation error")
  public async presignUpload(@Body() body: PresignRequestBody): Promise<PresignResponse> {
    const parsed = presignRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Presign request validation failed",
        parsed.error.flatten().fieldErrors
      );
    }
    return presignUpload(parsed.data.filename, parsed.data.content_type, this.deps);
  }

  /**
   * Initiate a multipart upload for files larger than 100 MB.
   * Returns an upload_id and a pre-signed PUT URL for each part.
   * Upload each part with a PUT request, then call uploads/multipart/complete.
   */
  @Post("uploads/multipart/init")
  @SuccessResponse(200, "Multipart upload initiated")
  @Response<ErrorBody>(400, "Validation error")
  public async initMultipartUpload(@Body() body: MultipartInitRequestBody): Promise<MultipartInitResponse> {
    const parsed = multipartInitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Multipart init request validation failed",
        parsed.error.flatten().fieldErrors
      );
    }
    return initMultipartUpload(parsed.data.filename, parsed.data.content_type, parsed.data.file_size, this.deps);
  }

  /**
   * Complete a multipart upload after all parts have been PUT to S3.
   * Provide the etag from each part response header to let S3 assemble the final object.
   */
  @Post("uploads/multipart/complete")
  @SuccessResponse(200, "Multipart upload completed")
  @Response<ErrorBody>(400, "Validation error")
  public async completeMultipartUpload(@Body() body: MultipartCompleteRequestBody): Promise<MultipartCompleteResponse> {
    const parsed = multipartCompleteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "Multipart complete request validation failed",
        parsed.error.flatten().fieldErrors
      );
    }
    return completeMultipartUpload(parsed.data.s3_uri, parsed.data.upload_id, parsed.data.parts, this.deps);
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
