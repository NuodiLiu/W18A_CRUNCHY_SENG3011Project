import { ConnectorState } from "../models/connectorState.js";
import { SourceSpec } from "../models/jobConfig.js";

/** The incremental state update returned by a connector after a fetch run. */
export type FetchResult = Partial<ConnectorState>;

export interface RawRecord {
  raw_row: Record<string, string>;
  raw_line?: string;
  source_file: string;
  row_number: number;
}

export interface FetchOptions {
  // number of csv rows to skip from the start (for resuming after timeout)
  skipRows?: number;
}

export interface Connector {
  /**
   * Streams records from the source in batches, calling `onBatch` for each.
   * Returns the new connector state after all records are processed.
   */
  fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined,
    onBatch: (batch: RawRecord[]) => Promise<void>,
    options?: FetchOptions,
  ): Promise<Partial<ConnectorState>>;
}
