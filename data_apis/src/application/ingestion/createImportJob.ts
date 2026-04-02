import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { JobRecord } from "../../domain/models/job.js";
import { JobConfig, SourceSpec } from "../../domain/models/jobConfig.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { QueueService } from "../../domain/ports/queueService.js";
import { logger, emitMetric } from "../../infra/logger.js";

// target chunk size for fan-out parallel ingestion.
// 50MB per chunk keeps each lambda under 3 min. concurrency is controlled
// by the sqs event source mapping MaximumConcurrency (set to 2).
const CHUNK_SIZE = 50 * 1024 * 1024;

export interface CreateImportJobCommand {
  connector_type: string;
  source_spec: SourceSpec;
  mapping_profile: string;
  data_source: string;
  dataset_type: string;
  ingestion_mode: "incremental" | "full_refresh";
}

export interface CreateImportJobDeps {
  jobRepo: JobRepository;
  configStore: ConfigStore;
  queue: QueueService;
  s3?: S3Client;
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
  cmd: CreateImportJobCommand,
  deps: CreateImportJobDeps
): Promise<CreateImportJobResult> {
  const jobId = uuidv4();
  const canonicalSpec = canonicalizeSourceSpec(cmd.source_spec);
  const connectionId = computeConnectionId(
    cmd.connector_type,
    canonicalSpec,
    cmd.mapping_profile,
    cmd.dataset_type
  );

  const jobConfig: JobConfig = {
    job_id: jobId,
    connection_id: connectionId,
    connector_type: cmd.connector_type,
    source_spec: canonicalSpec,
    mapping_profile: cmd.mapping_profile,
    data_source: cmd.data_source,
    dataset_type: cmd.dataset_type,
    timezone: canonicalSpec.timezone,
    ingestion_mode: cmd.ingestion_mode,
  };

  const configRef = await deps.configStore.putConfig(
    connectionId,
    jobId,
    jobConfig
  );

  // compute chunks from s3 file sizes
  const chunks = await computeChunks(canonicalSpec, deps.s3);
  const totalChunks = Math.max(chunks.length, 1);

  const now = new Date().toISOString();
  const jobRecord: JobRecord = {
    job_id: jobId,
    connection_id: connectionId,
    status: "PENDING",
    config_ref: configRef,
    total_chunks: totalChunks,
    chunks_done: 0,
    created_at: now,
    updated_at: now,
  };
  await deps.jobRepo.create(jobRecord);

  // fan-out: one SQS message per chunk for parallel processing
  if (chunks.length <= 1) {
    await deps.queue.sendMessage({ job_id: jobId });
  } else {
    await Promise.all(
      chunks.map((chunk, i) =>
        deps.queue.sendMessage({
          job_id: jobId,
          chunk_index: i,
          start_byte: chunk.start,
          end_byte: chunk.end,
        })
      )
    );
  }

  logger.info(
    { jobId, connectionId, connectorType: cmd.connector_type, datasetType: cmd.dataset_type, totalChunks },
    "import_job_created",
  );
  emitMetric("ImportJobCreated", 1, "Count", { service: "datalake-ingest-api", datasetType: cmd.dataset_type });

  return {
    job_id: jobId,
    connection_id: connectionId,
    status_url: `/api/v1/collection/jobs/${jobId}`,
  };
}

// compute byte range chunks for each s3 object
interface ChunkRange { uri: string; start: number; end: number }

async function computeChunks(spec: SourceSpec, s3?: S3Client): Promise<ChunkRange[]> {
  if (!s3 || !spec.s3_uris || spec.s3_uris.length === 0) return [];

  const chunks: ChunkRange[] = [];
  for (const uri of spec.s3_uris) {
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const [, bucket, key] = match;

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const size = head.ContentLength ?? 0;

    if (size <= CHUNK_SIZE) {
      chunks.push({ uri, start: 0, end: size });
    } else {
      for (let start = 0; start < size; start += CHUNK_SIZE) {
        chunks.push({ uri, start, end: Math.min(start + CHUNK_SIZE, size) });
      }
    }
  }
  return chunks;
}

// Re-export helpers for unit testing
export { canonicalizeSourceSpec, computeConnectionId };
