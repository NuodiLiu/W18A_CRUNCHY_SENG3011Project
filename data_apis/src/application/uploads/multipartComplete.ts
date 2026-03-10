import { CompletedPart, FileUploadService } from "../../domain/ports/fileUploadService.js";

export interface MultipartCompleteDeps {
  fileUploadService: FileUploadService;
}

export async function completeMultipartUpload(
  s3Uri: string,
  uploadId: string,
  parts: CompletedPart[],
  deps: MultipartCompleteDeps
): Promise<{ s3_uri: string }> {
  const uri = await deps.fileUploadService.completeMultipart(s3Uri, uploadId, parts);
  return { s3_uri: uri };
}
