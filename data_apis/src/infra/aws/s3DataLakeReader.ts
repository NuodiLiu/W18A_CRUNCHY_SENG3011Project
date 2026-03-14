import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AppConfig } from "../../config/index.js";
import { EventRecord, EsgMetricAttribute } from "../../domain/models/event.js";
import { DataLakeReader, EventQuery, EventQueryResult } from "../../domain/ports/dataLakeReader.js";

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

  // Simple TTL cache to avoid repeated S3 reads within the same Lambda warm container
  private cachedEvents: EventRecord[] | null = null;
  private cacheExpiry = 0;
  private static readonly CACHE_TTL_MS = 60_000; // 60 seconds

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

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const allEvents = await this.loadAllEvents();

    let filtered = allEvents;

    if (query.company_name) {
      const name = query.company_name.toLowerCase();
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.company_name?.toLowerCase().includes(name);
      });
    }
    if (query.permid) {
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.permid === query.permid;
      });
    }
    if (query.metric_name) {
      const name = query.metric_name.toLowerCase();
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.metric_name?.toLowerCase().includes(name);
      });
    }
    if (query.pillar) {
      const pillar = query.pillar.toLowerCase();
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.pillar?.toLowerCase() === pillar;
      });
    }
    if (query.year_from != null) {
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.metric_year != null && attr.metric_year >= query.year_from!;
      });
    }
    if (query.year_to != null) {
      filtered = filtered.filter((e) => {
        const attr = e.attribute as Partial<EsgMetricAttribute>;
        return attr.metric_year != null && attr.metric_year <= query.year_to!;
      });
    }

    const total = filtered.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const paged = filtered.slice(offset, offset + limit);

    return { events: paged, total };
  }

  async findEventById(eventId: string): Promise<EventRecord | undefined> {
    const allEvents = await this.loadAllEvents();
    return allEvents.find((e) => e.event_id === eventId);
  }

  async getDistinctEventTypes(): Promise<string[]> {
    const allEvents = await this.loadAllEvents();
    return [...new Set(allEvents.map((e) => e.event_type))];
  }

  // ── Internal helpers ──────────────────────────────────────────

  private async loadAllEvents(): Promise<EventRecord[]> {
    const now = Date.now();
    if (this.cachedEvents && now < this.cacheExpiry) {
      return this.cachedEvents;
    }

    const manifestKeys = await this.listManifestKeys();
    const allEvents: EventRecord[] = [];

    for (const manifestKey of manifestKeys) {
      const manifest = await this.readJson<ManifestJson>(manifestKey);
      for (const segmentUri of manifest.segments) {
        const segmentKey = this.getKeyFromS3Uri(segmentUri);
        const events = await this.readJsonLines<EventRecord>(segmentKey);
        allEvents.push(...events);
      }
    }

    this.cachedEvents = allEvents;
    this.cacheExpiry = Date.now() + S3DataLakeReader.CACHE_TTL_MS;

    return allEvents;
  }

  private async listManifestKeys(): Promise<string[]> {
    const manifestKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: "datasets/",
          ContinuationToken: continuationToken,
        })
      );

      for (const item of response.Contents ?? []) {
        if (item.Key?.endsWith("/manifest.json")) {
          manifestKeys.push(item.Key);
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return manifestKeys;
  }

  private async readJson<T>(key: string): Promise<T> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const body = await response.Body?.transformToString();
    if (!body) {
      throw new Error(`Empty object body for S3 key: ${key}`);
    }
    return JSON.parse(body) as T;
  }

  private async readJsonLines<T>(key: string): Promise<T[]> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const body = await response.Body?.transformToString();
    if (!body) return [];

    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  private getKeyFromS3Uri(uri: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!uri.startsWith(prefix)) {
      throw new Error(`S3 URI is not from the expected bucket: ${uri}`);
    }
    return uri.slice(prefix.length);
  }
}