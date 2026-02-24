import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { JobRecord } from "../../domain/models/job.js";
import { JobConfig, SourceSpec } from "../../domain/models/jobConfig.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { QueueService } from "../../domain/ports/queueService.js";
import { ImportRequestBody } from "../../http/validators/importRequest.js";

export interface CreateImportJobDeps {
  jobRepo: JobRepository;
  configStore: ConfigStore;
  queue: QueueService;
}

export interface CreateImportJobResult {
  job_id: string;
  connection_id: string;
  status_url: string;
}

// sort s3_uris and strip trailing slashes for deterministic hashing
function canonicalizeSourceSpec(spec: SourceSpec): SourceSpec {
  const canonical: SourceSpec = { ...spec };
  if (canonical.s3_uris) {
    canonical.s3_uris = [...canonical.s3_uris].sort();
  }
  if (canonical.s3_prefix) {
    canonical.s3_prefix = canonical.s3_prefix.replace(/\/+$/, "");
  }
  return canonical;
}

// connection_id = sha256(connector_type | canonical_source_spec | mapping_profile | dataset_type)
function computeConnectionId(
  connectorType: string,
  canonicalSpec: SourceSpec,
  mappingProfile: string,
  datasetType: string
): string {
  const payload = [
    connectorType,
    JSON.stringify(canonicalSpec),
    mappingProfile,
    datasetType,
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export async function createImportJob(
  body: ImportRequestBody,
  deps: CreateImportJobDeps
): Promise<CreateImportJobResult> {
  const jobId = uuidv4();
  const canonicalSpec = canonicalizeSourceSpec(body.source_spec as SourceSpec);
  const connectionId = computeConnectionId(
    body.connector_type,
    canonicalSpec,
    body.mapping_profile,
    body.dataset_type
  );

  const jobConfig: JobConfig = {
    job_id: jobId,
    connection_id: connectionId,
    connector_type: body.connector_type,
    source_spec: canonicalSpec,
    mapping_profile: body.mapping_profile,
    data_source: body.data_source,
    dataset_type: body.dataset_type,
    timezone: canonicalSpec.timezone,
    ingestion_mode: body.ingestion_mode,
  };

  const configRef = await deps.configStore.putConfig(
    connectionId,
    jobId,
    jobConfig
  );

  const now = new Date().toISOString();
  const jobRecord: JobRecord = {
    job_id: jobId,
    connection_id: connectionId,
    status: "PENDING",
    config_ref: configRef,
    created_at: now,
    updated_at: now,
  };
  await deps.jobRepo.create(jobRecord);

  await deps.queue.sendMessage({ job_id: jobId });

  return {
    job_id: jobId,
    connection_id: connectionId,
    status_url: `/api/v1/collection/jobs/${jobId}`,
  };
}

// Re-export helpers for unit testing
export { canonicalizeSourceSpec, computeConnectionId };
