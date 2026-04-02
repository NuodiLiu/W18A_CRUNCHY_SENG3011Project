import { v4 as uuidv4 } from "uuid";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { StateStore } from "../../domain/ports/stateStore.js";
import { DataLakeWriter } from "../../domain/ports/dataLakeWriter.js";
import { Connector } from "../../domain/ports/connector.js";
import { EventRepository } from "../../domain/ports/eventRepository.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { getNormalizer } from "../normalizers/index.js";
import { logger, emitMetric } from "../../infra/logger.js";

export interface RunJobDeps {
  jobRepo: JobRepository;
  configStore: ConfigStore;
  stateStore: StateStore;
  dataLakeWriter: DataLakeWriter;
  connectorFactory: (connectorType: string) => Connector;
  eventRepository?: EventRepository;
}

// message shape from SQS — chunk fields are present for fan-out jobs
export interface JobMessage {
  job_id: string;
  chunk_index?: number;
  start_byte?: number;
  end_byte?: number;
}

export async function runJob(msg: JobMessage, deps: RunJobDeps): Promise<void> {
  const { job_id: jobId, chunk_index, start_byte, end_byte } = msg;
  const isChunk = chunk_index != null;
  const jobStart = Date.now();

  logger.info({ jobId, chunk_index, start_byte, end_byte }, "chunk_started");

  try {
    const job = await deps.jobRepo.findById(jobId);
    if (!job) throw new Error(`job record disappeared: ${jobId}`);
    if (job.status === "DONE") {
      logger.info({ jobId }, "job_already_done");
      return;
    }

    // move to RUNNING on first touch (ignore if already RUNNING from another chunk)
    if (job.status === "PENDING") {
      try {
        const leaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await deps.jobRepo.claimJob(jobId, leaseUntil);
      } catch {
        // another chunk already claimed it, that's fine
      }
    }

    const config: JobConfig = await deps.configStore.getConfig(job.config_ref);
    const prevState = config.ingestion_mode === "incremental"
      ? await deps.stateStore.getState(config.connection_id)
      : undefined;

    const connector = deps.connectorFactory(config.connector_type);
    const datasetId = uuidv4();
    const runTimestamp = new Date().toISOString();
    const normalize = getNormalizer(config.mapping_profile);
    let totalEvents = 0;

    const newState = await connector.fetchIncremental(
      config.source_spec,
      prevState,
      async (batch) => {
        const events = normalize(batch, config, runTimestamp);
        await deps.dataLakeWriter.writeChunk(events, datasetId);
        if (deps.eventRepository) {
          await deps.eventRepository.writeEvents(events, datasetId);
        }
        totalEvents += events.length;
        emitMetric("EventsIngested", events.length, "Count", {
          service: "datalake-ingest-worker",
          datasetType: config.dataset_type,
        });
      },
      { startByte: start_byte, endByte: end_byte },
    );

    await deps.dataLakeWriter.finalise(datasetId, {
      data_source: config.data_source,
      dataset_type: config.dataset_type,
      time_object: { timestamp: runTimestamp, timezone: config.timezone },
      total_events: totalEvents,
    });

    // persist connector state for incremental mode
    if (config.ingestion_mode === "incremental") {
      await deps.stateStore.saveState({
        connection_id: config.connection_id,
        ...newState,
        updated_at: new Date().toISOString(),
      } as ConnectorState);
    }

    // if chunked, atomically increment and check if all chunks are done
    if (isChunk && job.total_chunks) {
      const done = await deps.jobRepo.incrementChunksDone(jobId);
      logger.info({ jobId, chunk_index, done, total: job.total_chunks, totalEvents }, "chunk_done");
      if (done >= job.total_chunks) {
        await deps.jobRepo.updateStatus(jobId, "DONE");
        logger.info({ jobId, totalChunks: job.total_chunks }, "all_chunks_done");
        emitMetric("ImportJobDone", 1, "Count", { service: "datalake-ingest-worker", datasetType: config.dataset_type });
      }
    } else {
      // non-chunked (small file): mark done directly
      await deps.jobRepo.updateStatus(jobId, "DONE", { dataset_id: `dataset:${datasetId}` });
      const durationMs = Date.now() - jobStart;
      logger.info({ jobId, totalEvents, durationMs }, "job_done");
      emitMetric("ImportJobDone", 1, "Count", { service: "datalake-ingest-worker", datasetType: config.dataset_type });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.jobRepo.updateStatus(jobId, "FAILED", { error: message });
    logger.error({ jobId, chunk_index, err }, "chunk_failed");
    emitMetric("ImportJobFailed", 1, "Count", { service: "datalake-ingest-worker" });
    throw err;
  }
}
