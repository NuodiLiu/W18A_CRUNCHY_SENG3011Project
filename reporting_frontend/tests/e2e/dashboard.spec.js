/**
 * E2E tests — HouseDomain (HD) NSW Property Explorer.
 *
 * The app is a 4-screen SPA (s1 globe → s2 satellite → s3 heatmap → s4 analysis).
 * Screen transitions on s1/s2 are time-based (3D animation + flyTo), so these
 * tests mostly drive the UI by flipping the `.active` class directly — the same
 * thing the internal `show()` helper does — rather than waiting for animations.
 *
 * All backend API calls are intercepted so tests don't depend on live data.
 */

import { test, expect } from "@playwright/test";

// ── Fixtures matching the backend response shapes ─────────────────

const BREAKDOWN_PRICES = {
  dimension: "suburb",
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  entries: [
    { category: "NARRABEEN", value: 2100000, count: 42 },
    { category: "MANLY",     value: 2850000, count: 60 },
    { category: "PARRAMATTA", value: 1250000, count: 85 },
  ],
};

const BREAKDOWN_GENERIC = {
  dimension: "suburb",
  metric: "count",
  aggregation: "count",
  event_type: "generic",
  entries: [
    { category: "NARRABEEN", value: 12, count: 12 },
    { category: "MANLY",     value: 8,  count: 8  },
  ],
};

const TIMESERIES_HOUSING = {
  metric: "purchase_price",
  aggregation: "avg",
  event_type: "housing_sale",
  time_period: "year",
  data: [
    { period: "2020", value: 1800000, count: 10 },
    { period: "2021", value: 1950000, count: 14 },
    { period: "2022", value: 2050000, count: 18 },
    { period: "2023", value: 2150000, count: 16 },
  ],
};

const EVENTS_HOUSING = {
  items: [
    { suburb: "NARRABEEN", purchase_price: 2100000, sale_date: "2023-06-01" },
    { suburb: "NARRABEEN", purchase_price: 2050000, sale_date: "2022-05-15" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────

async function mockAllApis(page) {
  await page.route("**/api/v1/visualisation/breakdown*", (route) => {
    const url = route.request().url();
    const body = url.includes("metric=purchase_price")
      ? BREAKDOWN_PRICES
      : BREAKDOWN_GENERIC;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/api/v1/visualisation/timeseries*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TIMESERIES_HOUSING),
    })
  );

  await page.route("**/api/v1/events*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EVENTS_HOUSING),
    })
  );
}

/** Jump directly to a screen by toggling the `.active` class (same as show()). */
async function gotoScreen(page, id) {
  await page.evaluate((sid) => {
    document.querySelectorAll(".screen").forEach((s) => {
      s.classList.toggle("active", s.id === sid);
    });
  }, id);
}

// ── S1: Globe landing screen ──────────────────────────────────────

test.describe("S1 — Globe landing", () => {
  test("renders the HouseDomain logo and globe canvas", async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");

    await expect(page.locator("#s1")).toHaveClass(/active/);
    await expect(page.locator("#globe-canvas")).toBeVisible();
    await expect(page.locator(".hd-logo h1")).toHaveText("HouseDomain");
    await expect(page.locator(".hd-logo span")).toHaveText(
      "NSW Property Explorer"
    );
    await expect(page.locator(".globe-hint")).toBeVisible();
  });

  test("page title matches the app name", async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/HouseDomain/);
  });
});

// ── S3: Heatmap screen ────────────────────────────────────────────

