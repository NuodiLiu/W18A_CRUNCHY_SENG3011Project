import { z } from "zod";

export const presignRequestSchema = z.object({
  filename: z
    .string()
    .min(1)
    .refine((f) => f.endsWith(".csv"), { message: "filename must end with .csv" }),
  content_type: z.enum(["text/csv", "application/octet-stream"]),
});

export type PresignRequestBody = z.infer<typeof presignRequestSchema>;
