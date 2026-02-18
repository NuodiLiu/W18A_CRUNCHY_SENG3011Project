import { Request, Response } from "express";
import {
  getJobStatus,
  GetJobStatusDeps,
} from "../../application/ingestion/getJobStatus.js";
import { NotFoundError, ValidationError } from "../../domain/errors.js";

export function makeJobController(deps: GetJobStatusDeps) {
  return {
    async getById(req: Request, res: Response): Promise<void> {
      const { jobId } = req.params;
      if (!jobId) {
        throw new ValidationError("Missing jobId path parameter");
      }

      const result = await getJobStatus(jobId, deps);
      if (!result) {
        throw new NotFoundError("Job", jobId);
      }

      res.status(200).json(result);
    },
  };
}
