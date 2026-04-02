import { GetObjectCommand, ListObjectsV2Command, SelectObjectContentCommand, S3Client } from "@aws-sdk/client-s3";
import { AppConfig } from "../../config/index.js";
import { EventRecord } from "../../domain/models/event.js";
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

// S3 Select input/output serialization for JSONL files
const JSON_LINES_INPUT = { JSON: { Type: "LINES" as const } };
const JSON_LINES_OUTPUT = { JSON: {} };

export interface S3DataLakeReaderOptions {
  /** When false, falls back to GetObject + in-memory filtering (for LocalStack). Default: true. */
  useS3Select?: boolean;
}

export class S3DataLakeReader implements DataLakeReader {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly useS3Select: boolean;

  constructor(config: AppConfig, opts?: S3DataLakeReaderOptions) {
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
    this.useS3Select = opts?.useS3Select ?? true;
  }

  // ── Public interface ──────────────────────────────────────────

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const segmentKeys = await this.getAllSegmentKeys();

    let allMatched: EventRecord[];
    if (this.useS3Select) {
      const { sql } = this.buildQuerySql(query);
      const results = await Promise.all(
        segmentKeys.map((key) => this.selectFromSegment<EventRecord>(key, sql))
      );
      allMatched = results.flat();
    } else {
      const results = await Promise.all(
        segmentKeys.map((key) => this.readJsonLines<EventRecord>(key))
      );
      allMatched = this.applyQueryFilter(results.flat(), query);
    }

    const total = allMatched.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const paged = allMatched.slice(offset, offset + limit);

