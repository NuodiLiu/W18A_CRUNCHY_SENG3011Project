import { JobRecord } from "../../domain/models/job.js";
import { CreatePreprocessJobResult } from "../../application/preprocessing/createPreprocessJob.js";
import {
  PreprocessJobAccepted,
  PreprocessJobStatusResponse,
  QualityReport,
} from "../types/preprocessing.types.js";

// outbound: use case result to http response
export function toPreprocessJobAccepted(result: CreatePreprocessJobResult): PreprocessJobAccepted {
  return {
    job_id: result.job_id,
    status_url: result.status_url,
  };
}

// outbound: job record to http status response
export function toPreprocessJobStatusResponse(job: JobRecord): PreprocessJobStatusResponse {
  return {
    job_id: job.job_id,
    status: job.status,
    pipeline: job.pipeline ?? "",
    source_dataset_id: job.source_dataset_id ?? "",
    output_dataset_id: job.dataset_id ?? null,
    quality_report: (job.quality_report as unknown as QualityReport) ?? null,
    error: job.error ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}
