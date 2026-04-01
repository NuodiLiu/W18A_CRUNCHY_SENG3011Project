import { COLORS } from "../config.js";

/**
 * convert merged array to chart data with two axes
 */
export function toDualAxisData(merged, leftLabel, rightLabel) {
  return {
    labels: merged.map((d) => d.period),
    datasets: [
      {
        label: leftLabel,
        data: merged.map((d) => d.left),
        borderColor: COLORS.housing,
        backgroundColor: COLORS.housingFill,
        yAxisID: "yLeft",
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: rightLabel,
        data: merged.map((d) => d.right),
        borderColor: COLORS.gdp,
        backgroundColor: COLORS.gdpFill,
        yAxisID: "yRight",
        tension: 0.3,
        pointRadius: 3,
      },
    ],
  };
}

/**
 * convert one normalized array to single axis chart data
 */
export function toSingleData(normalised, label, color, fillColor) {
  return {
    labels: normalised.map((d) => d.period),
    datasets: [
      {
        label,
        data: normalised.map((d) => d.value),
        borderColor: color,
        backgroundColor: fillColor,
        tension: 0.3,
        pointRadius: 3,
      },
    ],
  };
}
