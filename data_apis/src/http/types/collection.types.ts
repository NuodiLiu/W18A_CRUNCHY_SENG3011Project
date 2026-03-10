// TypeScript interfaces used by tsoa for OpenAPI spec generation.
// Runtime validation is still handled by Zod schemas in validators/.

export interface SourceSpecBody {
  /** One or more S3 URIs pointing to the CSV files to import. Required if s3_prefix is not provided. */
  s3_uris?: string[];
  /** S3 URI prefix to scan recursively for CSV files. Required if s3_uris is not provided. */
  s3_prefix?: string;
  /** Column delimiter character. Defaults to comma. */
  delimiter?: string;
  /** Whether the CSV file has a header row. Defaults to true. */
  has_header?: boolean;
  /** IANA timezone string for timestamps in the source file (e.g. "UTC", "Australia/Sydney"). */
  timezone: string;
  /** Name of the column to use as the event timestamp. */
  time_column?: string;
}

export interface CreateImportBody {
  /** Must be "esg_csv_batch" for this connector. */
  connector_type: "esg_csv_batch";
  source_spec: SourceSpecBody;
  /** Mapping profile name to apply during normalisation (e.g. "esg_v1"). */
  mapping_profile: string;
  /** Human-readable data source label (e.g. "Refinitiv"). */
  data_source: string;
  /** Dataset type tag (e.g. "ESG"). */
  dataset_type: string;
  /** "incremental" only processes new/updated rows; "full_refresh" replaces the dataset. */
  ingestion_mode: "incremental" | "full_refresh";
  /** Optional idempotency key — re-submitting the same key returns the original job. */
  idempotency_key?: string;
}

export interface CreateImportResponse {
  /** UUID of the created import job. */
  job_id: string;
  /** Deterministic SHA-256 hash identifying the connection (source config). */
  connection_id: string;
  /** URL to poll for job status. */
  status_url: string;
}

export interface JobStatusResponse {
  job_id: string;
  connection_id: string;
  /** Current lifecycle state: PENDING | RUNNING | DONE | FAILED */
  status: string;
  /** Dataset ID written to the data lake (populated on success). */
  dataset_id?: string;
  /** Failure reason (populated on failure). */
  error?: string;
  created_at: string;
  updated_at: string;
}
