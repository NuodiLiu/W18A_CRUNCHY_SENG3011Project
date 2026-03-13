import { JobRecord } from "../../domain/models/job.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";

export interface GetJobStatusDeps {
  jobRepo: JobRepository;
}

export interface JobStatusResult {
  job_id: string;
  connection_id: string;
  status: string;
  config_ref: string;
  dataset_id?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export async function getJobStatus(
  jobId: string,
  deps: GetJobStatusDeps
): Promise<JobStatusResult | undefined> {
  const job: JobRecord | undefined = await deps.jobRepo.findById(jobId);
  if (!job) return undefined;

  return {
    job_id: job.job_id,
    connection_id: job.connection_id,
    status: job.status,
    config_ref: job.config_ref,
    dataset_id: job.dataset_id,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}
