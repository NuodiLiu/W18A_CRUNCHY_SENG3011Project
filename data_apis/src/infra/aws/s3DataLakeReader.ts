import { GetObjectCommand, ListObjectsV2Command, SelectObjectContentCommand, S3Client } from "@aws-sdk/client-s3";
import { AppConfig } from "../../config/index.js";
import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader, VisualisationReader, EventQuery, EventQueryResult, BreakdownQuery, BreakdownResult } from "../../domain/ports/dataLakeReader.js";

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

export class S3DataLakeReader implements DataLakeReader, VisualisationReader {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly useS3Select: boolean;

  constructor(config: AppConfig, opts?: S3DataLakeReaderOptions) {
    this.s3 = new S3Client({
      region: config.region,
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

  async getGroupProjection(fields: string[]): Promise<Record<string, unknown>[]> {
    const segmentKeys = await this.getAllSegmentKeys();

    if (this.useS3Select) {
      const projection = fields.map((f) => `s.${f}`).join(", ");
      const sql = `SELECT ${projection} FROM s3object s`;
      const results = await Promise.all(
        segmentKeys.map((key) =>
          this.selectFromSegment<Record<string, unknown>>(key, sql)
        )
      );
      return results.flat();
    }

    // Fallback: read full records and reconstruct nested projection structure
    const results = await Promise.all(
      segmentKeys.map((key) => this.readJsonLines<Record<string, unknown>>(key))
    );
    return results.flat().map((row) => {
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

  async getAllEvents(): Promise<EventRecord[]> {
    const segmentKeys = await this.getAllSegmentKeys();

    if (this.useS3Select) {
      const sql = `SELECT * FROM s3object s`;
      const results = await Promise.all(
        segmentKeys.map((key) => this.selectFromSegment<EventRecord>(key, sql))
      );
      return results.flat();
    }

    const results = await Promise.all(
      segmentKeys.map((key) => this.readJsonLines<EventRecord>(key))
    );
    return results.flat();
  }

  async getAggregatedBreakdown(query: BreakdownQuery): Promise<BreakdownResult> {
    const { event_type, dimension, metric, aggregation, limit = 10, year_from, year_to } = query;
    const segmentKeys = await this.getAllSegmentKeys();

    // Build SQL to filter and project only needed fields
    const sql = this.buildBreakdownSql(event_type, dimension, metric, year_from, year_to);

    let rows: Array<{ dimension_value: string; metric_value: number | null }>;
    if (this.useS3Select) {
      const results = await Promise.all(
        segmentKeys.map((key) =>
          this.selectFromSegment<{ dimension_value: string; metric_value: number | null }>(key, sql)
        )
      );
      rows = results.flat();
    } else {
      // Fallback: read all and filter in memory
      const results = await Promise.all(
        segmentKeys.map((key) => this.readJsonLines<EventRecord>(key))
      );
      rows = this.applyBreakdownFilter(results.flat(), query);
    }

    // Aggregate in memory (since S3 Select runs per-file)
    const groups = new Map<string, { values: number[]; count: number }>();
    for (const row of rows) {
      const category = String(row.dimension_value ?? "unknown");
      if (!groups.has(category)) {
        groups.set(category, { values: [], count: 0 });
      }
      const group = groups.get(category)!;
      group.count++;
      if (metric !== "count" && row.metric_value !== null && !isNaN(row.metric_value)) {
        group.values.push(row.metric_value);
      }
    }

    // Calculate aggregated values
    const entries = Array.from(groups.entries()).map(([category, group]) => ({
      category,
      value: this.calculateAggregation(group.values, group.count, aggregation, metric),
      count: group.count,
    }));

    // Sort by value descending and limit
    entries.sort((a, b) => b.value - a.value);
    const limited = entries.slice(0, limit);

    return {
      dimension,
      metric,
      aggregation,
      event_type,
      entries: limited,
    };
  }

  // ── SQL builder ───────────────────────────────────────────────

  private buildQuerySql(query: EventQuery): { sql: string; params: string[] } {
    const conditions: string[] = [];

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

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    return { sql: `SELECT * FROM s3object s${where}`, params: [] };
  }

  private escapeSql(value: string): string {
    return value.replace(/'/g, "''");
  }

  private buildBreakdownSql(
    event_type: string,
    dimension: string,
    metric: string,
    year_from?: number,
    year_to?: number
  ): string {
    const conditions: string[] = [`s.event_type = '${this.escapeSql(event_type)}'`];

    // Year filtering - handle both ESG (metric_year) and Housing (contract_date) data
    if (year_from != null) {
      conditions.push(
        `(CAST(s.attribute.metric_year AS INT) >= ${Number(year_from)} OR SUBSTRING(s.attribute.contract_date, 1, 4) >= '${year_from}')`
      );
    }
    if (year_to != null) {
      conditions.push(
        `(CAST(s.attribute.metric_year AS INT) <= ${Number(year_to)} OR SUBSTRING(s.attribute.contract_date, 1, 4) <= '${year_to}')`
      );
    }

    const where = conditions.join(" AND ");

    // Handle derived dimensions like contract_year
    let dimensionExpr: string;
    if (dimension === "contract_year") {
      dimensionExpr = `SUBSTRING(s.attribute.contract_date, 1, 4)`;
    } else {
      dimensionExpr = `s.attribute.${dimension}`;
    }

    // Project only the fields we need
    const metricExpr = metric === "count" ? "1" : `CAST(s.attribute.${metric} AS FLOAT)`;

    return `SELECT ${dimensionExpr} AS dimension_value, ${metricExpr} AS metric_value FROM s3object s WHERE ${where}`;
  }

  private applyBreakdownFilter(
    events: EventRecord[],
    query: BreakdownQuery
  ): Array<{ dimension_value: string; metric_value: number | null }> {
    const { event_type, dimension, metric, year_from, year_to } = query;

    return events
      .filter((e) => {
        if (e.event_type !== event_type) return false;
        const attr = (e.attribute ?? {}) as Record<string, unknown>;

        // Year filtering
        const metricYear = attr.metric_year ? Number(attr.metric_year) : null;
        const contractYear = typeof attr.contract_date === "string"
          ? Number(attr.contract_date.slice(0, 4))
          : null;
        const year = metricYear ?? contractYear;

        if (year_from != null && year !== null && year < year_from) return false;
        if (year_to != null && year !== null && year > year_to) return false;

        return true;
      })
      .map((e) => {
        const attr = (e.attribute ?? {}) as Record<string, unknown>;

        // Handle derived dimensions
        let dimensionValue: string;
        if (dimension === "contract_year") {
          const contractDate = attr.contract_date;
          dimensionValue = typeof contractDate === "string" ? contractDate.slice(0, 4) : "unknown";
        } else {
          dimensionValue = String(attr[dimension] ?? "unknown");
        }

        const metricValue = metric === "count" ? 1 : Number(attr[metric]);

        return {
          dimension_value: dimensionValue,
          metric_value: isNaN(metricValue) ? null : metricValue,
        };
      });
  }

  private calculateAggregation(
    values: number[],
    count: number,
    aggregation: string,
    metric: string
  ): number {
    if (metric === "count") return count;
    if (values.length === 0) return 0;

    switch (aggregation) {
      case "sum":
        return values.reduce((a, b) => a + b, 0);
      case "avg":
        return values.reduce((a, b) => a + b, 0) / values.length;
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      case "count":
        return count;
      default:
        return values.reduce((a, b) => a + b, 0);
    }
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
      const attr = (e.attribute ?? {}) as Record<string, unknown>;
      if (query.company_name && !String(attr.company_name ?? "").toLowerCase().includes(query.company_name.toLowerCase())) return false;
      if (query.permid && String(attr.permid ?? "") !== query.permid) return false;
      if (query.metric_name && !String(attr.metric_name ?? "").toLowerCase().includes(query.metric_name.toLowerCase())) return false;
      if (query.pillar && String(attr.pillar ?? "").toLowerCase() !== query.pillar.toLowerCase()) return false;
      if (query.year_from != null && Number(attr.metric_year ?? 0) < query.year_from) return false;
      if (query.year_to != null && Number(attr.metric_year ?? 0) > query.year_to) return false;
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