export interface AppConfig {
  appMode: string;
  port: number;

  // AWS
  region: string;
  dynamoEndpoint?: string;
  s3Endpoint?: string;
  sqsEndpoint?: string;

  // Resource names
  sqsQueueName: string;
  ddbJobsTable: string;
  ddbStateTable: string;
  ddbIdempotencyTable: string;
  s3ConfigBucket: string;
  s3DatalakeBucket: string;
}

export function loadConfig(): AppConfig {
  const prefix = env("PROJECT_PREFIX", "esgpipeline");
  const suffix = env("ENV_SUFFIX", "dev");

  return {
    appMode: env("APP_MODE", "api"),
    port: parseInt(env("PORT", "3000"), 10),

    region: env("AWS_REGION", "ap-southeast-2"),
    dynamoEndpoint: optionalEnv("DYNAMODB_ENDPOINT"),
    s3Endpoint: optionalEnv("S3_ENDPOINT"),
    sqsEndpoint: optionalEnv("SQS_ENDPOINT"),

    sqsQueueName: env("SQS_QUEUE_NAME", `${prefix}-${suffix}-import-jobs`),
    ddbJobsTable: env("DDB_JOBS_TABLE", `${prefix}-${suffix}-jobs`),
    ddbStateTable: env("DDB_STATE_TABLE", `${prefix}-${suffix}-connector-state`),
    ddbIdempotencyTable: env("DDB_IDEMPOTENCY_TABLE", `${prefix}-${suffix}-idempotency`),
    s3ConfigBucket: env("S3_CONFIG_BUCKET", `${prefix}-${suffix}-config`),
    s3DatalakeBucket: env("S3_DATALAKE_BUCKET", `${prefix}-${suffix}-datalake`),
  };
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${key}`);
  return v;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}
