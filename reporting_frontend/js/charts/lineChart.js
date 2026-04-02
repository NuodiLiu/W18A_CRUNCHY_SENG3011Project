/**
 * render dual axis line chart in canvas
 * return chart instance and destroy before rerender
 */
export function renderDualAxisLine(canvasId, chartData, leftTitle, rightTitle) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  return new Chart(ctx, {
    type: "line",
    data: chartData,
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          title: { display: true, text: "Year" },
        },
        yLeft: {
          type: "linear",
          position: "left",
          title: { display: true, text: leftTitle },
          grid: { drawOnChartArea: true },
        },
        yRight: {
          type: "linear",
          position: "right",
          title: { display: true, text: rightTitle },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

/**
 * render single axis line chart
 */
export function renderLine(canvasId, chartData, yTitle) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  return new Chart(ctx, {
    type: "line",
    data: chartData,
    options: {
      responsive: true,
      plugins: { tooltip: { enabled: true } },
      scales: {
        x: { title: { display: true, text: "Year" } },
        y: { title: { display: true, text: yTitle } },
      },
    },
  });
}