test.describe("S3 — Heatmap", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await gotoScreen(page, "s3");
  });

  test("shows the filter panel with all five suitability filters", async ({
    page,
  }) => {
    const filters = ["housing", "education", "infrastructure", "safety", "greenspace"];
    for (const f of filters) {
      await expect(
        page.locator(`.filter-item[data-filter="${f}"]`)
      ).toBeVisible();
    }
  });

  test('"housing" filter is active by default', async ({ page }) => {
    const housing = page.locator('.filter-item[data-filter="housing"]');
    await expect(housing).toHaveAttribute("aria-pressed", "true");
    await expect(housing).toHaveClass(/active/);
  });

  test("toggling a filter updates aria-pressed", async ({ page }) => {
    const safety = page.locator('.filter-item[data-filter="safety"]');
    await expect(safety).toHaveAttribute("aria-pressed", "false");
    await safety.click();
    await expect(safety).toHaveAttribute("aria-pressed", "true");
    await expect(safety).toHaveClass(/active/);
  });

  test("suitability legend renders four tiers", async ({ page }) => {
    await expect(page.locator(".legend .legend-item")).toHaveCount(4);
  });

  test("map status element exists for loading state", async ({ page }) => {
    await expect(page.locator("#map-status")).toBeAttached();
  });
});

// ── S4: Suburb analysis screen ────────────────────────────────────

test.describe("S4 — Suburb analysis", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await gotoScreen(page, "s4");
  });

  test("renders chart canvas and meta cards", async ({ page }) => {
    await expect(page.locator("#chart")).toBeVisible();
    await expect(page.locator("#meta-suburb")).toBeVisible();
    await expect(page.locator("#meta-price")).toBeVisible();
  });

  test("exposes all five chart metric chips", async ({ page }) => {
    const metrics = ["purchase_price", "count", "income", "population", "weather"];
    for (const m of metrics) {
      await expect(page.locator(`.chip[data-f="${m}"]`)).toBeVisible();
    }
  });

  test("avg sale price chip is active by default", async ({ page }) => {
    const chip = page.locator('.chip[data-f="purchase_price"]');
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toHaveClass(/active/);
  });

  test("clicking a different chip moves the active state", async ({ page }) => {
    const population = page.locator('.chip[data-f="population"]');
    await population.click();
    await expect(population).toHaveClass(/active/);
    await expect(page.locator('.chip[data-f="purchase_price"]')).not.toHaveClass(
      /active/
    );
  });

  test("Back button exists and is visible", async ({ page }) => {
    await expect(page.locator("#btn-back")).toBeVisible();
  });
});

// ── Accessibility controls (topbar on s3) ─────────────────────────

test.describe("Accessibility controls", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await gotoScreen(page, "s3");
  });

  test("theme toggle flips data-theme between dark and light", async ({
    page,
  }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.locator("#theme-toggle").click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("colour-blind toggle switches to colorblind palette", async ({
    page,
  }) => {
    await page.locator("#cb-toggle").click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /colorblind/
    );
  });

  test("font-size buttons update the --font-scale CSS variable", async ({
    page,
  }) => {
    await page.locator("#font-lg").click();
    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
    );
    expect(scale).toBe("1.2");

    await page.locator("#font-sm").click();
    const scale2 = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
    );
    expect(scale2).toBe("0.85");
  });
});

// ── API failure handling ──────────────────────────────────────────

test.describe("API failure handling", () => {
  test("app still renders the globe when breakdown endpoint is 500", async ({
    page,
  }) => {
    await page.route("**/api/v1/visualisation/breakdown*", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" })
    );
    await page.route("**/api/v1/visualisation/timeseries*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TIMESERIES_HOUSING),
      })
    );
    await page.route("**/api/v1/events*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(EVENTS_HOUSING),
      })
    );

    await page.goto("/");
    await expect(page.locator("#s1")).toHaveClass(/active/);
    await expect(page.locator("#globe-canvas")).toBeVisible();
  });

  test("heatmap renders controls even when all APIs fail", async ({ page }) => {
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({ status: 500, body: "boom" })
    );
    await page.goto("/");
    await gotoScreen(page, "s3");
    await expect(
      page.locator('.filter-item[data-filter="housing"]')
    ).toBeVisible();
    await expect(page.locator(".legend")).toBeVisible();
  });
});
