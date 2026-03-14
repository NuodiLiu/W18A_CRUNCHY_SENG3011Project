/**
 * Initialises local AWS resources for development & integration tests.
 * Targets: DynamoDB Local (port 8000) + LocalStack (port 4566, S3 + SQS).
 *
 * Usage:  npx tsx scripts/init-local-infra.ts
 */

import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

const REGION = process.env.AWS_REGION ?? "ap-southeast-2";
const DDB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:4566";
const SQS_ENDPOINT = process.env.SQS_ENDPOINT ?? "http://localhost:4566";

const PREFIX = process.env.PROJECT_PREFIX ?? "eia";

const ddb = new DynamoDBClient({
  region: REGION,
  endpoint: DDB_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const s3 = new S3Client({
  region: REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const sqs = new SQSClient({
  region: REGION,
  endpoint: SQS_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

async function createTable(tableName: string, pk: string) {
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: [{ AttributeName: pk, KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: pk, AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    console.log(`  ✔ DynamoDB table created: ${tableName}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  – DynamoDB table already exists: ${tableName}`);
    } else {
      throw err;
    }
  }
}

async function createBucket(bucket: string) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`  ✔ S3 bucket created: ${bucket}`);
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
      console.log(`  – S3 bucket already exists: ${bucket}`);
    } else {
      throw err;
    }
  }
}

async function createQueue(queueName: string) {
  try {
    const res = await sqs.send(
      new CreateQueueCommand({ QueueName: queueName })
    );
    console.log(`  ✔ SQS queue created: ${queueName} → ${res.QueueUrl}`);
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "QueueAlreadyExists") {
      console.log(`  – SQS queue already exists: ${queueName}`);
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log("\n🚀 Initialising local AWS resources…\n");

  console.log("[DynamoDB]");
  await createTable(`${PREFIX}-dev-jobs`, "job_id");
  await createTable(`${PREFIX}-dev-connector-state`, "connection_id");
  await createTable(`${PREFIX}-dev-idempotency`, "idempotency_key");

  console.log("\n[S3]");
  await createBucket(`${PREFIX}-dev-config`);
  await createBucket(`${PREFIX}-dev-datalake`);

  console.log("\n[SQS]");
  await createQueue(`${PREFIX}-dev-import-jobs`);

  console.log("\n✅ Local infra ready.\n");
}

main().catch((err) => {
  console.error("❌ Init failed:", err);
  process.exit(1);
});
