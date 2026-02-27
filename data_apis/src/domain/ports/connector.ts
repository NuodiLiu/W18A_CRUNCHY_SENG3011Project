import { ConnectorState } from "../models/connectorState.js";
import { SourceSpec } from "../models/jobConfig.js";

export interface RawRecord {
  raw_row: Record<string, string>;
  raw_line?: string;
  source_file: string;
  row_number: number;
}

export interface FetchResult {
  records: RawRecord[];
  new_state: Partial<ConnectorState>;
}

export interface Connector {
  fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined
  ): Promise<FetchResult>;
}
