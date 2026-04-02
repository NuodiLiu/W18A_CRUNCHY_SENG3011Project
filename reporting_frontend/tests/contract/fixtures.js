/**
 * Contract tests — verify the frontend's assumptions about API response shapes.
 *
 * These fixtures represent the contract defined by the backend
 * TimeSeriesResponse / BreakdownResponse schemas (OpenAPI / tsoa types).
 */

// ── TimeSeriesResponse shape (from backend visualisation.types.ts) ──

export const TIMESERIES_RESPONSE = {
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  time_period: "year",
  data: [
    { period: "2018", value: 650000, count: 120 },
    { period: "2019", value: 680000, count: 135 },
    { period: "2020", value: 710000, count: 98 },
    { period: "2021", value: 780000, count: 145 },
    { period: "2022", value: 820000, count: 160 },
    { period: "2023", value: 790000, count: 140 },
  ],
};

export const TIMESERIES_WITH_DIMENSION = {
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  time_period: "year",
  dimension: "suburb",
  data: [
    { period: "2022", value: 900000, count: 50, series: "Sydney" },
    { period: "2022", value: 700000, count: 40, series: "Melbourne" },
    { period: "2023", value: 920000, count: 55, series: "Sydney" },
    { period: "2023", value: 710000, count: 42, series: "Melbourne" },
  ],
};

export const TIMESERIES_EMPTY = {
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  time_period: "year",
  data: [],
};

// ── BreakdownResponse shape ──

export const BREAKDOWN_RESPONSE = {
  dimension: "suburb",
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  entries: [
    { category: "Sydney", value: 950000, count: 200 },
    { category: "Melbourne", value: 780000, count: 180 },
    { category: "Brisbane", value: 620000, count: 150 },
  ],
};