    return { events: paged, total };
  }

  async findEventById(eventId: string): Promise<EventRecord | undefined> {
    const segmentKeys = await this.getAllSegmentKeys();

    if (this.useS3Select) {
      const sql = `SELECT * FROM s3object s WHERE s.event_id = '${this.escapeSql(eventId)}'`;
      const results = await Promise.all(
        segmentKeys.map((key) => this.selectFromSegment<EventRecord>(key, sql))
      );
      for (const batch of results) {
        if (batch.length > 0) return batch[0];
      }
    } else {
      const results = await Promise.all(
        segmentKeys.map((key) => this.readJsonLines<EventRecord>(key))
      );
      for (const batch of results) {
        const found = batch.find((r) => r.event_id === eventId);
        if (found) return found;
      }
    }

    return undefined;
  }

  async getDistinctEventTypes(): Promise<string[]> {
    const segmentKeys = await this.getAllSegmentKeys();
    const types = new Set<string>();

    if (this.useS3Select) {
      const sql = `SELECT s.event_type FROM s3object s`;
      const results = await Promise.all(
        segmentKeys.map((key) =>
          this.selectFromSegment<{ event_type: string }>(key, sql)
        )
      );
      for (const batch of results) {
        for (const row of batch) types.add(row.event_type);
      }
    } else {
      const results = await Promise.all(
        segmentKeys.map((key) => this.readJsonLines<EventRecord>(key))
      );
      for (const batch of results) {
        for (const row of batch) types.add(row.event_type);
      }
    }

    return [...types];
  }

  async getGroupProjection(fields: string[], eventType?: string): Promise<Record<string, unknown>[]> {
    const segmentKeys = await this.getAllSegmentKeys();

    if (this.useS3Select) {
      const projection = fields.map((f) => `s.${f}`).join(", ");
      const where = eventType
        ? ` WHERE s.event_type = '${this.escapeSql(eventType)}'`
        : "";
      const sql = `SELECT ${projection} FROM s3object s${where}`;
      const results = await Promise.all(
        segmentKeys.map((key) =>
          this.selectFromSegment<Record<string, unknown>>(key, sql)
        )
      );
      return results.flat();
    }

    // Fallback: read full records, filter by eventType, then project
    const results = await Promise.all(
      segmentKeys.map((key) => this.readJsonLines<Record<string, unknown>>(key))
    );
    let all = results.flat();
    if (eventType) {
      all = all.filter((r) => (r as Record<string, unknown>).event_type === eventType);
    }
    return all.map((row) => {
      const projected: Record<string, unknown> = {};
      for (const f of fields) {
        const parts = f.split(".");
        if (parts.length === 1) {
          projected[f] = row[f];
        } else {
          // Rebuild nested object so consumers can traverse row.attribute.X
          let cursor = projected;
          for (let i = 0; i < parts.length - 1; i++) {
            if (cursor[parts[i]] == null) cursor[parts[i]] = {};
            cursor = cursor[parts[i]] as Record<string, unknown>;
          }
          cursor[parts[parts.length - 1]] = this.getNestedField(row, f);
        }
      }
      return projected;
    });
  }

  async readDataset(
    datasetId: string,
    onBatch: (events: EventRecord[]) => Promise<void>,
  ): Promise<void> {
    const manifestKey = `datasets/${datasetId}/manifest.json`;
    const manifest = await this.readJson<ManifestJson>(manifestKey);

    for (const segmentUri of manifest.segments) {
      const segKey = this.getKeyFromS3Uri(segmentUri);
      const events = await this.readJsonLines<EventRecord>(segKey);
      if (events.length > 0) {
        await onBatch(events);
      }
    }
  }

  // ── SQL builder ───────────────────────────────────────────────

  private buildQuerySql(query: EventQuery): { sql: string; params: string[] } {
    const conditions: string[] = [];

    if (query.dataset_type === "esg") {
      conditions.push(`s.event_type = 'esg_metric'`);
    } else if (query.dataset_type === "housing") {
      conditions.push(`s.event_type = 'housing_sale'`);
    }

    // ESG fields
    if (query.company_name) {
      conditions.push(
        `LOWER(s.attribute.company_name) LIKE '%${this.escapeSql(query.company_name.toLowerCase())}%'`
      );
    }
    if (query.permid) {
      conditions.push(`s.attribute.permid = '${this.escapeSql(query.permid)}'`);
    }
    if (query.metric_name) {
      conditions.push(
        `LOWER(s.attribute.metric_name) LIKE '%${this.escapeSql(query.metric_name.toLowerCase())}%'`
      );
    }
    if (query.pillar) {
      conditions.push(
        `LOWER(s.attribute.pillar) = '${this.escapeSql(query.pillar.toLowerCase())}'`
      );
    }
    if (query.year_from != null) {
      conditions.push(
        `CAST(s.attribute.metric_year AS INT) >= ${Number(query.year_from)}`
      );
    }
    if (query.year_to != null) {
      conditions.push(
        `CAST(s.attribute.metric_year AS INT) <= ${Number(query.year_to)}`
      );
    }

    // Housing fields
    if (query.postcode != null) {
      conditions.push(`s.attribute.postcode = ${Number(query.postcode)}`);
    }
    if (query.suburb) {
      conditions.push(
        `LOWER(s.attribute.suburb) = '${this.escapeSql(query.suburb.toLowerCase())}'`
      );
    }
    if (query.street_name) {
      conditions.push(
        `LOWER(s.attribute.street_name) LIKE '%${this.escapeSql(query.street_name.toLowerCase())}%'`
      );
    }
    if (query.nature_of_property) {
      conditions.push(
        `LOWER(s.attribute.nature_of_property) = '${this.escapeSql(query.nature_of_property.toLowerCase())}'`
      );
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    return { sql: `SELECT * FROM s3object s${where}`, params: [] };
  }

  private escapeSql(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
  }

  // ── S3 Select execution ───────────────────────────────────────

  private async selectFromSegment<T>(key: string, sql: string): Promise<T[]> {
    const response = await this.s3.send(
      new SelectObjectContentCommand({
        Bucket: this.bucket,
        Key: key,
        Expression: sql,
        ExpressionType: "SQL",
        InputSerialization: JSON_LINES_INPUT,
        OutputSerialization: JSON_LINES_OUTPUT,
      })
    );

    const results: T[] = [];
    if (!response.Payload) return results;

    for await (const event of response.Payload) {
      if (event.Records?.Payload) {
        const chunk = new TextDecoder().decode(event.Records.Payload);
        const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          results.push(JSON.parse(line) as T);
        }
      }
    }

    return results;
  }

  // ── GetObject fallback (for LocalStack / tests) ────────────

  private async readJsonLines<T>(key: string): Promise<T[]> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const body = await response.Body?.transformToString();
    if (!body) return [];
    return body
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  }

  private applyQueryFilter(events: EventRecord[], query: EventQuery): EventRecord[] {
    return events.filter((e) => {
      if (query.dataset_type === "esg" && e.event_type !== "esg_metric") return false;
      if (query.dataset_type === "housing" && e.event_type !== "housing_sale") return false;

      const attr = (e.attribute ?? {}) as Record<string, unknown>;
      
      // ESG fields
      if (query.company_name && !String(attr.company_name ?? "").toLowerCase().includes(query.company_name.toLowerCase())) return false;
      if (query.permid && String(attr.permid ?? "") !== query.permid) return false;
      if (query.metric_name && !String(attr.metric_name ?? "").toLowerCase().includes(query.metric_name.toLowerCase())) return false;
      if (query.pillar && String(attr.pillar ?? "").toLowerCase() !== query.pillar.toLowerCase()) return false;
      if (query.year_from != null && Number(attr.metric_year ?? 0) < query.year_from) return false;
      if (query.year_to != null && Number(attr.metric_year ?? 0) > query.year_to) return false;
      
      // Housing fields
      if (query.postcode != null && Number(attr.postcode ?? 0) !== query.postcode) return false;
      if (query.suburb && String(attr.suburb ?? "").toLowerCase() !== query.suburb.toLowerCase()) return false;
      if (query.street_name && !String(attr.street_name ?? "").toLowerCase().includes(query.street_name.toLowerCase())) return false;
      if (query.nature_of_property && String(attr.nature_of_property ?? "").toLowerCase() !== query.nature_of_property.toLowerCase()) return false;
      
      return true;
    });
  }

  private getNestedField(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // ── Segment key resolution ────────────────────────────────────

  private async getAllSegmentKeys(): Promise<string[]> {
    const manifestKeys = await this.listManifestKeys();
    const segmentKeys: string[] = [];

    // Read manifests in parallel
    const manifests = await Promise.all(
      manifestKeys.map((k) => this.readJson<ManifestJson>(k))
    );

    for (const manifest of manifests) {
      for (const uri of manifest.segments) {
        segmentKeys.push(this.getKeyFromS3Uri(uri));
      }
    }

    return segmentKeys;
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

  private getKeyFromS3Uri(uri: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!uri.startsWith(prefix)) {
      throw new Error(`S3 URI is not from the expected bucket: ${uri}`);
    }
    return uri.slice(prefix.length);
  }
}