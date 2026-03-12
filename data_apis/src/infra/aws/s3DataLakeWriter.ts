import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { EventRecord } from "../../domain/models/event.js";
import { DataLakeWriter, DatasetMetadata } from "../../domain/ports/dataLakeWriter.js";
import { AppConfig } from "../../config/index.js";

interface ManifestJson {
  dataset_id: string;
  data_source: string;
  dataset_type: string;
  time_object: DatasetMetadata["time_object"];
  total_events: number;
  segments: string[];
  created_at: string;
}

export class S3DataLakeWriter implements DataLakeWriter {
  private readonly s3: S3Client;
  private readonly bucket: string;

  // Per-dataset state kept across writeChunk() calls until finalise()
  private readonly segmentKeys = new Map<string, string[]>();
  private readonly segmentCounters = new Map<string, number>();

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

  async writeChunk(events: EventRecord[], datasetId: string): Promise<void> {
    const index = this.segmentCounters.get(datasetId) ?? 0;
    const segKey = `datasets/${datasetId}/segments/part-${String(index + 1).padStart(5, "0")}.jsonl`;
    const jsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: segKey,
        Body: jsonl,
        ContentType: "application/x-ndjson",
      })
    );

    const keys = this.segmentKeys.get(datasetId) ?? [];
    keys.push(`s3://${this.bucket}/${segKey}`);
    this.segmentKeys.set(datasetId, keys);
    this.segmentCounters.set(datasetId, index + 1);
  }

  async finalise(datasetId: string, metadata: DatasetMetadata): Promise<string> {
    const segmentKeys = this.segmentKeys.get(datasetId) ?? [];

    // clear per-dataset state
    this.segmentKeys.delete(datasetId);
    this.segmentCounters.delete(datasetId);

    const manifestKey = `datasets/${datasetId}/manifest.json`;
    const datasetUri = `s3://${this.bucket}/${manifestKey}`;

    const manifest: ManifestJson = {
      dataset_id: datasetUri,
      data_source: metadata.data_source,
      dataset_type: metadata.dataset_type,
      time_object: metadata.time_object,
      total_events: metadata.total_events,
      segments: segmentKeys,
      created_at: new Date().toISOString(),
    };

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
      })
    );

    return datasetUri;
  }
}
