import { DEFAULTS } from "./config.js";
import { fetchGdpData } from "./api/gdpMock.js";
import { fetchHousingTimeSeries } from "./api/housingApi.js";
import { normaliseGdp, normaliseHousing } from "./transforms/normalise.js";
import { mergeByPeriod } from "./transforms/merge.js";
import { toDualAxisData } from "./transforms/toChartData.js";
import { renderDualAxisLine } from "./charts/lineChart.js";
import { renderStatCard } from "./charts/statCard.js";

let activeChart = null;

async function loadCharts(yearStart, yearEnd) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = "Loading...";

  try {
    // fetch data from both sources
    const gdpRaw = fetchGdpData();
    let housingNorm;

    try {
      const housingRaw = await fetchHousingTimeSeries();
      housingNorm = normaliseHousing(housingRaw);
    } catch {
      housingNorm = [];
      statusEl.textContent =
        "Housing API unavailable — showing GDP only. Ingest housing data first.";
    }

    // normalize gdp data
    const gdpNorm = normaliseGdp(gdpRaw).filter(
      (d) => +d.period >= yearStart && +d.period <= yearEnd
    );

    // merge data or show gdp only
    if (activeChart) {
      activeChart.destroy();
      activeChart = null;
    }

    if (housingNorm.length > 0) {
      const merged = mergeByPeriod(housingNorm, gdpNorm);
      const chartData = toDualAxisData(
        merged,
        "Avg Housing Price (AUD)",
        "GDP (Billion USD)"
      );
      activeChart = renderDualAxisLine(
        "chart-main",
        chartData,
        "Avg Housing Price (AUD)",
        "GDP (Billion USD)"
      );

      // update stat cards
      const latestGdp = gdpNorm[gdpNorm.length - 1];
      renderStatCard(
        "stat-gdp",
        `$${latestGdp.value.toLocaleString()}B`,
        `GDP ${latestGdp.period}`
      );

      if (merged.length > 0) {
        const latest = merged[merged.length - 1];
        renderStatCard(
          "stat-housing",
          `$${latest.left.toLocaleString()}`,
          `Avg Housing ${latest.period}`
        );
      }
    } else {
      // use gdp only fallback
      const chartData = {
        labels: gdpNorm.map((d) => d.period),
        datasets: [
          {
            label: "GDP (Billion USD)",
            data: gdpNorm.map((d) => d.value),
            borderColor: "rgba(54, 162, 235, 1)",
            backgroundColor: "rgba(54, 162, 235, 0.1)",
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      };
      activeChart = new Chart(
        document.getElementById("chart-main").getContext("2d"),
        {
          type: "line",
          data: chartData,
          options: {
            responsive: true,
            scales: {
              x: { title: { display: true, text: "Year" } },
              y: { title: { display: true, text: "GDP (Billion USD)" } },
            },
          },
        }
      );

      const latestGdp = gdpNorm[gdpNorm.length - 1];
      renderStatCard(
        "stat-gdp",
        `$${latestGdp.value.toLocaleString()}B`,
        `GDP ${latestGdp.period}`
      );
      renderStatCard("stat-housing", "N/A", "No housing data");
    }

    if (statusEl.textContent === "Loading...") {
      statusEl.textContent = "";
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
}

// wire up ui
document.addEventListener("DOMContentLoaded", () => {
  const startEl = document.getElementById("year-start");
  const endEl = document.getElementById("year-end");
  const btnEl = document.getElementById("btn-load");

  startEl.value = DEFAULTS.yearStart;
  endEl.value = DEFAULTS.yearEnd;

  btnEl.addEventListener("click", () => {
    loadCharts(+startEl.value, +endEl.value);
  });

  // load on startup
  loadCharts(DEFAULTS.yearStart, DEFAULTS.yearEnd);
});
