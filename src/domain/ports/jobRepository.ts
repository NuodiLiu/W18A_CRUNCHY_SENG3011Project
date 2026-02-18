/**
 * Port: Job repository — persistence for job records.
 */

import { JobRecord, JobStatus } from "../models/job.js";

export interface JobRepository {
  /** Create a new job record with status=PENDING */
  create(job: JobRecord): Promise<void>;

  /** Find a job by ID. Returns undefined if not found. */
  findById(jobId: string): Promise<JobRecord | undefined>;

  /**
   * Claim a job: conditional update PENDING → RUNNING with lease_until.
   * Returns true if the claim succeeded, false if already claimed.
   */
  claimJob(jobId: string, leaseUntil: string): Promise<boolean>;

  /** Update job status (and optional fields like dataset_id, error). */
  updateStatus(
    jobId: string,
    status: JobStatus,
    extra?: Partial<Pick<JobRecord, "dataset_id" | "error">>
  ): Promise<void>;
}
