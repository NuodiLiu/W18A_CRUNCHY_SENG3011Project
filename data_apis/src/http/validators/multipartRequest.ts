import { z } from "zod";

export const multipartInitRequestSchema = z.object({
  filename: z
    .string()
    .min(1)
    .refine((f) => f.endsWith(".csv"), { message: "filename must end with .csv" }),
  content_type: z.enum(["text/csv", "application/octet-stream"]),
  // must be a positive integer representing file size in bytes
  file_size: z.number().int().positive(),
});

export const multipartCompleteRequestSchema = z.object({
  s3_uri: z.string().startsWith("s3://", { message: "s3_uri must start with s3://" }),
  upload_id: z.string().min(1),
  parts: z
    .array(
      z.object({
        part_number: z.number().int().min(1).max(10000),
        etag: z.string().min(1),
      })
    )
    .min(1),
});
