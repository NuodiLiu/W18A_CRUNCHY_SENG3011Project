import {
  CreateImportJobCommand,
  CreateImportJobResult,
} from "../../application/ingestion/createImportJob.js";
import { JobStatusResult } from "../../application/ingestion/getJobStatus.js";
import {
  CreateImportBody,
  CreateImportResponse,
  JobStatusResponse,
} from "../types/collection.types.js";

// Inbound: HTTP request body → Application command
export function toCreateImportJobCommand(body: CreateImportBody): CreateImportJobCommand {
  return {
    connector_type: body.connector_type,
    source_spec: {
      s3_uris: body.source_spec.s3_uris,
      s3_prefix: body.source_spec.s3_prefix,
      delimiter: body.source_spec.delimiter,
      has_header: body.source_spec.has_header,
      timezone: body.source_spec.timezone,
      time_column: body.source_spec.time_column,
    },
    mapping_profile: body.mapping_profile,
    data_source: body.data_source,
    dataset_type: body.dataset_type,
    ingestion_mode: body.ingestion_mode,
  };
}

// Outbound: Application result → HTTP response DTO
export function toCreateImportResponse(result: CreateImportJobResult): CreateImportResponse {
  return {
    job_id: result.job_id,
    connection_id: result.connection_id,
    status_url: result.status_url,
  };
}

export function toJobStatusResponse(result: JobStatusResult): JobStatusResponse {
  return {
    job_id: result.job_id,
    connection_id: result.connection_id,
    status: result.status,
    // config_ref intentionally excluded — internal infra detail
    dataset_id: result.dataset_id,
    error: result.error,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}
