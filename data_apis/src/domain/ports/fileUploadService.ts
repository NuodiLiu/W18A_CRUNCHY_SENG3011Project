export interface PresignResult {
  upload_url: string;
  s3_uri: string;
  expires_in: number;
}

export interface MultipartPart {
  part_number: number;
  upload_url: string;
  byte_range: string;
}

export interface MultipartInitResult {
  upload_id: string;
  s3_uri: string;
  parts: MultipartPart[];
  expires_in: number;
}

export interface CompletedPart {
  part_number: number;
  etag: string;
}

export interface FileUploadService {
  presignPut(filename: string, contentType: string): Promise<PresignResult>;
  initMultipart(filename: string, contentType: string, fileSize: number): Promise<MultipartInitResult>;
  completeMultipart(s3Uri: string, uploadId: string, parts: CompletedPart[]): Promise<string>;
}
