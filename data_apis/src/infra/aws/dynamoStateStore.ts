import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { StateStore } from "../../domain/ports/stateStore.js";
import { AppConfig } from "../../config/index.js";

export class DynamoStateStore implements StateStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(config: AppConfig) {
    const client = new DynamoDBClient({
      region: config.region,
      ...(config.dynamoEndpoint && { endpoint: config.dynamoEndpoint }),
    });
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.table = config.ddbStateTable;
  }

  async getState(connectionId: string): Promise<ConnectorState | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { connection_id: connectionId },
      })
    );
    if (!res.Item) return undefined;
    return res.Item as ConnectorState;
  }

  async saveState(state: ConnectorState): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: state,
      })
    );
  }
}
