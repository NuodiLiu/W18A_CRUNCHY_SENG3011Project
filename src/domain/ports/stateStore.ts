import { ConnectorState } from "../models/connectorState.js";

export interface StateStore {
  getState(connectionId: string): Promise<ConnectorState | undefined>;
  saveState(state: ConnectorState): Promise<void>;
}
