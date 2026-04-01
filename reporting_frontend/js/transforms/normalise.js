// gdp mock data is already year and value so map to standard shape
export function normaliseGdp(raw) {
  return raw.map((d) => ({ period: d.year, value: d.value }));
}

// group housing events and get average purchase price by year
export function normaliseHousing(raw) {
  const byYear = {};

  for (const evt of raw.events) {
    const ts = evt.time_object?.timestamp;
    const price = parseFloat(evt.attribute?.purchase_price);
    if (!ts || isNaN(price) || price <= 0) continue;

    const year = ts.slice(0, 4);
    if (!byYear[year]) byYear[year] = { sum: 0, count: 0 };
    byYear[year].sum += price;
    byYear[year].count += 1;
  }

  return Object.entries(byYear)
    .map(([year, { sum, count }]) => ({
      period: year,
      value: Math.round(sum / count),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
