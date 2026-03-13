import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AppConfig } from "../../config/index.js";
import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader } from "../../domain/ports/dataLakeReader.js";

interface ManifestJson {
  dataset_id: string;
  data_source: string;
  dataset_type: string;
  time_object: {
    timestamp: string;
    timezone: string;
    duration?: number;
    duration_unit?: string;
  };
  total_events: number;
  segments: string[];
  created_at: string;
}

export class S3DataLakeReader implements DataLakeReader {
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

  public async getAllEvents(): Promise<EventRecord[]> {

    const manifestKeys = await this.listManifestKeys();

    const allEvents: EventRecord[] = [];

    for (const manifestKey of manifestKeys) {

      const manifest = await this.readJson<ManifestJson>(manifestKey);

      for (const segmentUri of manifest.segments) {
        // Convert segment URI into S3 object key
        const segmentKey = this.getKeyFromS3Uri(segmentUri);
        // Read events from file
        const events = await this.readJsonLines<EventRecord>(segmentKey);
        // Add segment events into result
        allEvents.push(...events);
      }
    }

    return allEvents;
  }

  private async listManifestKeys(): Promise<string[]> {

    const manifestKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,

          // Restrict to dataset objects
          Prefix: "datasets/",
          ContinuationToken: continuationToken,
        })
      );

      for (const item of response.Contents ?? []) {

        // Keep only manifest files
        if (item.Key?.endsWith("/manifest.json")) {
          manifestKeys.push(item.Key);
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return manifestKeys;
  }

  // Parse object body as JSON
  private async readJson<T>(key: string): Promise<T> {

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    const body = await response.Body?.transformToString();

    if (!body) {
      throw new Error(`Empty object body for S3 key: ${key}`);
    }

    return JSON.parse(body) as T;
  }

  // Parse one JSON object per line
  private async readJsonLines<T>(key: string): Promise<T[]> {

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    const body = await response.Body?.transformToString();

    if (!body) {
      return [];
    }

    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  private getKeyFromS3Uri(uri: string): string {

    const prefix = `s3://${this.bucket}/`;
  
    // Reject segment URIs from other buckets
    if (!uri.startsWith(prefix)) {
      throw new Error(`S3 URI is not from the expected bucket: ${uri}`);
    }
  
    // Remove bucket prefix from URI
    return uri.slice(prefix.length);
  }
}