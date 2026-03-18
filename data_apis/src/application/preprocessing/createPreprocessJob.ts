import { v4 as uuidv4 } from "uuid";
import { JobRecord } from "../../domain/models/job.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { QueueService } from "../../domain/ports/queueService.js";
import { ValidationError } from "../../domain/errors.js";
import { PIPELINE_CATALOGUE } from "./getPipelines.js";

export interface CreatePreprocessJobCommand {
  dataset_id: string;
  pipeline: string;
  params?: Record<string, unknown>;
}

export interface CreatePreprocessJobDeps {
  jobRepo: JobRepository;
  queue: QueueService;
}

export interface CreatePreprocessJobResult {
  job_id: string;
  status_url: string;
}

export async function createPreprocessJob(
  cmd: CreatePreprocessJobCommand,
  deps: CreatePreprocessJobDeps,
): Promise<CreatePreprocessJobResult> {
  if (!cmd.dataset_id) {
    throw new ValidationError("dataset_id is required");
  }

  const pipeline = PIPELINE_CATALOGUE.find((p) => p.id === cmd.pipeline);
  if (!pipeline) {
    throw new ValidationError(`unknown pipeline: ${cmd.pipeline}`);
  }

  const jobId = uuidv4();
  const now = new Date().toISOString();

  const jobRecord: JobRecord = {
    job_id: jobId,
    connection_id: `preprocess:${cmd.dataset_id}`,
    status: "PENDING",
    config_ref: "",
    created_at: now,
    updated_at: now,
    job_type: "preprocess",
    source_dataset_id: cmd.dataset_id,
    pipeline: cmd.pipeline,
    pipeline_params: cmd.params ?? {},
  };

  await deps.jobRepo.create(jobRecord);
  await deps.queue.sendMessage({
    job_id: jobId,
    job_type: "preprocess",
  });

  return {
    job_id: jobId,
    status_url: `/api/v1/preprocessing/jobs/${jobId}`,
  };
}
