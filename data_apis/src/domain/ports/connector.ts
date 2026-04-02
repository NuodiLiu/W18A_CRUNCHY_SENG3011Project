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
  // byte range for chunked parallel processing
  startByte?: number;
  endByte?: number;
}

export interface Connector {
  fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined,
    onBatch: (batch: RawRecord[]) => Promise<void>,
    options?: FetchOptions,
  ): Promise<Partial<ConnectorState>>;
}
