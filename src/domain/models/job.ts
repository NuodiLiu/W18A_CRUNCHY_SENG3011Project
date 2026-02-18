/**
 * Domain model: Job record stored in DynamoDB.
 */

export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface JobRecord {
  job_id: string;
  connection_id: string;
  status: JobStatus;
  config_ref: string;          // s3://bucket/configs/…
  dataset_id?: string;         // s3://bucket/datasets/…/manifest.json
  error?: string;
  lease_until?: string;        // ISO-8601
  created_at: string;          // ISO-8601
  updated_at: string;          // ISO-8601
}
