/**
 * render bar chart in canvas
 */
export function renderBar(canvasId, chartData, yTitle) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  return new Chart(ctx, {
    type: "bar",
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
