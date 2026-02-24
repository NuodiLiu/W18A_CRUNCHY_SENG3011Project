import { Router, Request, Response, NextFunction } from "express";
import { makeImportController } from "../controllers/importController.js";
import { CreateImportJobDeps } from "../../application/ingestion/createImportJob.js";

export interface CollectionRouteDeps extends CreateImportJobDeps {}

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
 */
export function createCollectionRouter(deps: CollectionRouteDeps): Router {
  const router = Router();
  const importCtrl = makeImportController(deps);

  router.post("/imports", asyncHandler(importCtrl.create));

  return router;
}
