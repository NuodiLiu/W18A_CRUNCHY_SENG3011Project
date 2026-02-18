/**
 * Domain model: Destination data model — Event Dataset.
 *
 * NOTE (Sprint scope):
 *   CSV → events.attribute field mapping is NOT implemented.
 *   Each CSV row is stored as `attribute.raw_row` (key-value pairs).
 *   `event_type` is hardcoded to "esg_record".
 *
 * TODO: Implement real field mapping based on mapping_profile in a future sprint.
 */

export interface TimeObject {
  timestamp: string;            // ISO-8601
  timezone: string;             // e.g. "GMT+11"
  duration?: number;
  duration_unit?: string;       // e.g. "second"
}

export interface EventRecord {
  time_object: TimeObject;
  event_type: string;           // "esg_record" for this sprint
  attribute: {
    __PLACEHOLDER__: true;
    raw_row: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface EventDataset {
  data_source: string;
  dataset_type: string;
  dataset_id: string;           // s3://bucket/datasets/<id>/manifest.json
  time_object: TimeObject;
  events: EventRecord[];
}
