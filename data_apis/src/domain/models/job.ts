export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface JobRecord {
  job_id: string;
  connection_id: string;
  status: JobStatus;
  config_ref: string;
  dataset_id?: string;
  error?: string;
  lease_until?: string;
  created_at: string;
  updated_at: string;
}
