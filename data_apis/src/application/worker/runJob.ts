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
  /** When provided, events are also written to the queryable event store (dual-write). */
  eventRepository?: EventRepository;
}

// must exceed lambda timeout (900s) so the lease expires only after the
// function is killed, allowing sqs redelivery to re-claim the job.
const LEASE_DURATION_MS = 16 * 60 * 1000; // 16 min

// orchestrates a single import job end-to-end
export async function runJob(jobId: string, deps: RunJobDeps): Promise<void> {
  const leaseUntil = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const claimed = await deps.jobRepo.claimJob(jobId, leaseUntil);
  if (!claimed) {
    logger.info({ jobId }, "job_already_claimed");
    return;
  }

  const jobStart = Date.now();
  logger.info({ jobId }, "job_started");

  try {
    const job = await deps.jobRepo.findById(jobId);
    if (!job) throw new Error(`job record disappeared: ${jobId}`);

    const config: JobConfig = await deps.configStore.getConfig(job.config_ref);
    const prevState = config.ingestion_mode === "incremental"
      ? await deps.stateStore.getState(config.connection_id)
      : undefined;

    // resume from checkpoint if this job was previously interrupted
    const skipRows = job.rows_processed ?? 0;
    const skipSegments = job.segments_written ?? 0;
    if (skipRows > 0) {
      logger.info({ jobId, skipRows, skipSegments }, "resuming_from_checkpoint");
    }

    const connector = deps.connectorFactory(config.connector_type);
    const datasetId = uuidv4();
    const runTimestamp = new Date().toISOString();
    const normalize = getNormalizer(config.mapping_profile);
    let totalEvents = skipRows;
    let segmentsWritten = skipSegments;

    // stream records in batches: fetch -> normalize -> write one segment at a time.
    // peak memory = one batch of rows, not the full dataset.
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
        segmentsWritten++;
        emitMetric("EventsIngested", events.length, "Count", {
          service: "datalake-ingest-worker",
          datasetType: config.dataset_type,
        });
        // save checkpoint so the job can resume if lambda times out
        await deps.jobRepo.updateCheckpoint(jobId, totalEvents, segmentsWritten);
      },
      { skipRows },
    );

    const datasetUri = await deps.dataLakeWriter.finalise(datasetId, {
      data_source: config.data_source,
      dataset_type: config.dataset_type,
      time_object: { timestamp: runTimestamp, timezone: config.timezone },
      total_events: totalEvents,
    });

    // persist new connector state
    if (config.ingestion_mode === "incremental") {
      await deps.stateStore.saveState({
        connection_id: config.connection_id,
        ...newState,
        updated_at: new Date().toISOString(),
      } as ConnectorState);
    }

    await deps.jobRepo.updateStatus(jobId, "DONE", { dataset_id: datasetUri });

    const durationMs = Date.now() - jobStart;
    logger.info({ jobId, datasetType: config.dataset_type, totalEvents, durationMs, datasetUri }, "job_done");
    emitMetric("ImportJobDone", 1, "Count", { service: "datalake-ingest-worker", datasetType: config.dataset_type });
    emitMetric("JobDurationMs", durationMs, "Milliseconds", { service: "datalake-ingest-worker" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.jobRepo.updateStatus(jobId, "FAILED", { error: message });
    logger.error({ jobId, err }, "job_failed");
    emitMetric("ImportJobFailed", 1, "Count", { service: "datalake-ingest-worker" });
    throw err; // let caller decide whether to delete sqs message
  }
}
