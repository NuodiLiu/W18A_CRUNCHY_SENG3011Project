// TODO: implement real field mapping based on mapping_profile in a future sprint.
// currently each CSV row is stored as attribute.raw_row; event_type is hardcoded to "esg_record".

export interface TimeObject {
  timestamp: string;
  timezone: string;
  duration?: number;
  duration_unit?: string;
}

export interface EventRecord {
  time_object: TimeObject;
  event_type: string;
  attribute: {
    __PLACEHOLDER__: true;
    raw_row: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface EventDataset {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: TimeObject;
  events: EventRecord[];
}
