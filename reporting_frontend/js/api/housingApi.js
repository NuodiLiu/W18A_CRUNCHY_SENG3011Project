import { BASE_URL } from "../config.js";

export async function fetchHousingData(limit = 5000) {
  const url = `${BASE_URL}/api/v1/events?dataset_type=housing&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Housing API ${res.status}: ${res.statusText}`);
  return res.json();
}
