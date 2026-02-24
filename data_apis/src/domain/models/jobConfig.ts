export interface SourceSpec {
  s3_uris?: string[];
  s3_prefix?: string;
  delimiter?: string;
  has_header?: boolean;
  timezone: string;
  time_column?: string;
}

export interface JobConfig {
  job_id: string;
  connection_id: string;
  connector_type: string;
  source_spec: SourceSpec;
  mapping_profile: string;
  data_source: string;
  dataset_type: string;
  timezone: string;
  ingestion_mode: "incremental" | "full_refresh";
}
