import { v4 as uuidv4 } from "uuid";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { StateStore } from "../../domain/ports/stateStore.js";
import { DataLakeWriter } from "../../domain/ports/dataLakeWriter.js";
import { Connector } from "../../domain/ports/connector.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { EventDataset } from "../../domain/models/event.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { getNormalizer } from "../normalizers/index.js";

export interface RunJobDeps {
  jobRepo: JobRepository;
  configStore: ConfigStore;
  stateStore: StateStore;
  dataLakeWriter: DataLakeWriter;
  connectorFactory: (connectorType: string) => Connector;
}

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 min

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
    const { records, new_state } = await connector.fetchIncremental(
      config.source_spec,
      prevState,
    );

    const runTimestamp = new Date().toISOString();
    const normalize = getNormalizer(config.mapping_profile);
    const events = normalize(records, config, runTimestamp);

    const datasetId = uuidv4();
    const dataset: EventDataset = {
      data_source: config.data_source,
      dataset_type: config.dataset_type,
      dataset_id: "", // filled by writer
      time_object: { timestamp: runTimestamp, timezone: config.timezone },
      events,
    };

    const datasetUri = await deps.dataLakeWriter.writeDataset(dataset, datasetId);

    // persist new connector state
    if (config.ingestion_mode === "incremental") {
      await deps.stateStore.saveState({
        connection_id: config.connection_id,
        ...new_state,
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
