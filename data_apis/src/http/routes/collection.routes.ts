import { Router, Request, Response, NextFunction } from "express";
import { makeImportController } from "../controllers/importController.js";
import { makeJobController } from "../controllers/jobController.js";
import { CreateImportJobDeps } from "../../application/ingestion/createImportJob.js";
import { GetJobStatusDeps } from "../../application/ingestion/getJobStatus.js";

export interface CollectionRouteDeps extends CreateImportJobDeps, GetJobStatusDeps {}

// catches rejected promises and forwards to error middleware
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** @openapi
 * /api/v1/collection/imports:
 *   post:
 *     summary: Submit a new ESG CSV import job
 *     tags: [Collection]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ImportRequest'
 *     responses:
 *       202:
 *         description: Job accepted
 *       400:
 *         description: Validation error
 * /api/v1/collection/jobs/{jobId}:
 *   get:
 *     summary: Get job status
 *     tags: [Collection]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status
 *       404:
 *         description: Job not found
 */
export function createCollectionRouter(deps: CollectionRouteDeps): Router {
  const router = Router();
  const importCtrl = makeImportController(deps);
  const jobCtrl = makeJobController(deps);

  router.post("/imports", asyncHandler(importCtrl.create));
  router.get("/jobs/:jobId", asyncHandler(jobCtrl.getById));

  return router;
}
