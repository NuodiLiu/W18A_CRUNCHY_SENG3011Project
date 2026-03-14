import { PipelineTemplate } from "../../http/types/preprocessing.types.js";

export const PIPELINE_CATALOGUE: PipelineTemplate[] = [
  {
    id: "housing_clean_v1",
    name: "Housing Sales Cleaner v1",
    description:
      "Cleans NSW Valuer General property sales data. Filters out zero-price transfers " +
      "(~24.6% in sample), deduplicates by dealing number, standardises suburb casing, " +
      "nullifies zero areas, fixes corrupted area_type values from CSV parse shift, " +
      "and trims whitespace on string fields.",
    category: "housing",
    params_schema: {
      type: "object",
      properties: {
        price_min: {
          type: "number",
          default: 1,
          description: "Minimum purchase price (exclusive). Defaults to 1 (removes $0 records).",
        },
        dedup_by_dealing: {
          type: "boolean",
          default: true,
          description: "When true, keeps only the first occurrence of each dealing_number.",
        },
        normalize_suburb: {
          type: "boolean",
          default: true,
          description: "When true, converts suburb names to UPPERCASE.",
        },
        nullify_zero_area: {
          type: "boolean",
          default: true,
          description: "When true, converts area = 0 to null.",
        },
        fix_area_type: {
          type: "boolean",
          default: true,
          description: "When true, resets invalid area_type values (e.g. numeric from CSV shift) to empty string.",
        },
        trim_whitespace: {
          type: "boolean",
          default: true,
          description: "When true, trims leading/trailing whitespace on street_name, legal_description, suburb.",
        },
      },
      additionalProperties: false,
    },
  },
];

export function getPipelines(): PipelineTemplate[] {
  return PIPELINE_CATALOGUE;
}
