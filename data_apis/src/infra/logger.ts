/**
 * Centralised structured logger (Pino) and CloudWatch EMF metric emitter.
 *
 * Pino outputs newline-delimited JSON to stdout.  Lambda forwards stdout to
 * CloudWatch Logs automatically — no additional agent is needed.
 *
 * CloudWatch Embedded Metric Format (EMF): embedding a specially-shaped JSON
 * line in stdout causes CloudWatch Logs to automatically extract it as a
 * CloudWatch Metric — no PutMetricData API calls needed.
 *
 * SERVICE_NAME env var should be set per Lambda function:
 *   - datalake-ingest-api     (API Lambda)
 *   - datalake-ingest-worker  (SQS Worker Lambda)
 */
import pino from "pino";

const SERVICE = process.env.SERVICE_NAME ?? "datalake-ingest-api";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level: LOG_LEVEL,
  base: { service: SERVICE },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export type AppLogger = pino.Logger;

/**
 * Emit a CloudWatch Embedded Metric Format line.
 *
 * All metrics land in the "ESG/DataLake" namespace.
 * CloudWatch extracts them automatically from the log stream.
 *
 * @param metricName  CloudWatch metric name
 * @param value       Numeric value
 * @param unit        CloudWatch unit string
 * @param dimensions  Key-value pairs used as CloudWatch dimensions
 */
export function emitMetric(
  metricName: string,
  value: number,
  unit: "Count" | "Milliseconds" | "Bytes" = "Count",
  dimensions: Record<string, string> = { service: SERVICE },
): void {
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "ESG/DataLake",
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: metricName, Unit: unit }],
        },
      ],
    },
    ...dimensions,
    [metricName]: value,
  };
  if (LOG_LEVEL === "silent") return;
  // Write directly to stdout — bypasses Pino transports to avoid double-encoding.
  process.stdout.write(JSON.stringify(emf) + "\n");
}
