import { BASE_URL } from "../config.js";

export async function fetchHousingTimeSeries() {
  const url = `${BASE_URL}/api/v1/visualisation/timeseries?event_type=housing_sale&metric=purchase_price&aggregation=avg&time_period=year`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Housing API ${res.status}: ${res.statusText}`);
  return res.json();
}
