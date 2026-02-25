import { Router, Request, Response } from "express";

/**
 * @openapi
 * components:
 *   schemas:
 *     PreprocessJobRequest:
 *       type: object
 *       required:
 *         - input_s3_uri
 *         - pipeline
 *       properties:
 *         input_s3_uri:
 *           type: string
 *           description: S3 URI of the raw input file or prefix to preprocess
 *           example: "s3://my-bucket/raw/esg-2022.csv"
 *         pipeline:
 *           type: string
 *           description: Name of the built-in pipeline template to apply
 *           example: "esg_clean_v1"
 *         params:
 *           type: object
 *           description: Optional pipeline-specific parameters (key-value pairs)
 *           additionalProperties: true
 *           example:
 *             drop_nulls: true
 *             year_filter: 2022
 *         idempotency_key:
 *           type: string
 *           description: Optional client-supplied key; re-submitting the same key returns the existing job
 *           example: "batch-2022-run-3"
 *     PreprocessJobStatus:
 *       type: object
 *       properties:
 *         job_id:
 *           type: string
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *         status:
 *           type: string
 *           enum: [pending, running, succeeded, failed]
 *           example: "succeeded"
 *         pipeline:
 *           type: string
 *           example: "esg_clean_v1"
 *         input_s3_uri:
 *           type: string
 *           example: "s3://my-bucket/raw/esg-2022.csv"
 *         output_s3_uri:
 *           type: string
 *           nullable: true
 *           description: S3 URI of the cleaned output file (populated on success)
 *           example: "s3://my-bucket/processed/esg-2022-clean.parquet"
 *         manifest_uri:
 *           type: string
 *           nullable: true
 *           description: S3 URI of the job manifest JSON (populated on success)
 *           example: "s3://my-bucket/processed/esg-2022-manifest.json"
 *         quality_report_uri:
 *           type: string
 *           nullable: true
 *           description: S3 URI of the data quality report (populated on success)
 *           example: "s3://my-bucket/processed/esg-2022-quality.json"
 *         error:
 *           type: string
 *           nullable: true
 *           description: Failure reason (populated on failure)
 *         created_at:
 *           type: string
 *           example: "2026-02-25T10:00:00Z"
 *         updated_at:
 *           type: string
 *           example: "2026-02-25T10:05:00Z"
 *     PipelineTemplate:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "esg_clean_v1"
 *         name:
 *           type: string
 *           example: "ESG General Cleansing"
 *         description:
 *           type: string
 *           example: "Drops null metrics, standardises column names, and deduplicates rows."
 *         category:
 *           type: string
 *           enum: [general, time_series, text, esg]
 *           example: "esg"
 *         params_schema:
 *           type: object
 *           description: JSON Schema describing accepted params for this pipeline
 *           additionalProperties: true
 */

/**
 * @openapi
 * /api/v1/preprocessing/health:
 *   get:
 *     summary: Preprocessing domain health check and version info
 *     description: >
 *       Returns the health status of the preprocessing domain along with service
 *       version and runtime information. Intended for use by CI pipelines, load
 *       balancers, and third-party integrators.
 *       **Not yet implemented — returns 501.**
 *     tags: [Preprocessing]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 domain:
 *                   type: string
 *                   example: "preprocessing"
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 version:
 *                   type: string
 *                   example: "0.1.0"
 *                 timestamp:
 *                   type: string
 *                   example: "2026-02-25T10:00:00Z"
 *       501:
 *         description: Not yet implemented
 *
 * /api/v1/preprocessing/jobs:
 *   post:
 *     summary: Submit a preprocessing job
 *     description: >
 *       Accepts an S3 input URI and a pipeline name (plus optional parameters),
 *       enqueues an asynchronous preprocessing job, and immediately returns a
 *       `job_id` for status polling. Supports idempotency via `idempotency_key`.
 *       **Not yet implemented — returns 501.**
 *     tags: [Preprocessing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PreprocessJobRequest'
 *     responses:
 *       202:
 *         description: Job accepted and enqueued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 job_id:
 *                   type: string
 *                   example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 status_url:
 *                   type: string
 *                   example: "/api/v1/preprocessing/jobs/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       400:
 *         description: Validation error (missing required fields or invalid pipeline)
 *       501:
 *         description: Not yet implemented
 *
 * /api/v1/preprocessing/jobs/{jobId}:
 *   get:
 *     summary: Get preprocessing job status and result
 *     description: >
 *       Returns the current status of a preprocessing job along with output locations
 *       (`output_s3_uri`, `manifest_uri`, `quality_report_uri`) once the job succeeds,
 *       or the failure reason if it fails.
 *       **Not yet implemented — returns 501.**
 *     tags: [Preprocessing]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID of the preprocessing job
 *     responses:
 *       200:
 *         description: Job status and result locations
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PreprocessJobStatus'
 *       404:
 *         description: Job not found
 *       501:
 *         description: Not yet implemented
 *
 * /api/v1/preprocessing/pipelines:
 *   get:
 *     summary: List available pipeline templates
 *     description: >
 *       Returns the catalogue of built-in pipeline templates that can be referenced
 *       in a job submission. Each entry includes a unique `id`, human-readable name,
 *       description, category (general / time_series / text / esg), and a JSON Schema
 *       describing its accepted `params`.
 *       **Not yet implemented — returns 501.**
 *     tags: [Preprocessing]
 *     responses:
 *       200:
 *         description: List of available pipeline templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pipelines:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PipelineTemplate'
 *       501:
 *         description: Not yet implemented
 */
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
