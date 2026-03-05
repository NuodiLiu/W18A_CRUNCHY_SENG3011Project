import { FileUploadService, PresignResult } from "../../domain/ports/fileUploadService.js";

export interface PresignUploadDeps {
  fileUploadService: FileUploadService;
}

export async function presignUpload(
  filename: string,
  contentType: string,
  deps: PresignUploadDeps
): Promise<PresignResult> {
  return deps.fileUploadService.presignPut(filename, contentType);
}
