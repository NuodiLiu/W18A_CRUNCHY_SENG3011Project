import {
  CompletedPart,
  PresignResult,
  MultipartInitResult,
} from "../../domain/ports/fileUploadService.js";
import {
  CompletedPartBody,
  MultipartCompleteResponse,
  PresignResponse,
  MultipartInitResponse,
} from "../types/upload.types.js";

export function toPresignResponse(result: PresignResult): PresignResponse {
  return {
    upload_url: result.upload_url,
    s3_uri: result.s3_uri,
    expires_in: result.expires_in,
  };
}

export function toMultipartInitResponse(result: MultipartInitResult): MultipartInitResponse {
  return {
    upload_id: result.upload_id,
    s3_uri: result.s3_uri,
    parts: result.parts.map((p) => ({
      part_number: p.part_number,
      upload_url: p.upload_url,
      byte_range: p.byte_range,
    })),
    expires_in: result.expires_in,
  };
}

// Inbound: HTTP request parts → Domain port type
export function toCompletedParts(parts: CompletedPartBody[]): CompletedPart[] {
  return parts.map((p) => ({ part_number: p.part_number, etag: p.etag }));
}

// Outbound: Application result → HTTP response DTO
export function toMultipartCompleteResponse(result: { s3_uri: string }): MultipartCompleteResponse {
  return { s3_uri: result.s3_uri };
}
