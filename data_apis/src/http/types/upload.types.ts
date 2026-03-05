export interface PresignRequestBody {
  /** original filename, must end in .csv */
  filename: string;
  /** MIME type of the file being uploaded */
  content_type: string;
}

export interface PresignResponse {
  /** pre-signed S3 PUT URL valid for expires_in seconds */
  upload_url: string;
  /** s3 uri to pass to POST /collection/imports as source_spec.s3_uris */
  s3_uri: string;
  /** seconds until upload_url expires */
  expires_in: number;
}
