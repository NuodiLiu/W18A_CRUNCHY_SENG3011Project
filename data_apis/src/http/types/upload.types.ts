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

export interface MultipartInitRequestBody {
  /** original filename, must end in .csv */
  filename: string;
  /** MIME type of the file being uploaded */
  content_type: string;
  /** total file size in bytes, used to calculate part count */
  file_size: number;
}

export interface MultipartPart {
  part_number: number;
  /** pre-signed URL to PUT this specific part */
  upload_url: string;
  /** inclusive byte range from the original file, e.g. 0-52428799 */
  byte_range: string;
}

export interface MultipartInitResponse {
  /** S3 multipart upload id, required for the complete step */
  upload_id: string;
  /** s3 uri to use in collection imports after upload is complete */
  s3_uri: string;
  /** ordered list of parts with individual pre-signed PUT URLs */
  parts: MultipartPart[];
  /** seconds until each part upload_url expires */
  expires_in: number;
}

export interface CompletedPartBody {
  part_number: number;
  /** ETag value from the response header of each part PUT request */
  etag: string;
}

export interface MultipartCompleteRequestBody {
  /** s3 uri returned by POST uploads/multipart/init */
  s3_uri: string;
  /** upload id returned by POST uploads/multipart/init */
  upload_id: string;
  /** etag and number for each uploaded part */
  parts: CompletedPartBody[];
}

export interface MultipartCompleteResponse {
  /** s3 uri of the assembled object, ready to use in collection imports */
  s3_uri: string;
}
