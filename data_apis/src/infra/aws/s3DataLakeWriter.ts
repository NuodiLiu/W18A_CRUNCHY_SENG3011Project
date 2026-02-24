import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { EventDataset, EventRecord } from "../../domain/models/event.js";
import { DataLakeWriter } from "../../domain/ports/dataLakeWriter.js";
import { AppConfig } from "../../config/index.js";

const SEGMENT_MAX_EVENTS = 10_000;

interface ManifestJson {
  dataset_id: string;
  data_source: string;
  dataset_type: string;
  time_object: EventDataset["time_object"];
  total_events: number;
  segments: string[];
  created_at: string;
}

export class S3DataLakeWriter implements DataLakeWriter {
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

  async writeDataset(
    dataset: EventDataset,
    datasetId: string
  ): Promise<string> {
    const prefix = `datasets/${datasetId}`;
    const segmentKeys: string[] = [];

    // Split events into segments
    const chunks = this.chunk(dataset.events, SEGMENT_MAX_EVENTS);

    for (let i = 0; i < chunks.length; i++) {
      const segKey = `${prefix}/segments/part-${String(i + 1).padStart(5, "0")}.jsonl`;
      const jsonl = chunks[i].map((e) => JSON.stringify(e)).join("\n") + "\n";

      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: segKey,
          Body: jsonl,
          ContentType: "application/x-ndjson",
        })
      );
      segmentKeys.push(`s3://${this.bucket}/${segKey}`);
    }

    // Write manifest
    const manifestKey = `${prefix}/manifest.json`;
    const datasetUri = `s3://${this.bucket}/${manifestKey}`;

    const manifest: ManifestJson = {
      dataset_id: datasetUri,
      data_source: dataset.data_source,
      dataset_type: dataset.dataset_type,
      time_object: dataset.time_object,
      total_events: dataset.events.length,
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

  private chunk(arr: EventRecord[], size: number): EventRecord[][] {
    if (arr.length === 0) return [[]];
    const result: EventRecord[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
