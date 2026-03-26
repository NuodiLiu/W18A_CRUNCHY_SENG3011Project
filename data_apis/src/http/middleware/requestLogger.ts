import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { logger, emitMetric } from "../../infra/logger.js";

/**
 * Express middleware that logs every HTTP request/response as structured JSON
 * and emits CloudWatch EMF metrics (HttpRequests, HttpErrors, HttpLatency).
 *
 * Attaches `req.log` — a request-scoped child logger carrying `requestId` —
 * so downstream handlers can log in the same trace context.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  const start = Date.now();

  // Propagate request ID back to the caller.
  res.setHeader("x-request-id", requestId);

  // Attach a child logger to the request for use in controllers/handlers.
  (req as Request & { log: typeof logger }).log = logger.child({ requestId });

  logger.info({ requestId, method: req.method, path: req.path }, "http_request");

  res.on("finish", () => {
    const latencyMs = Date.now() - start;
    const isError = res.statusCode >= 500;
    const level = isError ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[level](
      { requestId, method: req.method, path: req.path, status: res.statusCode, latencyMs },
      "http_response",
    );

    // ── EMF metrics ───────────────────────────────────────────────────────
    emitMetric("HttpRequests", 1, "Count", { service: "api", method: req.method });
    emitMetric("HttpLatency", latencyMs, "Milliseconds", { service: "api" });
    if (res.statusCode >= 400) {
      emitMetric("HttpErrors", 1, "Count", {
        service: "api",
        statusCode: String(res.statusCode),
      });
    }
  });

  next();
}
