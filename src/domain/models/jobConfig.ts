/**
 * Domain model: Job configuration written to S3 config bucket.
 */

export interface SourceSpec {
  s3_uris?: string[];
  s3_prefix?: string;
  delimiter?: string;
  has_header?: boolean;
  timezone: string;
  time_column?: string;         // optional: CSV column to use as event timestamp
}

export interface JobConfig {
  job_id: string;
  connection_id: string;
  connector_type: string;       // "esg_csv_batch"
  source_spec: SourceSpec;
  mapping_profile: string;      // e.g. "esg_v1"
  data_source: string;          // e.g. "esg_csv"
  dataset_type: string;         // e.g. "esg_events"
  timezone: string;
  ingestion_mode: "incremental" | "full_refresh";
}
