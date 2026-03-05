export interface PresignResult {
  upload_url: string;
  s3_uri: string;
  expires_in: number;
}

export interface FileUploadService {
  presignPut(filename: string, contentType: string): Promise<PresignResult>;
}
