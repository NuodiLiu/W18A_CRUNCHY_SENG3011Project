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
import { DataLakeReader, EventQuery, EventQueryResult } from "../../domain/ports/dataLakeReader.js";
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

    // Build a ProjectionExpression from the requested fields.
    const exprNames: Record<string, string> = {};
    const projParts: string[] = [];
    fields.forEach((f, idx) => {
      const alias = `#f${idx}`;
      exprNames[alias] = f;
      projParts.push(alias);
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

  // ── Private helpers ───────────────────────────────────────────

  private async queryByPermid(
    query: EventQuery,
    filterExpression: string | undefined,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, unknown>,
  ): Promise<EventQueryResult> {
    const allItems: EventRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;

    // GSI: permid-metric_year-index — PK: permid
    const keyCondition = "#permid = :permid";
    expressionAttributeNames["#permid"] = "attribute.permid";
    expressionAttributeValues[":permid"] = query.permid!;

    do {
      const res = await this.client.send(
        new QueryCommand({
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
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        allItems.push(unmarshall(item) as EventRecord);
      }

      lastKey = res.LastEvaluatedKey ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>) : undefined;
    } while (lastKey);

    const total = allItems.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return { events: allItems.slice(offset, offset + limit), total };
  }

  private async scanWithFilter(
    query: EventQuery,
    filterExpression: string | undefined,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, unknown>,
  ): Promise<EventQueryResult> {
    const allItems: EventRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new ScanCommand({
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
          ...(lastKey && { ExclusiveStartKey: marshall(lastKey) }),
        })
      );

      for (const item of res.Items ?? []) {
        allItems.push(unmarshall(item) as EventRecord);
      }

      lastKey = res.LastEvaluatedKey ? (unmarshall(res.LastEvaluatedKey) as Record<string, unknown>) : undefined;
    } while (lastKey);

    const total = allItems.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return { events: allItems.slice(offset, offset + limit), total };
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
