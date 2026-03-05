import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { AppConfig } from "../../config/index.js";
import { FileUploadService, PresignResult } from "../../domain/ports/fileUploadService.js";

const EXPIRES_IN_SECONDS = 900;

export class S3PresignService implements FileUploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.s3 = new S3Client({
      region: config.region,
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
}
