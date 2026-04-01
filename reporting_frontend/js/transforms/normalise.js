export function normaliseGdp(raw) {
  return raw.map((d) => ({ period: d.year, value: d.value }));
}

// timeseries API already returns {period, value, count} per year
export function normaliseHousing(raw) {
  return raw.data
    .map((d) => ({ period: d.period, value: Math.round(d.value) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
