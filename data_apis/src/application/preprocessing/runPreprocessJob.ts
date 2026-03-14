import { v4 as uuidv4 } from "uuid";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";
import { DataLakeWriter } from "../../domain/ports/dataLakeWriter.js";
import { InternalError } from "../../domain/errors.js";
import {
  runHousingCleanBatch,
  createEmptyReport,
  resolveParams,
} from "./runHousingCleanPipeline.js";
import { QualityReport } from "../../http/types/preprocessing.types.js";

export interface RunPreprocessJobDeps {
  jobRepo: JobRepository;
  dataLakeReader: DataLakeReader;
  dataLakeWriter: DataLakeWriter;
}

const LEASE_DURATION_MS = 10 * 60 * 1000;

export async function runPreprocessJob(
  jobId: string,
  deps: RunPreprocessJobDeps,
): Promise<void> {
  const leaseUntil = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const claimed = await deps.jobRepo.claimJob(jobId, leaseUntil);
  if (!claimed) return;

  try {
    const job = await deps.jobRepo.findById(jobId);
    if (!job) throw new InternalError(`job record disappeared: ${jobId}`);
    if (job.job_type !== "preprocess") throw new InternalError(`not a preprocess job: ${jobId}`);

    const sourceDatasetId = job.source_dataset_id!;
    const pipeline = job.pipeline!;
    const params = job.pipeline_params ?? {};

    const pipelineFn = getPipelineFn(pipeline);
    const outputDatasetId = uuidv4();
    const report = createEmptyReport();
    const seenDealings = new Set<number>();

    // read segment, clean batch, write segment
    await deps.dataLakeReader.readDataset(sourceDatasetId, async (batch) => {
      const cleaned = pipelineFn(batch, params, report, seenDealings);
      if (cleaned.length > 0) {
        await deps.dataLakeWriter.writeChunk(cleaned, outputDatasetId);
      }
    });

    await deps.dataLakeWriter.finalise(outputDatasetId, {
      data_source: "preprocessing",
      dataset_type: `${pipeline}_output`,
      time_object: {
        timestamp: new Date().toISOString(),
        timezone: "UTC",
      },
      total_events: report.output_count,
    });

    await deps.jobRepo.updateStatus(jobId, "DONE", {
      dataset_id: outputDatasetId,
      quality_report: report as unknown as Record<string, unknown>,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.jobRepo.updateStatus(jobId, "FAILED", { error: message });
    throw err;
  }
}

function getPipelineFn(pipeline: string) {
  switch (pipeline) {
    case "housing_clean_v1":
      return (
        events: Parameters<typeof runHousingCleanBatch>[0],
        rawParams: Record<string, unknown>,
        report: QualityReport,
        seenDealings: Set<number>,
      ) => runHousingCleanBatch(events, resolveParams(rawParams), report, seenDealings);
    default:
      throw new InternalError(`unsupported pipeline: ${pipeline}`);
  }
}
