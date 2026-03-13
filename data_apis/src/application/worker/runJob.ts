import { v4 as uuidv4 } from "uuid";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { StateStore } from "../../domain/ports/stateStore.js";
import { DataLakeWriter } from "../../domain/ports/dataLakeWriter.js";
import { Connector } from "../../domain/ports/connector.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { getNormalizer } from "../normalizers/index.js";

export interface RunJobDeps {
  jobRepo: JobRepository;
  configStore: ConfigStore;
  stateStore: StateStore;
  dataLakeWriter: DataLakeWriter;
  connectorFactory: (connectorType: string) => Connector;
}

const LEASE_DURATION_MS = 10 * 60 * 1000; // 10 min — covers up to ~2 min of 1 GB CSV processing

// orchestrates a single import job end-to-end
export async function runJob(jobId: string, deps: RunJobDeps): Promise<void> {
  const leaseUntil = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const claimed = await deps.jobRepo.claimJob(jobId, leaseUntil);
  if (!claimed) return; // another worker already claimed it

  try {
    const job = await deps.jobRepo.findById(jobId);
    if (!job) throw new Error(`job record disappeared: ${jobId}`);

    const config: JobConfig = await deps.configStore.getConfig(job.config_ref);
    const prevState = config.ingestion_mode === "incremental"
      ? await deps.stateStore.getState(config.connection_id)
      : undefined;

    const connector = deps.connectorFactory(config.connector_type);
    const datasetId = uuidv4();
    const runTimestamp = new Date().toISOString();
    const normalize = getNormalizer(config.mapping_profile);
    let totalEvents = 0;

    // Stream records in batches: fetch → normalize → write one segment at a time.
    // Peak memory ≈ one batch of rows, not the full dataset.
    const newState = await connector.fetchIncremental(
      config.source_spec,
      prevState,
      async (batch) => {
        const events = normalize(batch, config, runTimestamp);
        await deps.dataLakeWriter.writeChunk(events, datasetId);
        totalEvents += events.length;
      },
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.jobRepo.updateStatus(jobId, "FAILED", { error: message });
    throw err; // let caller decide whether to delete sqs message
  }
}
