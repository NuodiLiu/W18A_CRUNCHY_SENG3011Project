import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { errorHandler } from "../../src/http/middleware/errorHandler";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  InternalError,
} from "../../src/domain/errors";

function buildApp(thrower: (req: Request, res: Response, next: NextFunction) => void) {
  const app = express();
  app.get("/test", thrower);
  app.use(errorHandler);
  return app;
}

describe("errorHandler middleware", () => {
  it("returns 400 for ValidationError with details", async () => {
    const app = buildApp((_req, _res, next) => {
      next(new ValidationError("bad input", { name: ["required"] }));
    });

    const res = await request(app).get("/test").expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBe("bad input");
    expect(res.body.error.details).toEqual({ name: ["required"] });
  });

  it("returns 404 for NotFoundError without details field", async () => {
    const app = buildApp((_req, _res, next) => {
      next(new NotFoundError("Job", "xyz"));
    });

    const res = await request(app).get("/test").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Job not found: xyz");
    expect(res.body.error.details).toBeUndefined();
  });

  it("returns 409 for ConflictError", async () => {
    const app = buildApp((_req, _res, next) => {
      next(new ConflictError("already exists"));
    });

    const res = await request(app).get("/test").expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("returns 422 for UnprocessableError", async () => {
    const app = buildApp((_req, _res, next) => {
      next(new UnprocessableError("unsupported connector"));
    });

    const res = await request(app).get("/test").expect(422);
    expect(res.body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("returns 500 for InternalError", async () => {
    const app = buildApp((_req, _res, next) => {
      next(new InternalError());
    });

    const res = await request(app).get("/test").expect(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe("Internal server error");
  });

  it("returns generic 500 for unknown Error (does not leak internals)", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const app = buildApp((_req, _res, next) => {
      next(new Error("secret database password"));
    });

    const res = await request(app).get("/test").expect(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe("Internal server error");
    expect(res.body.error.message).not.toContain("secret");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns generic 500 for non-Error thrown values", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const app = buildApp((_req, _res, next) => {
      next("string error");
    });

    const res = await request(app).get("/test").expect(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    consoleSpy.mockRestore();
  });
});
