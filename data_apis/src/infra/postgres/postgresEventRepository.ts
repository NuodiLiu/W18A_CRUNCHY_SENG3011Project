import { Pool } from "pg";
import { AppConfig } from "../../config/index.js";
import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader, EventQuery, EventQueryResult } from "../../domain/ports/dataLakeReader.js";
import { EventRepository } from "../../domain/ports/eventRepository.js";

export class PostgresEventRepository implements DataLakeReader, EventRepository {
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    const useSsl =
      config.pgSsl || config.pgConnectionString.includes("sslmode=");
    this.pool = new Pool({
      connectionString: config.pgConnectionString,
      max: 5,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ── EventRepository (write) ───────────────────────────────────

  // bulk insert using multi-row VALUES to avoid per-row round trips.
  // chunks into 2000-row batches to stay within pg parameter limit (65535).
  async writeEvents(events: EventRecord[], datasetId: string): Promise<void> {
    if (events.length === 0) return;
    const COLS = 5;
    const CHUNK = 2000;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < events.length; i += CHUNK) {
        const slice = events.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const valueTuples: string[] = [];
        for (let j = 0; j < slice.length; j++) {
          const base = j * COLS;
          valueTuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
          params.push(
            slice[j].event_id,
            slice[j].event_type,
            datasetId,
            JSON.stringify(slice[j].time_object),
            JSON.stringify(slice[j].attribute),
          );
        }
        await client.query(
          `INSERT INTO events (event_id, event_type, dataset_id, time_object, attribute)
           VALUES ${valueTuples.join(", ")}
           ON CONFLICT (event_id) DO NOTHING`,
          params,
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── DataLakeReader (query) ────────────────────────────────────

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const { whereClause, params } = this.buildWhere(query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;

    const [countRes, dataRes] = await Promise.all([
      this.pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM events ${whereClause}`,
        params,
      ),
      this.pool.query<EventRow>(
        `SELECT event_id, event_type, time_object, attribute
         FROM events ${whereClause}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    return {
      events: dataRes.rows.map(rowToRecord),
      total: countRes.rows[0].total,
    };
  }

  async findEventById(eventId: string): Promise<EventRecord | undefined> {
    const res = await this.pool.query<EventRow>(
      "SELECT event_id, event_type, time_object, attribute FROM events WHERE event_id = $1",
      [eventId],
    );
    return res.rows[0] ? rowToRecord(res.rows[0]) : undefined;
  }

  async getDistinctEventTypes(): Promise<string[]> {
    const res = await this.pool.query<{ event_type: string }>(
      "SELECT DISTINCT event_type FROM events ORDER BY event_type",
    );
    return res.rows.map((r) => r.event_type);
  }

  async readDataset(
    datasetId: string,
    onBatch: (events: EventRecord[]) => Promise<void>,
  ): Promise<void> {
    const PAGE_SIZE = 500;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.pool.query<EventRow>(
        "SELECT event_id, event_type, time_object, attribute FROM events WHERE dataset_id = $1 LIMIT $2 OFFSET $3",
        [datasetId, PAGE_SIZE, offset],
      );
      if (res.rows.length === 0) break;
      await onBatch(res.rows.map(rowToRecord));
      hasMore = res.rows.length >= PAGE_SIZE;
      offset += PAGE_SIZE;
    }
  }

  async getGroupProjection(
    fields: string[],
    eventType?: string,
  ): Promise<Record<string, unknown>[]> {
    if (fields.length === 0) return [];

    const selects = fields.map((f) => buildFieldSelect(f));
    const whereClause = eventType ? "WHERE event_type = $1" : "";
    const params = eventType ? [eventType] : [];

    const res = await this.pool.query(
      `SELECT ${selects.map((s, i) => `${s} AS "f${i}"`).join(", ")} FROM events ${whereClause}`,
      params,
    );

    // Re-map aliased columns back to nested objects matching EventRecord shape.
    // e.g. fields ["attribute.suburb", "time_object.timestamp"]
    // → { attribute: { suburb: "Sydney" }, time_object: { timestamp: "2024-..." } }
    return res.rows.map((row) => {
      const out: Record<string, Record<string, unknown>> = {};
      fields.forEach((f, i) => {
        const dotIdx = f.indexOf(".");
        if (dotIdx !== -1) {
          const ns = f.slice(0, dotIdx);   // e.g. "attribute"
          const key = f.slice(dotIdx + 1); // e.g. "suburb"
          if (!out[ns]) out[ns] = {};
          out[ns][key] = row[`f${i}`];
        }
      });
      return out as Record<string, unknown>;
    });
  }

  // ── Private helpers ───────────────────────────────────────────

  private buildWhere(query: EventQuery): {
    whereClause: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (query.dataset_type) {
      conditions.push(`event_type = $${idx++}`);
      params.push(query.dataset_type === "esg" ? "esg_metric" : "housing_sale");
    }
    if (query.company_name) {
      conditions.push(`attribute->>'company_name' ILIKE $${idx++}`);
      params.push(`%${query.company_name}%`);
    }
    if (query.permid) {
      conditions.push(`attribute->>'permid' = $${idx++}`);
      params.push(query.permid);
    }
    if (query.metric_name) {
      conditions.push(`attribute->>'metric_name' ILIKE $${idx++}`);
      params.push(`%${query.metric_name}%`);
    }
    if (query.pillar) {
      conditions.push(`attribute->>'pillar' = $${idx++}`);
      params.push(query.pillar);
    }
    if (query.year_from != null) {
      conditions.push(`(attribute->>'metric_year')::int >= $${idx++}`);
      params.push(query.year_from);
    }
    if (query.year_to != null) {
      conditions.push(`(attribute->>'metric_year')::int <= $${idx++}`);
      params.push(query.year_to);
    }
    if (query.postcode != null) {
      conditions.push(`(attribute->>'postcode')::int = $${idx++}`);
      params.push(query.postcode);
    }
    if (query.suburb) {
      conditions.push(`attribute->>'suburb' ILIKE $${idx++}`);
      params.push(`%${query.suburb}%`);
    }
    if (query.street_name) {
      conditions.push(`attribute->>'street_name' ILIKE $${idx++}`);
      params.push(`%${query.street_name}%`);
    }
    if (query.nature_of_property) {
      conditions.push(`attribute->>'nature_of_property' = $${idx++}`);
      params.push(query.nature_of_property);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { whereClause, params };
  }
}

// ── Module-level helpers ──────────────────────────────────────

interface EventRow {
  event_id: string;
  event_type: string;
  time_object: EventRecord["time_object"];
  attribute: Record<string, unknown>;
}

function rowToRecord(row: EventRow): EventRecord {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    time_object: row.time_object,
    attribute: row.attribute,
  };
}

/** Safely convert a domain field path to a SQL expression. */
function buildFieldSelect(field: string): string {
  // Allow only letters, digits, underscores, and dots
  if (!/^[a-z_][a-z0-9_.]*$/.test(field)) {
    throw new Error(`Invalid field name: "${field}"`);
  }
  if (field.startsWith("attribute.")) {
    const key = field.slice("attribute.".length);
    return `attribute->>'${key}'`;
  }
  if (field.startsWith("time_object.")) {
    const key = field.slice("time_object.".length);
    return `time_object->>'${key}'`;
  }
  // Top-level columns: event_id, event_type, dataset_id
  return `"${field}"`;
}
