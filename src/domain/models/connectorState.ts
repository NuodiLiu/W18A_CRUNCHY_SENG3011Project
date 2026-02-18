/**
 * Domain model: Connector state for incremental ingestion.
 *
 * TODO: Real incremental cursor semantics to be refined in future sprints.
 *       Currently uses placeholder fields.
 */

export interface ConnectorState {
  connection_id: string;
  last_processed_object_key?: string;
  last_processed_line_hash?: string;
  updated_at: string;
}
