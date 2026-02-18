/**
 * Port: Connector — fetches raw records from a source (e.g. CSV files on S3).
 */

import { ConnectorState } from "../models/connectorState.js";
import { SourceSpec } from "../models/jobConfig.js";

/** A single raw record parsed from a CSV row. */
export interface RawRecord {
  raw_row: Record<string, string>;
  raw_line?: string;
  source_file: string;
  row_number: number;
}

/** Result of a connector fetch operation. */
export interface FetchResult {
  records: RawRecord[];
  new_state: Partial<ConnectorState>;
}

export interface Connector {
  /**
   * Fetch records from the source, optionally starting from prev_state.
   * For full_refresh, prev_state is ignored.
   */
  fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined
  ): Promise<FetchResult>;
}
