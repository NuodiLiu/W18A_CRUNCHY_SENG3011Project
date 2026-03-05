import { RawRecord } from "../../domain/ports/connector.js";
import { EventRecord } from "../../domain/models/event.js";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { UnprocessableError } from "../../domain/errors.js";
import { normalizeEsgMetrics } from "./normalizeEsgMetrics.js";
import { normalizeHousingSales } from "./normalizeHousingSales.js";

export type NormalizeFn = (
  records: RawRecord[],
  config: JobConfig,
  runTimestamp: string,
) => EventRecord[];

// keyed by mapping_profile so the same connector can serve multiple dataset types
const registry: Record<string, NormalizeFn> = {
  esg_v1: normalizeEsgMetrics,
  housing_v1: normalizeHousingSales,
};

export function getNormalizer(mappingProfile: string): NormalizeFn {
  const fn = registry[mappingProfile];
  if (!fn) {
    throw new UnprocessableError(`no normalizer registered for mapping profile: ${mappingProfile}`);
  }
  return fn;
}
