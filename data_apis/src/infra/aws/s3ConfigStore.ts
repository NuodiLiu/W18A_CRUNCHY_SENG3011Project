import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { JobConfig } from "../../domain/models/jobConfig.js";
import { ConfigStore } from "../../domain/ports/configStore.js";
import { AppConfig } from "../../config/index.js";

export class S3ConfigStore implements ConfigStore {
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
    this.bucket = config.s3ConfigBucket;
  }

  async putConfig(
    connectionId: string,
    jobId: string,
    config: JobConfig
  ): Promise<string> {
    const key = `configs/${connectionId}/${jobId}.json`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(config),
        ContentType: "application/json",
      })
    );

    return `s3://${this.bucket}/${key}`;
  }

  async getConfig(configRef: string): Promise<JobConfig> {
    const { bucket, key } = this.parseS3Uri(configRef);

    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const body = await res.Body!.transformToString("utf-8");
    return JSON.parse(body) as JobConfig;
  }

  private parseS3Uri(uri: string): { bucket: string; key: string } {
    // s3://bucket-name/path/to/key.json
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
    return { bucket: match[1], key: match[2] };
  }
}
