import { Router, Request, Response } from "express";

/** @openapi
 * /retrieval/health:
 *   get:
 *     summary: Retrieval domain health check
 *     tags: [Retrieval]
 *     responses:
 *       200:
 *         description: OK
 */
export function createRetrievalRouter(): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ domain: "retrieval", status: "not_implemented" });
  });

  return router;
}
