import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  GetItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AppConfig } from "../../config/index.js";
import { EventRecord } from "../../domain/models/event.js";
import { DataLakeReader, EventQuery, EventQueryResult, BreakdownQuery, BreakdownResult } from "../../domain/ports/dataLakeReader.js";
import { EventRepository } from "../../domain/ports/eventRepository.js";

// DynamoDB BatchWriteItem hard limit
const DYNAMO_BATCH_SIZE = 25;

export class DynamoEventRepository implements DataLakeReader, EventRepository {
  private readonly client: DynamoDBClient;
  private readonly table: string;

  constructor(config: AppConfig) {
    this.client = new DynamoDBClient({
      region: config.region,
      ...(config.dynamoEndpoint && { endpoint: config.dynamoEndpoint }),
    });
    this.table = config.ddbEventsTable;
  }

  // ── EventRepository (write) ───────────────────────────────────

  async writeEvents(events: EventRecord[], datasetId: string): Promise<void> {
    if (events.length === 0) return;

    // Split into batches of 25 (DynamoDB hard limit per BatchWriteItem call)
    for (let i = 0; i < events.length; i += DYNAMO_BATCH_SIZE) {
      const batch = events.slice(i, i + DYNAMO_BATCH_SIZE);
      await this.client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.table]: batch.map((event) => ({
              PutRequest: {
                Item: marshall(
                  { ...event, dataset_id: datasetId },
                  { removeUndefinedValues: true },
                ),
              },
            })),
          },
        })
      );
    }
  }

  // ── DataLakeReader (query) ────────────────────────────────────

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    const { filterExpression, expressionAttributeNames, expressionAttributeValues } =
      this.buildFilter(query);

    // Use permid GSI when available for a targeted query; fall back to Scan otherwise.
    if (query.permid) {
      return this.queryByPermid(query, filterExpression, expressionAttributeNames, expressionAttributeValues);
    }

    return this.scanWithFilter(query, filterExpression, expressionAttributeNames, expressionAttributeValues);
  }

  async findEventById(eventId: string): Promise<EventRecord | undefined> {
    const res = await this.client.send(
      new GetItemCommand({
        TableName: this.table,
        Key: marshall({ event_id: eventId }),
      })
    );
    if (!res.Item) return undefined;
    return unmarshall(res.Item) as EventRecord;
  }

  async getDistinctEventTypes(): Promise<string[]> {
    // Scan projecting only event_type, then deduplicate in memory.
    // For large tables a GSI on event_type would be preferable, but this
    // avoids an additional index requirement during initial rollout.
    const types = new Set<string>();
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: "#et",
          ExpressionAttributeNames: { "#et": "event_type" },
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        const et = (unmarshall(item) as { event_type?: string }).event_type;
        if (et) types.add(et);
      }

      lastKey = res.LastEvaluatedKey ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>) : undefined;
    } while (lastKey);

    return [...types];
  }

  async readDataset(
    datasetId: string,
    onBatch: (events: EventRecord[]) => Promise<void>,
  ): Promise<void> {
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression: "dataset_id = :dsid",
          ExpressionAttributeValues: marshall({ ":dsid": datasetId }),
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      const batch = (res.Items ?? []).map((item) => {
        const raw = unmarshall(item) as Record<string, unknown>;
        // strip the infra-only field before handing to domain
        const { dataset_id: _removed, ...event } = raw;
        return event as unknown as EventRecord;
      });

      if (batch.length > 0) await onBatch(batch);

      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);
  }

  async getGroupProjection(fields: string[]): Promise<Record<string, unknown>[]> {
    if (fields.length === 0) return [];

    // Build a ProjectionExpression handling nested paths (e.g. "attribute.pillar").
    // Each path segment needs its own ExpressionAttributeNames placeholder because
    // a single placeholder maps to one attribute name token (no dots allowed inside).
    const exprNames: Record<string, string> = {};
    const projParts: string[] = [];
    fields.forEach((f, fieldIdx) => {
      const segments = f.split(".");
      const segAliases = segments.map((seg, segIdx) => {
        const alias = `#f${fieldIdx}_${segIdx}`;
        exprNames[alias] = seg;
        return alias;
      });
      projParts.push(segAliases.join("."));
    });

    const results: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: projParts.join(", "),
          ExpressionAttributeNames: exprNames,
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        results.push(unmarshall(item));
      }

      lastKey = res.LastEvaluatedKey ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>) : undefined;
    } while (lastKey);

    return results;
  }

  async getAllEvents(): Promise<EventRecord[]> {
    const events: EventRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        events.push(unmarshall(item) as EventRecord);
      }

      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);

    return events;
  }

  async getAggregatedBreakdown(query: BreakdownQuery): Promise<BreakdownResult> {
    const { event_type, dimension, metric, aggregation, limit = 10, year_from, year_to } = query;

    // Build filter expression for event_type and year range
    const conditions: string[] = ["#et = :event_type"];
    const names: Record<string, string> = { "#et": "event_type", "#attr": "attribute" };
    const values: Record<string, unknown> = { ":event_type": event_type };

    if (year_from != null) {
      names["#my"] = "metric_year";
      conditions.push("#attr.#my >= :year_from");
      values[":year_from"] = year_from;
    }
    if (year_to != null) {
      names["#my"] = "metric_year";
      conditions.push("#attr.#my <= :year_to");
      values[":year_to"] = year_to;
    }

    const filterExpression = conditions.join(" AND ");

    // Scan with filter - DynamoDB doesn't support server-side aggregation
    const groups = new Map<string, { values: number[]; count: number }>();
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        const record = unmarshall(item) as EventRecord;
        const attr = (record.attribute ?? {}) as Record<string, unknown>;

        // Get dimension value
        let categoryValue: string;
        if (dimension === "contract_year") {
          const contractDate = attr.contract_date;
          categoryValue = typeof contractDate === "string" ? contractDate.slice(0, 4) : "unknown";
        } else {
          categoryValue = String(attr[dimension] ?? "unknown");
        }

        if (!groups.has(categoryValue)) {
          groups.set(categoryValue, { values: [], count: 0 });
        }
        const group = groups.get(categoryValue)!;
        group.count++;

        if (metric !== "count") {
          const metricValue = Number(attr[metric]);
          if (!isNaN(metricValue)) {
            group.values.push(metricValue);
          }
        }
      }

      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);

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

  // ── Private helpers ───────────────────────────────────────────

  private async queryByPermid(
    query: EventQuery,
    filterExpression: string | undefined,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, unknown>,
  ): Promise<EventQueryResult> {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const need = offset + limit;

    // GSI: permid-metric_year-index — PK: permid
    const keyCondition = "#permid = :permid";
    expressionAttributeNames["#permid"] = "attribute.permid";
    expressionAttributeValues[":permid"] = query.permid!;

    const queryParams = {
      TableName: this.table,
      IndexName: "permid-metric_year-index",
      KeyConditionExpression: keyCondition,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0
        ? expressionAttributeNames
        : undefined,
      ExpressionAttributeValues: Object.keys(expressionAttributeValues).length > 0
        ? marshall(expressionAttributeValues, { removeUndefinedValues: true })
        : undefined,
    };

    // Run a COUNT query and a data query in parallel.
    // COUNT uses Select:"COUNT" (no item data transferred) for the total;
    // data query stops as soon as offset+limit items are collected.
    const [total, pageItems] = await Promise.all([
      this.countQuery(queryParams),
      this.dataQuery(queryParams, need),
    ]);

    return { events: pageItems.slice(offset, offset + limit), total };
  }

  private async countQuery(params: {
    TableName: string;
    IndexName?: string;
    KeyConditionExpression?: string;
    FilterExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>;
  }): Promise<number> {
    let total = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          ...params,
          Select: "COUNT",
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );
      total += res.Count ?? 0;
      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);
    return total;
  }

  private async dataQuery(
    params: {
      TableName: string;
      IndexName?: string;
      KeyConditionExpression?: string;
      FilterExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>;
    },
    need: number,
  ): Promise<EventRecord[]> {
    const items: EventRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          ...params,
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );
      for (const item of res.Items ?? []) {
        items.push(unmarshall(item) as EventRecord);
        if (items.length >= need) return items;
      }
      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);
    return items;
  }

  private async scanWithFilter(
    query: EventQuery,
    filterExpression: string | undefined,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, unknown>,
  ): Promise<EventQueryResult> {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const need = offset + limit;

    const scanParams = {
      TableName: this.table,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ...(Object.keys(expressionAttributeNames).length > 0 && {
        ExpressionAttributeNames: expressionAttributeNames,
      }),
      ...(Object.keys(expressionAttributeValues).length > 0 && {
        ExpressionAttributeValues: marshall(expressionAttributeValues, {
          removeUndefinedValues: true,
        }),
      }),
    };

    // Run a COUNT scan and a data scan in parallel.
    // COUNT uses Select:"COUNT" (no item data transferred) for the total;
    // data scan stops as soon as offset+limit items are collected.
    const [total, pageItems] = await Promise.all([
      this.countScan(scanParams),
      this.dataScan(scanParams, need),
    ]);

    return { events: pageItems.slice(offset, offset + limit), total };
  }

  private async countScan(params: {
    TableName: string;
    FilterExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>;
  }): Promise<number> {
    let total = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new ScanCommand({
          ...params,
          Select: "COUNT",
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );
      total += res.Count ?? 0;
      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);
    return total;
  }

  private async dataScan(
    params: {
      TableName: string;
      FilterExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>;
    },
    need: number,
  ): Promise<EventRecord[]> {
    const items: EventRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new ScanCommand({
          ...params,
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );
      for (const item of res.Items ?? []) {
        items.push(unmarshall(item) as EventRecord);
        if (items.length >= need) return items;
      }
      lastKey = res.LastEvaluatedKey
        ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastKey);
    return items;
  }

  /**
   * Translates EventQuery into a DynamoDB FilterExpression.
   * permid is handled separately as a key condition when a GSI query is used.
   */
  private buildFilter(query: EventQuery): {
    filterExpression: string | undefined;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, unknown>;
  } {
    const conditions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (query.company_name) {
      names["#attr"] = "attribute";
      names["#cname"] = "company_name";
      conditions.push("contains(#attr.#cname, :company_name)");
      values[":company_name"] = query.company_name;
    }

    if (query.metric_name) {
      names["#attr"] = "attribute";
      names["#mname"] = "metric_name";
      conditions.push("contains(#attr.#mname, :metric_name)");
      values[":metric_name"] = query.metric_name;
    }

    if (query.pillar) {
      names["#attr"] = "attribute";
      names["#pillar"] = "pillar";
      conditions.push("#attr.#pillar = :pillar");
      values[":pillar"] = query.pillar;
    }

    if (query.year_from != null) {
      names["#attr"] = "attribute";
      names["#my"] = "metric_year";
      conditions.push("#attr.#my >= :year_from");
      values[":year_from"] = query.year_from;
    }

    if (query.year_to != null) {
      names["#attr"] = "attribute";
      names["#my"] = "metric_year";
      conditions.push("#attr.#my <= :year_to");
      values[":year_to"] = query.year_to;
    }

    return {
      filterExpression: conditions.length > 0 ? conditions.join(" AND ") : undefined,
      expressionAttributeNames: names,
      expressionAttributeValues: values,
    };
  }
}
