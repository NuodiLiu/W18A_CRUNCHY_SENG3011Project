import express, { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { RegisterRoutes } from "./generated/routes.js";
import { initDeps, AppDeps } from "./ioc.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// tsoa generates swagger.json into src/docs/ at build time.
// process.cwd() is the project root (data_apis/) in both dev and prod.
const swaggerDocument = JSON.parse(
  readFileSync(join(process.cwd(), "src/docs/swagger.json"), "utf-8")
) as object;

export type { AppDeps };

export function createApp(deps: AppDeps): Express {
  const app = express();

  // ── Body parsing ──────────────────────────────────
  app.use(express.json());

  // ── Wire tsoa IoC container ───────────────────────
  initDeps(deps);

  // ── Register tsoa-generated routes ───────────────
  RegisterRoutes(app);

  // ── Swagger UI ────────────────────────────────────
  // Use CDN assets so swagger-ui renders correctly on Lambda (local static
  // files served by express.static don't survive API Gateway binary encoding).
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument, {
      customCssUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui.min.css",
      customJs: [
        "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-bundle.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-standalone-preset.min.js",
      ],
    })
  );
  app.get("/api-docs.json", (_req: Request, res: Response) => {
    res.json(swaggerDocument);
  });

  // ── Error handler (must be last) ──────────────────
  app.use(errorHandler);

  return app;
}
