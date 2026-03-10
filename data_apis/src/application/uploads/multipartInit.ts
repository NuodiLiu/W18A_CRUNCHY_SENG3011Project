import { FileUploadService, MultipartInitResult } from "../../domain/ports/fileUploadService.js";

export interface MultipartInitDeps {
  fileUploadService: FileUploadService;
}

export async function initMultipartUpload(
  filename: string,
  contentType: string,
  fileSize: number,
  deps: MultipartInitDeps
): Promise<MultipartInitResult> {
  return deps.fileUploadService.initMultipart(filename, contentType, fileSize);
}
