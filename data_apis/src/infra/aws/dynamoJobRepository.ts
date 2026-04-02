import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { JobRecord, JobStatus } from "../../domain/models/job.js";
import { JobRepository } from "../../domain/ports/jobRepository.js";
import { AppConfig } from "../../config/index.js";

export class DynamoJobRepository implements JobRepository {
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
    this.table = config.ddbJobsTable;
  }

  async create(job: JobRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: job,
        ConditionExpression: "attribute_not_exists(job_id)",
      })
    );
  }

  async findById(jobId: string): Promise<JobRecord | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { job_id: jobId },
      })
    );
    if (!res.Item) return undefined;
    return res.Item as JobRecord;
  }

  // claims a job if it is PENDING, or if it is RUNNING but the lease has expired
  // (covers the case where a previous Lambda timed out mid-run).
  async claimJob(jobId: string, leaseUntil: string): Promise<boolean> {
    const now = new Date().toISOString();
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { job_id: jobId },
          UpdateExpression:
            "SET #status = :running, lease_until = :lease, updated_at = :now",
          ConditionExpression:
            "#status = :pending OR (#status = :running AND lease_until < :now)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":running": "RUNNING" satisfies JobStatus,
            ":pending": "PENDING" satisfies JobStatus,
            ":lease": leaseUntil,
            ":now": now,
          },
        })
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async updateStatus(
    jobId: string,
    status: JobStatus,
    extra?: Partial<Pick<JobRecord, "dataset_id" | "error" | "quality_report">>
  ): Promise<void> {
    const names: Record<string, string> = { "#status": "status" };
    const values: Record<string, unknown> = {
      ":status": status,
      ":now": new Date().toISOString(),
    };

    let updateExpr = "SET #status = :status, updated_at = :now";

    if (extra?.dataset_id !== undefined) {
      updateExpr += ", dataset_id = :did";
      values[":did"] = extra.dataset_id;
    }
    if (extra?.error !== undefined) {
      updateExpr += ", #error = :err";
      names["#error"] = "error";
      values[":err"] = extra.error;
    }
    if (extra?.quality_report !== undefined) {
      updateExpr += ", quality_report = :qr";
      values[":qr"] = extra.quality_report;
    }

    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { job_id: jobId },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }
}
