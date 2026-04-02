import { JobRecord, JobStatus } from "../models/job.js";

export interface JobRepository {
  create(job: JobRecord): Promise<void>;
  findById(jobId: string): Promise<JobRecord | undefined>;

  // conditional update PENDING to RUNNING; returns false if already claimed
  claimJob(jobId: string, leaseUntil: string): Promise<boolean>;

  updateStatus(
    jobId: string,
    status: JobStatus,
    extra?: Partial<Pick<JobRecord, "dataset_id" | "error" | "quality_report">>
  ): Promise<void>;

  // atomically increment chunks_done; returns new value
  incrementChunksDone(jobId: string): Promise<number>;
}
