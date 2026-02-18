import { Router, Request, Response } from "express";

/** @openapi
 * /preprocessing/health:
 *   get:
 *     summary: Preprocessing domain health check
 *     tags: [Preprocessing]
 *     responses:
 *       200:
 *         description: OK
 */
export function createPreprocessingRouter(): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ domain: "preprocessing", status: "not_implemented" });
  });

  return router;
}
