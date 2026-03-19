import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { AppConfig } from "../../config/index.js";
import {
  FileUploadService,
  PresignResult,
  MultipartInitResult,
  CompletedPart,
} from "../../domain/ports/fileUploadService.js";

const EXPIRES_IN_SECONDS = 900;
// longer expiry for large file uploads
const MULTIPART_EXPIRES_IN_SECONDS = 3600;
// 50 MB per part, well above the S3 minimum of 5 MB
const PART_SIZE = 52_428_800;

export class S3PresignService implements FileUploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.s3 = new S3Client({
      region: config.region,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      ...(config.s3Endpoint && {
        endpoint: config.s3Endpoint,
        forcePathStyle: true,
      }),
    });
    this.bucket = config.s3DatalakeBucket;
  }

  async presignPut(filename: string, contentType: string): Promise<PresignResult> {
    const key = `raw-uploads/${randomUUID()}/${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const upload_url = await getSignedUrl(this.s3, command, {
      expiresIn: EXPIRES_IN_SECONDS,
    });

    return {
      upload_url,
      s3_uri: `s3://${this.bucket}/${key}`,
      expires_in: EXPIRES_IN_SECONDS,
    };
  }

  async initMultipart(
    filename: string,
    contentType: string,
    fileSize: number
  ): Promise<MultipartInitResult> {
    const key = `raw-uploads/${randomUUID()}/${filename}`;

    const { UploadId: uploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      })
    );

    if (!uploadId) throw new Error("S3 did not return an upload id");

    const totalParts = Math.ceil(fileSize / PART_SIZE);

    // presign a PUT url for each part in parallel
    const parts = await Promise.all(
      Array.from({ length: totalParts }, async (_, i) => {
        const partNumber = i + 1;
        const start = i * PART_SIZE;
        const end = Math.min(start + PART_SIZE, fileSize) - 1;

        const url = await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: MULTIPART_EXPIRES_IN_SECONDS }
        );

        return { part_number: partNumber, upload_url: url, byte_range: `${start}-${end}` };
      })
    );

    return {
      upload_id: uploadId,
      s3_uri: `s3://${this.bucket}/${key}`,
      parts,
      expires_in: MULTIPART_EXPIRES_IN_SECONDS,
    };
  }

  async completeMultipart(
    s3Uri: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<string> {
    // parse bucket and key from s3://bucket/key
    const withoutScheme = s3Uri.slice(5);
    const slashIdx = withoutScheme.indexOf("/");
    const bucket = withoutScheme.slice(0, slashIdx);
    const key = withoutScheme.slice(slashIdx + 1);

    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.part_number, ETag: p.etag })),
        },
      })
    );

    return s3Uri;
  }
}
