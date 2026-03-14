export interface TimeObject {
  timestamp: string;
  timezone: string;
  duration?: number;
  duration_unit?: string;
}

// export interface EsgMetricAttribute {
//   permid: string;
//   company_name: string;
//   metric_name: string;
//   metric_value: number | null;
//   metric_year: number;
//   metric_unit: string;
//   metric_description: string;
//   pillar: string;
//   industry: string;
//   headquarter_country: string;
//   data_type: string;
//   disclosure: string;
//   provider_name: string;
//   nb_points_of_observations: number | null;
//   reported_date: string | null;
//   metric_period: string | null;
// }

export interface HousingSaleAttribute {
  property_id: string;
  dealing_number: number | null;
  unit_number: string;
  street_number: string;
  street_name: string;
  suburb: string;
  postcode: number | null;
  purchase_price: number;
  legal_description: string;
  area: number | null;
  area_type: string;
  contract_date: string;
  settlement_date: string;
  district_code: number;
  zoning: string;
  nature_of_property: string;
  primary_purpose: string;
}

// generic over attribute shape; defaults to open object for runtime flexibility
export interface EventRecord<T = Record<string, unknown>> {
  event_id: string;
  time_object: TimeObject;
  event_type: string;
  attribute: T;
}

export interface EventDataset {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: TimeObject;
  events: EventRecord[];
}
