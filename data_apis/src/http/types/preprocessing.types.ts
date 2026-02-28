export interface PreprocessJobRequest {
  /** S3 URI of the raw input file or prefix to preprocess. */
  input_s3_uri: string;
  /** Name of the built-in pipeline template to apply (e.g. "esg_clean_v1"). */
  pipeline: string;
  /** Optional pipeline-specific parameters. */
  params?: Record<string, unknown>;
  /** Optional idempotency key — re-submitting the same key returns the existing job. */
  idempotency_key?: string;
}

export interface PreprocessJobAccepted {
  job_id: string;
  /** URL to poll for job status. */
  status_url: string;
}

export type PreprocessJobStatusValue = "pending" | "running" | "succeeded" | "failed";

export interface PreprocessJobStatusResponse {
  job_id: string;
  status: PreprocessJobStatusValue;
  pipeline: string;
  input_s3_uri: string;
  /** S3 URI of the cleaned output file (populated on success). */
  output_s3_uri: string | null;
  /** S3 URI of the job manifest JSON (populated on success). */
  manifest_uri: string | null;
  /** S3 URI of the data quality report (populated on success). */
  quality_report_uri: string | null;
  /** Failure reason (populated on failure). */
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineParamsSchema {
  [key: string]: unknown;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  /** Pipeline category: general | time_series | text | esg */
  category: "general" | "time_series" | "text" | "esg";
  /** JSON Schema describing accepted params for this pipeline. */
  params_schema: PipelineParamsSchema;
}

export interface PipelinesResponse {
  pipelines: PipelineTemplate[];
}
