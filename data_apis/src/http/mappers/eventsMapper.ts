import {
  EventRecord,
  EventDataset,
  EsgMetricAttribute,
  HousingSaleAttribute,
  TimeObject,
} from "../../domain/models/event.js";
import {
  EventRecordResponse,
  EventDatasetResponse,
  EsgMetricAttributeResponse,
  HousingSaleAttributeResponse,
  TimeObjectResponse,
} from "../types/events.types.js";

function toTimeObjectResponse(t: TimeObject): TimeObjectResponse {
  return {
    timestamp: t.timestamp,
    timezone: t.timezone,
    duration: t.duration,
    duration_unit: t.duration_unit,
  };
}

// Generic core mapper — attribute translation is injected by the caller
function toEventRecordResponse<A, R>(
  record: EventRecord<A>,
  mapAttribute: (a: A) => R
): EventRecordResponse<R> {
  return {
    event_id: record.event_id,
    time_object: toTimeObjectResponse(record.time_object),
    event_type: record.event_type,
    attribute: mapAttribute(record.attribute),
  };
}

function toEventDatasetResponse<A, R>(
  dataset: EventDataset,
  mapAttribute: (a: A) => R
): EventDatasetResponse<R> {
  return {
    data_source: dataset.data_source,
    dataset_type: dataset.dataset_type,
    dataset_id: dataset.dataset_id,
    time_object: toTimeObjectResponse(dataset.time_object),
    events: (dataset.events as unknown as EventRecord<A>[]).map((e) =>
      toEventRecordResponse(e, mapAttribute)
    ),
  };
}

// ESG-specific attribute mapper
function toEsgMetricAttributeResponse(a: EsgMetricAttribute): EsgMetricAttributeResponse {
  return {
    permid: a.permid,
    company_name: a.company_name,
    metric_name: a.metric_name,
    metric_value: a.metric_value,
    metric_year: a.metric_year,
    metric_unit: a.metric_unit,
    metric_description: a.metric_description,
    pillar: a.pillar,
    industry: a.industry,
    headquarter_country: a.headquarter_country,
    data_type: a.data_type,
    disclosure: a.disclosure,
    provider_name: a.provider_name,
    nb_points_of_observations: a.nb_points_of_observations,
    reported_date: a.reported_date,
    metric_period: a.metric_period,
  };
}

// Housing-specific attribute mapper
function toHousingSaleAttributeResponse(a: HousingSaleAttribute): HousingSaleAttributeResponse {
  return {
    property_id: a.property_id,
    dealing_number: a.dealing_number,
    unit_number: a.unit_number,
    street_number: a.street_number,
    street_name: a.street_name,
    suburb: a.suburb,
    postcode: a.postcode,
    purchase_price: a.purchase_price,
    legal_description: a.legal_description,
    area: a.area,
    area_type: a.area_type,
    contract_date: a.contract_date,
    settlement_date: a.settlement_date,
    district_code: a.district_code,
    zoning: a.zoning,
    nature_of_property: a.nature_of_property,
    primary_purpose: a.primary_purpose,
  };
}

// Public API — dataset_type selects the appropriate attribute mapper
export function toEsgEventDatasetResponse(
  dataset: EventDataset
): EventDatasetResponse<EsgMetricAttributeResponse> {
  return toEventDatasetResponse(dataset, toEsgMetricAttributeResponse);
}

export function toHousingEventDatasetResponse(
  dataset: EventDataset
): EventDatasetResponse<HousingSaleAttributeResponse> {
  return toEventDatasetResponse(dataset, toHousingSaleAttributeResponse);
}

export function toEsgEventRecordResponse(
  record: EventRecord<EsgMetricAttribute>
): EventRecordResponse<EsgMetricAttributeResponse> {
  return toEventRecordResponse(record, toEsgMetricAttributeResponse);
}

export function toHousingEventRecordResponse(
  record: EventRecord<HousingSaleAttribute>
): EventRecordResponse<HousingSaleAttributeResponse> {
  return toEventRecordResponse(record, toHousingSaleAttributeResponse);
}

export function toEventRecordResponseAuto(
  record: EventRecord
): EventRecordResponse {
  switch (record.event_type) {
    case "esg_metric":
      return toEsgEventRecordResponse(record as unknown as EventRecord<EsgMetricAttribute>) as unknown as EventRecordResponse;
    case "property_sale":
      return toHousingEventRecordResponse(record as unknown as EventRecord<HousingSaleAttribute>) as unknown as EventRecordResponse;
    default:
      return toEventRecordResponse(record, (a) => a);
  }
}
