import { PipelineTemplate } from "../../http/types/preprocessing.types.js";

export const PIPELINE_CATALOGUE: PipelineTemplate[] = [
  {
    id: "housing_clean_v1",
    name: "Housing Sales Cleaner v1",
    description:
      "Cleans NSW Valuer General property sales data. Filters out zero-price records, " +
      "deduplicates by dealing number, standardises suburb casing, nullifies zero areas, " +
      "and supports optional price/suburb/date/postcode filtering.",
    category: "general",
    params_schema: {
      type: "object",
      properties: {
        suburb: {
          type: "string",
          description: "Only include sales in this suburb (case-insensitive).",
        },
        postcode: {
          type: "number",
          description: "Only include sales with this postcode.",
        },
        price_min: {
          type: "number",
          default: 1,
          description: "Minimum purchase price (exclusive). Defaults to 1 (removes $0 records).",
        },
        price_max: {
          type: "number",
          description: "Maximum purchase price (inclusive). Omit for no upper limit.",
        },
        date_from: {
          type: "string",
          format: "date",
          description: "Earliest contract_date to include (YYYY-MM-DD, inclusive).",
        },
        date_to: {
          type: "string",
          format: "date",
          description: "Latest contract_date to include (YYYY-MM-DD, inclusive).",
        },
        dedup_by_dealing: {
          type: "boolean",
          default: true,
          description: "When true, keeps only the first occurrence of each dealing_number.",
        },
      },
      additionalProperties: false,
    },
  },
];

export function getPipelines(): PipelineTemplate[] {
  return PIPELINE_CATALOGUE;
}
