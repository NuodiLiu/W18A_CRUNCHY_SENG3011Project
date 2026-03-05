import { presignUpload } from "../../src/application/uploads/presignUpload";
import { FileUploadService, PresignResult } from "../../src/domain/ports/fileUploadService";

function makeService(overrides: Partial<PresignResult> = {}): FileUploadService {
  return {
    presignPut: jest.fn().mockResolvedValue({
      upload_url: "https://s3.example.com/bucket/raw-uploads/uuid/file.csv?sig=abc",
      s3_uri: "s3://bucket/raw-uploads/uuid/file.csv",
      expires_in: 900,
      ...overrides,
    }),
  };
}

describe("presignUpload", () => {
  it("returns the result from fileUploadService", async () => {
    const svc = makeService();
    const result = await presignUpload("file.csv", "text/csv", { fileUploadService: svc });

    expect(result.upload_url).toContain("https://");
    expect(result.s3_uri).toMatch(/^s3:\/\//);
    expect(result.expires_in).toBe(900);
  });

  it("delegates filename and contentType to the service", async () => {
    const svc = makeService();
    await presignUpload("report.csv", "application/octet-stream", { fileUploadService: svc });

    expect(svc.presignPut).toHaveBeenCalledWith("report.csv", "application/octet-stream");
  });

  it("calls presignPut exactly once", async () => {
    const svc = makeService();
    await presignUpload("report.csv", "text/csv", { fileUploadService: svc });

    expect(svc.presignPut).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from the service", async () => {
    const svc: FileUploadService = {
      presignPut: jest.fn().mockRejectedValue(new Error("S3 unavailable")),
    };

    await expect(
      presignUpload("data.csv", "text/csv", { fileUploadService: svc })
    ).rejects.toThrow("S3 unavailable");
  });
});
