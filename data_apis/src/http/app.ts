import express, { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { createRetrievalRouter } from "./routes/retrieval.routes.js";
import { createPreprocessingRouter } from "./routes/preprocessing.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface AppDeps {}

export function createApp(_deps: AppDeps = {}): Express {
  const app = express();

  // ── Body parsing ──────────────────────────────────
  app.use(express.json());

  // ── Health check ──────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ── Domain routers ────────────────────────────────
  app.use("/api/v1/retrieval", createRetrievalRouter());
  app.use("/api/v1/preprocessing", createPreprocessingRouter());

  // ── Swagger UI (auto-generated from JSDoc) ────────
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: "ESG Data Service API",
        version: "0.1.0",
        description:
          "Collection, Retrieval & Preprocessing APIs — single container.",
      },
      servers: [{ url: "/" }],
    },
    apis: ["./src/http/routes/*.ts", "./dist/http/routes/*.js"],
  });
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api-docs.json", (_req: Request, res: Response) => {
    res.json(swaggerSpec);
  });

  // ── Error handler (must be last) ──────────────────
  app.use(errorHandler);

  return app;
}
