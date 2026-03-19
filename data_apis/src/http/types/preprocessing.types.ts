export interface PreprocessJobRequest {
  /** ID of the source dataset to preprocess (from a prior import). */
  dataset_id: string;
  /** Name of the built-in pipeline template to apply (e.g. "housing_clean_v1"). */
  pipeline: string;
  /** Optional pipeline-specific parameters. */
  params?: Record<string, unknown>;
}

export interface PreprocessJobAccepted {
  job_id: string;
  /** URL to poll for job status. */
  status_url: string;
}

export type PreprocessJobStatusValue = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface QualityReport {
  input_count: number;
  output_count: number;
  removed: {
    zero_price: number;
    duplicates: number;
    invalid_date: number;
  };
  standardized: {
    suburb_uppercased: number;
    area_nullified: number;
    area_type_fixed: number;
    whitespace_trimmed: number;
  };
}

export interface PreprocessJobStatusResponse {
  job_id: string;
  status: PreprocessJobStatusValue;
  pipeline: string;
  source_dataset_id: string;
  /** Dataset ID of the cleaned output (populated on DONE). */
  output_dataset_id: string | null;
  /** Data quality report (populated on DONE). */
  quality_report: QualityReport | null;
  /** Failure reason (populated on FAILED). */
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
  /** Pipeline category: general | time_series | text | esg | housing */
  category: "general" | "time_series" | "text" | "esg" | "housing";
  /** JSON Schema describing accepted params for this pipeline. */
  params_schema: PipelineParamsSchema;
}

export interface PipelinesResponse {
  pipelines: PipelineTemplate[];
}
