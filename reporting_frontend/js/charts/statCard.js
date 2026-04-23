// update the stat card
export function renderStatCard(elementId, value, description) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.querySelector(".stat-value").textContent = value;
  el.querySelector(".stat-desc").textContent = description;
}
