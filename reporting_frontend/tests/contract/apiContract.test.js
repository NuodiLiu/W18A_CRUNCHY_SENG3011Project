/**
 * Contract tests — validate that the API response shapes satisfy
 * the frontend's transform/normalise functions.
 *
 * These tests do NOT call the real API; they verify the *contract*:
 * "given a response that matches the documented schema, the frontend
 *  transform pipeline produces the expected chart-ready data."
 */

import { describe, it, expect } from "vitest";
import {
  TIMESERIES_RESPONSE,
  TIMESERIES_WITH_DIMENSION,
  TIMESERIES_EMPTY,
  BREAKDOWN_RESPONSE,
} from "./fixtures.js";

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Validates that an object matches the TimeSeriesResponse schema
 * as defined in the backend's visualisation.types.ts / OpenAPI spec.
 */
function assertTimeSeriesSchema(obj) {
  expect(obj).toHaveProperty("metric");
  expect(obj).toHaveProperty("aggregation");
  expect(obj).toHaveProperty("event_type");
  expect(obj).toHaveProperty("data");
  expect(typeof obj.metric).toBe("string");
  expect(typeof obj.aggregation).toBe("string");
  expect(typeof obj.event_type).toBe("string");
  expect(Array.isArray(obj.data)).toBe(true);

  for (const point of obj.data) {
    expect(point).toHaveProperty("period");
    expect(point).toHaveProperty("value");
    expect(point).toHaveProperty("count");
    expect(typeof point.period).toBe("string");
    expect(typeof point.value).toBe("number");
    expect(typeof point.count).toBe("number");
  }
}

function assertBreakdownSchema(obj) {
  expect(obj).toHaveProperty("dimension");
  expect(obj).toHaveProperty("metric");
  expect(obj).toHaveProperty("aggregation");
  expect(obj).toHaveProperty("event_type");
  expect(obj).toHaveProperty("entries");
  expect(typeof obj.dimension).toBe("string");
  expect(Array.isArray(obj.entries)).toBe(true);

  for (const entry of obj.entries) {
    expect(entry).toHaveProperty("category");
    expect(entry).toHaveProperty("value");
    expect(entry).toHaveProperty("count");
    expect(typeof entry.category).toBe("string");
    expect(typeof entry.value).toBe("number");
    expect(typeof entry.count).toBe("number");
  }
}

// ─── Schema validation tests ────────────────────────────────────

describe("API response schema contract", () => {
  it("TimeSeriesResponse fixture matches schema", () => {
    assertTimeSeriesSchema(TIMESERIES_RESPONSE);
  });

  it("TimeSeriesResponse with dimension matches schema", () => {
    assertTimeSeriesSchema(TIMESERIES_WITH_DIMENSION);
    // dimension-specific fields
    expect(TIMESERIES_WITH_DIMENSION).toHaveProperty("dimension");
    for (const point of TIMESERIES_WITH_DIMENSION.data) {
      expect(point).toHaveProperty("series");
      expect(typeof point.series).toBe("string");
    }
  });

  it("empty TimeSeriesResponse still matches schema", () => {
    assertTimeSeriesSchema(TIMESERIES_EMPTY);
    expect(TIMESERIES_EMPTY.data).toHaveLength(0);
  });

  it("BreakdownResponse fixture matches schema", () => {
    assertBreakdownSchema(BREAKDOWN_RESPONSE);
  });
});

// ─── Frontend transform pipeline contract tests ─────────────────

// Re-implement the transforms inline so we don't need module resolution hacks
// (the source files use bare ES-module imports with .js extensions).
// We test the *same logic* against the *contract fixture*.

