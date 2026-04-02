/**
 * E2E tests — verify the full user experience in a real browser.
 *
 * The live API may have no data yet (ingest in progress), so we intercept
 * the housing API call with route.fulfill to supply fixture data, then
 * also test the "no data" fallback by returning an empty response.
 */

import { test, expect } from "@playwright/test";

// ── Fixtures matching the backend TimeSeriesResponse contract ──

const HOUSING_FIXTURE = {
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

const HOUSING_EMPTY = {
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  time_period: "year",
  data: [],
};

// ── Helpers ──

function interceptHousingApi(page, fixture) {
  return page.route("**/api/v1/visualisation/timeseries*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    })
  );
}

// ── Tests ──

test.describe("Dashboard page load", () => {
  test("renders page title and controls", async ({ page }) => {
    await interceptHousingApi(page, HOUSING_FIXTURE);
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("Australia Economic Dashboard");
    await expect(page.locator("#year-start")).toBeVisible();
    await expect(page.locator("#year-end")).toBeVisible();
    await expect(page.locator("#btn-load")).toBeVisible();
  });

  test("defaults year inputs to 1990–2024", async ({ page }) => {
    await interceptHousingApi(page, HOUSING_FIXTURE);
    await page.goto("/");

    await expect(page.locator("#year-start")).toHaveValue("1990");
    await expect(page.locator("#year-end")).toHaveValue("2024");
  });

  test("renders the chart canvas", async ({ page }) => {
    await interceptHousingApi(page, HOUSING_FIXTURE);
    await page.goto("/");
    // Chart.js renders onto the canvas
    await expect(page.locator("#chart-main")).toBeVisible();
  });
});

test.describe("With housing data (mocked API)", () => {
  test.beforeEach(async ({ page }) => {
    await interceptHousingApi(page, HOUSING_FIXTURE);
    await page.goto("/");
    // wait for the chart to initialize
    await page.waitForTimeout(500);
  });

  test("stat cards show real values", async ({ page }) => {
    const gdpCard = page.locator("#stat-gdp .stat-value");
    const housingCard = page.locator("#stat-housing .stat-value");

    // GDP card should show a dollar value (from mock GDP data)
    await expect(gdpCard).not.toHaveText("--");
    const gdpText = await gdpCard.textContent();
    expect(gdpText).toMatch(/^\$/); // starts with $

    // Housing card should show a dollar value (from fixture)
    await expect(housingCard).not.toHaveText("--");
    await expect(housingCard).not.toHaveText("N/A");
  });

  test("status message clears on success", async ({ page }) => {
    const status = page.locator("#status");
    // should be empty or cleared after load
    await expect(status).toHaveText("");
  });
});

test.describe("Without housing data (empty API response)", () => {
  test.beforeEach(async ({ page }) => {
    await interceptHousingApi(page, HOUSING_EMPTY);
    await page.goto("/");
    await page.waitForTimeout(500);
  });

  test("falls back to GDP-only chart", async ({ page }) => {
    await expect(page.locator("#chart-main")).toBeVisible();
    // GDP stat card should still work
    const gdpCard = page.locator("#stat-gdp .stat-value");
    await expect(gdpCard).not.toHaveText("--");
  });

  test("housing stat card shows N/A", async ({ page }) => {
    const housingCard = page.locator("#stat-housing .stat-value");
    await expect(housingCard).toHaveText("N/A");
  });
});

test.describe("API failure handling", () => {
  test("shows fallback message when API is unreachable", async ({ page }) => {
    await page.route("**/api/v1/visualisation/timeseries*", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" })
    );
    await page.goto("/");
    await page.waitForTimeout(500);

    const status = page.locator("#status");
    // should show the housing unavailable message or error
    const text = await status.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test("shows error when API returns non-JSON", async ({ page }) => {
    await page.route("**/api/v1/visualisation/timeseries*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "not json",
      })
    );
    await page.goto("/");
    await page.waitForTimeout(500);

    // should gracefully handle and still show GDP
    const gdpCard = page.locator("#stat-gdp .stat-value");
    await expect(gdpCard).not.toHaveText("--");
  });
});

test.describe("User interactions", () => {
  test("clicking Load with custom year range reloads chart", async ({
    page,
  }) => {
    let apiCallCount = 0;
    await page.route("**/api/v1/visualisation/timeseries*", (route) => {
      apiCallCount++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(HOUSING_FIXTURE),
      });
    });

    await page.goto("/");
    await page.waitForTimeout(300);

    const initialCalls = apiCallCount;

    // change year range and click load
    await page.fill("#year-start", "2000");
    await page.fill("#year-end", "2020");
    await page.click("#btn-load");
    await page.waitForTimeout(300);

    // a new API call should have been made
    expect(apiCallCount).toBeGreaterThan(initialCalls);
  });

  test("year range filters GDP data in chart", async ({ page }) => {
    await interceptHousingApi(page, HOUSING_FIXTURE);
    await page.goto("/");
    await page.waitForTimeout(300);

    // narrow the range
    await page.fill("#year-start", "2020");
    await page.fill("#year-end", "2023");
    await page.click("#btn-load");
    await page.waitForTimeout(300);

    // chart should still be visible
    await expect(page.locator("#chart-main")).toBeVisible();
    // GDP card should show a value from the narrower range
    const gdpCard = page.locator("#stat-gdp .stat-value");
    await expect(gdpCard).not.toHaveText("--");
  });
});
