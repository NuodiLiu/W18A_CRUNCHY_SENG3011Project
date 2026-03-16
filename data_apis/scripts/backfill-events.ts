/**
 * One-time backfill script.
 *
 * Reads all existing S3 JSONL segments (via GetObject, not S3 Select) and
 * writes every EventRecord into the new DynamoDB events table.
 *
 * Usage:
 *   npx tsx scripts/backfill-events.ts
 *
 * Set env vars as for the API (AWS_REGION, DDB_EVENTS_TABLE, S3_DATALAKE_BUCKET, etc.)
 * or rely on the defaults in config/index.ts.
 */
/* eslint-disable no-console */
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { loadConfig } from "../src/config/index.js";
import { DynamoEventRepository } from "../src/infra/aws/dynamoEventRepository.js";
import { EventRecord } from "../src/domain/models/event.js";

interface ManifestJson {
  segments: string[];
}

const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit

async function main(): Promise<void> {
  const config = loadConfig();
  const s3 = new S3Client({ region: config.region });
  const repo = new DynamoEventRepository(config);

  console.log(`[backfill] bucket  : ${config.s3DatalakeBucket}`);
  console.log(`[backfill] table   : ${config.ddbEventsTable}`);

  // 1. List all manifest keys
  const manifestKeys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.s3DatalakeBucket,
        Prefix: "datasets/",
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key?.endsWith("/manifest.json")) manifestKeys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);

  console.log(`[backfill] found ${manifestKeys.length} manifest(s)`);

  let totalWritten = 0;

  for (const manifestKey of manifestKeys) {
    const manifest = await readJson<ManifestJson>(s3, config.s3DatalakeBucket, manifestKey);
    const datasetId = manifestKey.split("/")[1] ?? manifestKey;

    for (const segUri of manifest.segments) {
      const segKey = segUri.replace(`s3://${config.s3DatalakeBucket}/`, "");
      const events = await readJsonLines<EventRecord>(s3, config.s3DatalakeBucket, segKey);

      // Write in batches
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        await repo.writeEvents(events.slice(i, i + BATCH_SIZE), datasetId);
      }

      totalWritten += events.length;
      console.log(`[backfill] ${segKey} → ${events.length} events written`);
    }
  }

  console.log(`[backfill] done. total events written: ${totalWritten}`);
}

async function readJson<T>(s3: S3Client, bucket: string, key: string): Promise<T> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToString();
  if (!body) throw new Error(`Empty body: s3://${bucket}/${key}`);
  return JSON.parse(body) as T;
}

async function readJsonLines<T>(s3: S3Client, bucket: string, key: string): Promise<T[]> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToString();
  if (!body) return [];
  return body
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