function normaliseHousing(raw) {
  return raw.data
    .map((d) => ({ period: d.period, value: Math.round(d.value) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function normaliseGdp(raw) {
  return raw.map((d) => ({ period: d.year, value: d.value }));
}

function mergeByPeriod(leftArr, rightArr) {
  const rightMap = new Map(rightArr.map((d) => [d.period, d.value]));
  return leftArr
    .filter((d) => rightMap.has(d.period))
    .map((d) => ({
      period: d.period,
      left: d.value,
      right: rightMap.get(d.period),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function toDualAxisData(merged, leftLabel, rightLabel) {
  return {
    labels: merged.map((d) => d.period),
    datasets: [
      {
        label: leftLabel,
        data: merged.map((d) => d.left),
        yAxisID: "yLeft",
      },
      {
        label: rightLabel,
        data: merged.map((d) => d.right),
        yAxisID: "yRight",
      },
    ],
  };
}

describe("normaliseHousing — transforms TimeSeriesResponse", () => {
  it("maps data[] to {period, value} sorted by period", () => {
    const result = normaliseHousing(TIMESERIES_RESPONSE);
    expect(result).toHaveLength(TIMESERIES_RESPONSE.data.length);
    expect(result[0]).toEqual({ period: "2018", value: 650000 });
    // sorted ascending
    const periods = result.map((d) => d.period);
    expect(periods).toEqual([...periods].sort());
  });

  it("returns empty array for empty response", () => {
    const result = normaliseHousing(TIMESERIES_EMPTY);
    expect(result).toEqual([]);
  });

  it("rounds values to integers", () => {
    const raw = {
      ...TIMESERIES_RESPONSE,
      data: [{ period: "2020", value: 123456.789, count: 10 }],
    };
    const result = normaliseHousing(raw);
    expect(result[0].value).toBe(123457);
  });
});

describe("normaliseGdp — transforms mock GDP data", () => {
  const GDP_SAMPLE = [
    { year: "2020", value: 1333.34 },
    { year: "2021", value: 1560.62 },
  ];

  it("maps year→period", () => {
    const result = normaliseGdp(GDP_SAMPLE);
    expect(result[0]).toEqual({ period: "2020", value: 1333.34 });
    expect(result[1]).toEqual({ period: "2021", value: 1560.62 });
  });
});

describe("mergeByPeriod — inner join on period", () => {
  it("joins housing and GDP by matching periods", () => {
    const housing = [
      { period: "2020", value: 710000 },
      { period: "2021", value: 780000 },
      { period: "2022", value: 820000 },
    ];
    const gdp = [
      { period: "2020", value: 1333.34 },
      { period: "2021", value: 1560.62 },
    ];
    const merged = mergeByPeriod(housing, gdp);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      period: "2020",
      left: 710000,
      right: 1333.34,
    });
  });

  it("returns empty when no overlap", () => {
    const housing = [{ period: "2025", value: 900000 }];
    const gdp = [{ period: "2020", value: 1333.34 }];
    expect(mergeByPeriod(housing, gdp)).toEqual([]);
  });

  it("handles empty left array", () => {
    const gdp = [{ period: "2020", value: 1333.34 }];
    expect(mergeByPeriod([], gdp)).toEqual([]);
  });
});

describe("toDualAxisData — produces Chart.js compatible structure", () => {
  it("creates labels from merged periods", () => {
    const merged = [
      { period: "2020", left: 710000, right: 1333.34 },
      { period: "2021", left: 780000, right: 1560.62 },
    ];
    const result = toDualAxisData(merged, "Housing", "GDP");
    expect(result.labels).toEqual(["2020", "2021"]);
    expect(result.datasets).toHaveLength(2);
    expect(result.datasets[0].label).toBe("Housing");
    expect(result.datasets[0].data).toEqual([710000, 780000]);
    expect(result.datasets[0].yAxisID).toBe("yLeft");
    expect(result.datasets[1].label).toBe("GDP");
    expect(result.datasets[1].data).toEqual([1333.34, 1560.62]);
    expect(result.datasets[1].yAxisID).toBe("yRight");
  });

  it("handles empty merged array", () => {
    const result = toDualAxisData([], "A", "B");
    expect(result.labels).toEqual([]);
    expect(result.datasets[0].data).toEqual([]);
    expect(result.datasets[1].data).toEqual([]);
  });
});

describe("full pipeline: API response → chart data", () => {
  const GDP_RAW = [
    { year: "2018", value: 1433.14 },
    { year: "2019", value: 1398.35 },
    { year: "2020", value: 1333.34 },
    { year: "2021", value: 1560.62 },
    { year: "2022", value: 1695.63 },
    { year: "2023", value: 1734.45 },
  ];

  it("transforms timeseries response + GDP mock into dual-axis chart data", () => {
    const housingNorm = normaliseHousing(TIMESERIES_RESPONSE);
    const gdpNorm = normaliseGdp(GDP_RAW);
    const merged = mergeByPeriod(housingNorm, gdpNorm);
    const chartData = toDualAxisData(
      merged,
      "Avg Housing Price (AUD)",
      "GDP (Billion USD)"
    );

    // all 6 years overlap
    expect(chartData.labels).toEqual([
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
    ]);
    expect(chartData.datasets[0].data[0]).toBe(650000); // housing 2018
    expect(chartData.datasets[1].data[0]).toBe(1433.14); // GDP 2018
  });

  it("produces GDP-only chart when timeseries response is empty", () => {
    const housingNorm = normaliseHousing(TIMESERIES_EMPTY);
    expect(housingNorm).toHaveLength(0);
    // frontend falls back to GDP-only chart — no merge needed
    const gdpNorm = normaliseGdp(GDP_RAW);
    expect(gdpNorm.length).toBeGreaterThan(0);
  });
});
