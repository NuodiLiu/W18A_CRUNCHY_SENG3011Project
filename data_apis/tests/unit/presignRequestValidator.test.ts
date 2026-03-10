import { presignRequestSchema } from "../../src/http/validators/presignRequest";

describe("presignRequestSchema", () => {
  it("accepts valid csv filename and text/csv content type", () => {
    const result = presignRequestSchema.safeParse({
      filename: "report.csv",
      content_type: "text/csv",
    });
    expect(result.success).toBe(true);
  });

  it("accepts application/octet-stream content type", () => {
    const result = presignRequestSchema.safeParse({
      filename: "data.csv",
      content_type: "application/octet-stream",
    });
    expect(result.success).toBe(true);
  });

  it("rejects filename not ending in .csv", () => {
    const result = presignRequestSchema.safeParse({
      filename: "report.xlsx",
      content_type: "text/csv",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty filename", () => {
    const result = presignRequestSchema.safeParse({
      filename: "",
      content_type: "text/csv",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported content type", () => {
    const result = presignRequestSchema.safeParse({
      filename: "data.csv",
      content_type: "application/json",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing filename", () => {
    const result = presignRequestSchema.safeParse({
      content_type: "text/csv",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing content_type", () => {
    const result = presignRequestSchema.safeParse({
      filename: "data.csv",
    });
    expect(result.success).toBe(false);
  });
});
