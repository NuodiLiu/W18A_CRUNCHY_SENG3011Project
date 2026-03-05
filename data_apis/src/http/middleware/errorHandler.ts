import { Request, Response, NextFunction } from "express";
import { ValidateError } from "tsoa";
import { AppError } from "../../domain/errors.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// express error middleware (4 params required)
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // tsoa request-validation error → normalise to our VALIDATION_ERROR shape
  if (err instanceof ValidateError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.fields,
      },
    } satisfies ErrorResponse);
    return;
  }

  if (err instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // unexpected error — don't expose internals
  console.error("[unhandled]", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  } satisfies ErrorResponse);
}
