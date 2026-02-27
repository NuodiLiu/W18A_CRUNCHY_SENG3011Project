import { RawRecord } from "../../domain/ports/connector.js";
import { EventRecord } from "../../domain/models/event.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { UnprocessableError } from "../../domain/errors.js";
import { normalizeEsgMetrics } from "./normalizeEsgMetrics.js";

export type NormalizeFn = (
  records: RawRecord[],
  config: JobConfig,
  runTimestamp: string,
) => EventRecord[];

const registry: Record<string, NormalizeFn> = {
  esg_csv_batch: normalizeEsgMetrics,
};

// returns the normalizer for a given connector type
export function getNormalizer(connectorType: string): NormalizeFn {
  const fn = registry[connectorType];
  if (!fn) {
    throw new UnprocessableError(`no normalizer registered for connector type: ${connectorType}`);
  }
  return fn;
}
