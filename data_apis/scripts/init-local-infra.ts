/**
 * Initialises local AWS resources for development & integration tests.
 * Targets: PostgreSQL (port 5432) + LocalStack (port 4566, S3 + SQS).
 * DynamoDB Local is still used for jobs/state/idempotency tables.
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
import { Client as PgClient } from "pg";

const REGION = process.env.AWS_REGION ?? "ap-southeast-2";
const DDB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:4566";
const SQS_ENDPOINT = process.env.SQS_ENDPOINT ?? "http://localhost:4566";
const PG_CONNECTION_STRING =
  process.env.PG_CONNECTION_STRING ?? "postgres://postgres:postgres@localhost:5432/eia_dev";

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

async function initPostgres() {
  const pg = new PgClient({ connectionString: PG_CONNECTION_STRING });
  await pg.connect();
  try {
    await pg.query(`
      CREATE TABLE IF NOT EXISTS events (
        event_id    TEXT PRIMARY KEY,
        event_type  TEXT NOT NULL,
        dataset_id  TEXT NOT NULL,
        time_object JSONB NOT NULL,
        attribute   JSONB NOT NULL
      )
    `);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_event_type ON events (event_type)`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_dataset_id  ON events (dataset_id)`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_permid       ON events ((attribute->>'permid'))`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_suburb       ON events ((attribute->>'suburb'))`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_postcode     ON events (((attribute->>'postcode')::int))`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_metric_year  ON events (((attribute->>'metric_year')::int))`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_pillar       ON events ((attribute->>'pillar'))`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_company_name ON events ((attribute->>'company_name'))`);

    // ── Expression indexes for visualisation aggregation queries ──
    // These cover the expensive JSONB extraction + numeric cast that caused 30s+ timeouts.
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_purchase_price ON events (((attribute->>'purchase_price')::numeric)) WHERE event_type = 'housing_sale'`);
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_events_suburb_price   ON events ((attribute->>'suburb'), ((attribute->>'purchase_price')::numeric)) WHERE event_type = 'housing_sale'`);

    // ── Materialized views for pre-computed aggregations ──────────
    // Created once; refreshed after each batch import via REFRESH MATERIALIZED VIEW CONCURRENTLY.
    await pg.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_suburb_stats AS
      SELECT
        attribute->>'suburb' AS suburb,
        COUNT(*)::bigint AS cnt,
        SUM((attribute->>'purchase_price')::numeric) AS sum_price,
        AVG((attribute->>'purchase_price')::numeric) AS avg_price,
        MIN((attribute->>'purchase_price')::numeric) AS min_price,
        MAX((attribute->>'purchase_price')::numeric) AS max_price,
        SUM((attribute->>'area')::numeric) AS sum_area,
        AVG((attribute->>'area')::numeric) AS avg_area,
        MIN((attribute->>'area')::numeric) AS min_area,
        MAX((attribute->>'area')::numeric) AS max_area
      FROM events
      WHERE event_type = 'housing_sale'
      GROUP BY attribute->>'suburb'
    `);
    await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_suburb_stats_pk ON mv_housing_suburb_stats (suburb)`);

    await pg.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_stats AS
      SELECT
        EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year,
        COUNT(*)::bigint AS cnt,
        SUM((attribute->>'purchase_price')::numeric) AS sum_price,
        AVG((attribute->>'purchase_price')::numeric) AS avg_price,
        MIN((attribute->>'purchase_price')::numeric) AS min_price,
        MAX((attribute->>'purchase_price')::numeric) AS max_price,
        SUM((attribute->>'area')::numeric) AS sum_area,
        AVG((attribute->>'area')::numeric) AS avg_area,
        MIN((attribute->>'area')::numeric) AS min_area,
        MAX((attribute->>'area')::numeric) AS max_area
      FROM events
      WHERE event_type = 'housing_sale'
      GROUP BY year
    `);
    await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_stats_pk ON mv_housing_yearly_stats (year)`);

    await pg.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_suburb AS
      SELECT
        EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year,
        attribute->>'suburb' AS suburb,
        COUNT(*)::bigint AS cnt,
        SUM((attribute->>'purchase_price')::numeric) AS sum_price,
        AVG((attribute->>'purchase_price')::numeric) AS avg_price,
        MIN((attribute->>'purchase_price')::numeric) AS min_price,
        MAX((attribute->>'purchase_price')::numeric) AS max_price,
        SUM((attribute->>'area')::numeric) AS sum_area,
        AVG((attribute->>'area')::numeric) AS avg_area,
        MIN((attribute->>'area')::numeric) AS min_area,
        MAX((attribute->>'area')::numeric) AS max_area
      FROM events
      WHERE event_type = 'housing_sale'
      GROUP BY year, attribute->>'suburb'
    `);
    await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_suburb_pk ON mv_housing_yearly_suburb (year, suburb)`);

    await pg.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_achiever_course_stats AS
      SELECT attribute->>'course' AS course, COUNT(*)::int AS cnt
      FROM events WHERE event_type = 'distinguished_achiever'
      GROUP BY attribute->>'course'
    `);
    await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_achiever_course ON mv_achiever_course_stats (course)`);

    await pg.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_achiever_year_stats AS
      SELECT left(time_object->>'timestamp', 4) AS year, COUNT(*)::int AS cnt
      FROM events WHERE event_type = 'distinguished_achiever'
      GROUP BY left(time_object->>'timestamp', 4)
    `);
    await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_achiever_year ON mv_achiever_year_stats (year)`);

    console.log(`  ✔ PostgreSQL events table, indexes, and materialized views ready`);
  } finally {
    await pg.end();
  }
}

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
  console.log("\n🚀 Initialising local infrastructure…\n");

  console.log("[PostgreSQL]");
  await initPostgres();

  console.log("\n[DynamoDB]");
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
