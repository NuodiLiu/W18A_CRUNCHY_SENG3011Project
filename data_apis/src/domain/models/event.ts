export interface TimeObject {
  timestamp: string;
  timezone: string;
  duration?: number;
  duration_unit?: string;
}

export interface EsgMetricAttribute {
  permid: string;
  company_name: string;
  metric_name: string;
  metric_value: number | null;
  metric_year: number;
  metric_unit: string;
  metric_description: string;
  pillar: string;
  industry: string;
  headquarter_country: string;
  data_type: string;
  disclosure: string;
  provider_name: string;
  nb_points_of_observations: number | null;
  reported_date: string | null;
  metric_period: string | null;
}

export interface EventRecord {
  time_object: TimeObject;
  event_type: string;
  attribute: EsgMetricAttribute;
}

export interface EventDataset {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: TimeObject;
  events: EventRecord[];
}
