import { Connector } from "../../domain/ports/connector.js";
import { EsgCsvBatchConnector } from "./esgCsvBatchConnector.js";
import { AppConfig } from "../../config/index.js";
import { UnprocessableError } from "../../domain/errors.js";

const registry: Record<string, (config: AppConfig) => Connector> = {
  esg_csv_batch: (config) => new EsgCsvBatchConnector(config),
};

export function createConnector(
  connectorType: string,
  config: AppConfig
): Connector {
  const factory = registry[connectorType];
  if (!factory) {
    throw new UnprocessableError(`Unknown connector_type: "${connectorType}"`);
  }
  return factory(config);
}
