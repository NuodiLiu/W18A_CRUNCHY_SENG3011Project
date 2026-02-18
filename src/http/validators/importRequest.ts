import { z } from "zod";

const sourceSpecSchema = z
  .object({
    s3_uris: z.array(z.string().startsWith("s3://")).optional(),
    s3_prefix: z.string().startsWith("s3://").optional(),
    delimiter: z.string().max(5).default(","),
    has_header: z.boolean().default(true),
    timezone: z.string().min(1),
    time_column: z.string().optional(),
  })
  .refine(
    (spec) =>
      (spec.s3_uris !== undefined && spec.s3_uris.length > 0) ||
      spec.s3_prefix !== undefined,
    { message: "source_spec must provide either s3_uris (non-empty) or s3_prefix" }
  );

export const importRequestSchema = z.object({
  connector_type: z.literal("esg_csv_batch"),
  source_spec: sourceSpecSchema,
  mapping_profile: z.string().min(1),
  data_source: z.string().min(1),
  dataset_type: z.string().min(1),
  ingestion_mode: z.enum(["incremental", "full_refresh"]),
  idempotency_key: z.string().optional(),
});

export type ImportRequestBody = z.infer<typeof importRequestSchema>;
