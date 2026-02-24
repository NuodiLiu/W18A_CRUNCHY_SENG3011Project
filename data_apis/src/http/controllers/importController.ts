import { Request, Response } from "express";
import { importRequestSchema } from "../validators/importRequest.js";
import {
  createImportJob,
  CreateImportJobDeps,
} from "../../application/ingestion/createImportJob.js";
import { ValidationError } from "../../domain/errors.js";

export function makeImportController(deps: CreateImportJobDeps) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const parsed = importRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Import request validation failed",
          parsed.error.flatten().fieldErrors
        );
      }

      const result = await createImportJob(parsed.data, deps);

      res.status(202).json({
        job_id: result.job_id,
        connection_id: result.connection_id,
        status_url: result.status_url,
      });
    },
  };
}
