export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type JobType = "import" | "preprocess";

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
  /** Discriminator: "import" (default) or "preprocess". */
  job_type?: JobType;
  /** Preprocessing-only: source dataset being cleaned. */
  source_dataset_id?: string;
  /** Preprocessing-only: pipeline name. */
  pipeline?: string;
  /** Preprocessing-only: pipeline params. */
  pipeline_params?: Record<string, unknown>;
  /** Preprocessing-only: quality report (populated on DONE). */
  quality_report?: Record<string, unknown>;
  // fan-out chunk tracking
  total_chunks?: number;
  chunks_done?: number;
}
