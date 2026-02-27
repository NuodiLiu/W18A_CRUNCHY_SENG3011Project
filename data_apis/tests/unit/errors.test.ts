import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  InternalError,
} from "../../src/domain/errors";

describe("AppError hierarchy", () => {
  it("AppError sets message, statusCode, code, and details", () => {
    const err = new AppError("boom", 418, "TEAPOT", { extra: 1 });
    expect(err.message).toBe("boom");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("TEAPOT");
    expect(err.details).toEqual({ extra: 1 });
  });

  it("AppError is an instance of Error", () => {
    const err = new AppError("x", 500, "X");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("AppError name equals class name", () => {
    const err = new AppError("x", 500, "X");
    expect(err.name).toBe("AppError");
  });

  it("AppError captures a stack trace", () => {
    const err = new AppError("x", 500, "X");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("AppError");
  });

  it("details is undefined when omitted", () => {
    const err = new AppError("msg", 400, "C");
    expect(err.details).toBeUndefined();
  });
});

describe("ValidationError", () => {
  it("has statusCode 400 and code VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
  });

  it("carries optional details", () => {
    const details = { field: ["required"] };
    const err = new ValidationError("bad", details);
    expect(err.details).toEqual(details);
  });

  it("is an instanceof AppError and Error", () => {
    const err = new ValidationError("x");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("has statusCode 404 and formatted message", () => {
    const err = new NotFoundError("Job", "abc-123");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Job not found: abc-123");
  });
});

describe("ConflictError", () => {
  it("has statusCode 409", () => {
    const err = new ConflictError("duplicate key");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("duplicate key");
  });
});

describe("UnprocessableError", () => {
  it("has statusCode 422", () => {
    const err = new UnprocessableError("unsupported type");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("UNPROCESSABLE_ENTITY");
    expect(err.message).toBe("unsupported type");
  });
});

describe("InternalError", () => {
  it("has statusCode 500 and default message", () => {
    const err = new InternalError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("Internal server error");
  });

  it("accepts a custom message", () => {
    const err = new InternalError("db down");
    expect(err.message).toBe("db down");
    expect(err.statusCode).toBe(500);
  });
});
