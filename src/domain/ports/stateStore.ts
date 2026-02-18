/**
 * Port: State store — persistence for connector state (incremental cursors).
 */

import { ConnectorState } from "../models/connectorState.js";

export interface StateStore {
  /** Get the latest state for a connection. Returns undefined if first run. */
  getState(connectionId: string): Promise<ConnectorState | undefined>;

  /** Save updated state after a successful ingestion run. */
  saveState(state: ConnectorState): Promise<void>;
}
