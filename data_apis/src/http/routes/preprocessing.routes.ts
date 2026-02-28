import { Router, Request, Response } from "express";

export function createPreprocessingRouter(): Router {
  const router = Router();

  // GET /api/v1/preprocessing/health
  router.get("/health", (_req: Request, res: Response) => {
    res.status(501).json({ domain: "preprocessing", status: "not_implemented", endpoint: "GET /api/v1/preprocessing/health" });
  });

  // POST /api/v1/preprocessing/jobs
  router.post("/jobs", (_req: Request, res: Response) => {
    res.status(501).json({ status: "not_implemented", endpoint: "POST /api/v1/preprocessing/jobs" });
  });

  // GET /api/v1/preprocessing/jobs/:jobId
  router.get("/jobs/:jobId", (_req: Request, res: Response) => {
    res.status(501).json({ status: "not_implemented", endpoint: "GET /api/v1/preprocessing/jobs/:jobId" });
  });

  // GET /api/v1/preprocessing/pipelines
  router.get("/pipelines", (_req: Request, res: Response) => {
    res.status(501).json({ status: "not_implemented", endpoint: "GET /api/v1/preprocessing/pipelines" });
  });

  return router;
}
