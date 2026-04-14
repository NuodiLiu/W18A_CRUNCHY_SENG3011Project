#!/usr/bin/env bash
# Runs the optimization SQL on the production DB via a temporary Lambda.
# Local psql can't reach the VPC-hosted RDS, so we create a one-shot Lambda
# in the same VPC, invoke it, then delete it.
#
# Usage: bash scripts/apply-prod-optimizations.sh
set -euo pipefail

REGION="ap-southeast-2"
FN="eia-dev-api"
MIGRATE_FN="eia-dev-migrate-temp"

echo "Fetching config from $FN..."
CONFIG=$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --output json)
PG_CONN=$(echo "$CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['Environment']['Variables']['PG_CONNECTION_STRING'])")
ROLE_ARN=$(echo "$CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['Role'])")
VPC_CONFIG=$(echo "$CONFIG" | python3 -c "
import sys,json
c=json.load(sys.stdin).get('VpcConfig',{})
subs=','.join(c.get('SubnetIds',[]))
sgs=','.join(c.get('SecurityGroupIds',[]))
print(f'{subs}|{sgs}')
")
SUBNETS="${VPC_CONFIG%%|*}"
SGS="${VPC_CONFIG##*|}"

echo "  Role: $ROLE_ARN"
echo "  PG:   ${PG_CONN%%@*}@..."
if [ -n "$SUBNETS" ]; then
  echo "  VPC:  subnets=$SUBNETS  sgs=$SGS"
fi
echo ""

# ── Build temp Lambda zip ──────────────────────────────────────
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

cat > "$TMPDIR/index.mjs" << 'LAMBDA_CODE'
import pg from "pg";
const { Client } = pg;

export async function handler() {
  // Strip sslmode from connection string — pg v8+ treats sslmode=require as
  // verify-full which fails on RDS. We pass ssl config separately instead.
  const connStr = process.env.PG_CONNECTION_STRING
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/\?$/, "");
  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const results = [];

  const statements = [
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_purchase_price ON events (((attribute->>'purchase_price')::numeric)) WHERE event_type = 'housing_sale'`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_timestamp ON events (((time_object->>'timestamp')::timestamp))`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_suburb_price ON events ((attribute->>'suburb'), ((attribute->>'purchase_price')::numeric)) WHERE event_type = 'housing_sale'`,
    `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_suburb_stats AS SELECT attribute->>'suburb' AS suburb, COUNT(*)::bigint AS cnt, SUM((attribute->>'purchase_price')::numeric) AS sum_price, AVG((attribute->>'purchase_price')::numeric) AS avg_price, MIN((attribute->>'purchase_price')::numeric) AS min_price, MAX((attribute->>'purchase_price')::numeric) AS max_price, SUM((attribute->>'area')::numeric) AS sum_area, AVG((attribute->>'area')::numeric) AS avg_area, MIN((attribute->>'area')::numeric) AS min_area, MAX((attribute->>'area')::numeric) AS max_area FROM events WHERE event_type = 'housing_sale' GROUP BY attribute->>'suburb'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_suburb_stats_pk ON mv_housing_suburb_stats (suburb)`,
    `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_stats AS SELECT EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year, COUNT(*)::bigint AS cnt, SUM((attribute->>'purchase_price')::numeric) AS sum_price, AVG((attribute->>'purchase_price')::numeric) AS avg_price, MIN((attribute->>'purchase_price')::numeric) AS min_price, MAX((attribute->>'purchase_price')::numeric) AS max_price, SUM((attribute->>'area')::numeric) AS sum_area, AVG((attribute->>'area')::numeric) AS avg_area, MIN((attribute->>'area')::numeric) AS min_area, MAX((attribute->>'area')::numeric) AS max_area FROM events WHERE event_type = 'housing_sale' GROUP BY year`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_stats_pk ON mv_housing_yearly_stats (year)`,
    `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_housing_yearly_suburb AS SELECT EXTRACT(YEAR FROM (time_object->>'timestamp')::timestamp)::int AS year, attribute->>'suburb' AS suburb, COUNT(*)::bigint AS cnt, SUM((attribute->>'purchase_price')::numeric) AS sum_price, AVG((attribute->>'purchase_price')::numeric) AS avg_price, MIN((attribute->>'purchase_price')::numeric) AS min_price, MAX((attribute->>'purchase_price')::numeric) AS max_price, SUM((attribute->>'area')::numeric) AS sum_area, AVG((attribute->>'area')::numeric) AS avg_area, MIN((attribute->>'area')::numeric) AS min_area, MAX((attribute->>'area')::numeric) AS max_area FROM events WHERE event_type = 'housing_sale' GROUP BY year, attribute->>'suburb'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mv_housing_yearly_suburb_pk ON mv_housing_yearly_suburb (year, suburb)`,
  ];

  for (const sql of statements) {
    const label = sql.slice(0, 80) + "...";
    const start = Date.now();
    try {
      await client.query(sql);
      const sec = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ ok: true, label, seconds: sec });
      console.log(`✔ [${sec}s]`, label);
    } catch (err) {
      const sec = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ ok: false, label, error: err.message, seconds: sec });
      console.error(`✗ [${sec}s]`, label, err.message);
    }
  }

  await client.end();
  return { statusCode: 200, body: JSON.stringify(results, null, 2) };
}
LAMBDA_CODE

cd "$TMPDIR"
npm init -y > /dev/null 2>&1
npm install pg > /dev/null 2>&1
zip -qr migration.zip index.mjs node_modules/

# ── Create or update temp Lambda ───────────────────────────────
VPC_FLAG=""
if [ -n "$SUBNETS" ]; then
  VPC_FLAG="--vpc-config SubnetIds=$SUBNETS,SecurityGroupIds=$SGS"
fi

if aws lambda get-function --function-name "$MIGRATE_FN" --region "$REGION" > /dev/null 2>&1; then
  echo "Updating existing migration Lambda..."
  aws lambda update-function-code \
    --function-name "$MIGRATE_FN" \
    --zip-file "fileb://migration.zip" \
    --region "$REGION" --output text > /dev/null
  aws lambda wait function-updated --function-name "$MIGRATE_FN" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$MIGRATE_FN" \
    --timeout 900 --memory-size 512 \
    --environment "Variables={PG_CONNECTION_STRING=$PG_CONN}" \
    $VPC_FLAG \
    --region "$REGION" --output text > /dev/null
  aws lambda wait function-updated --function-name "$MIGRATE_FN" --region "$REGION"
else
  echo "Creating migration Lambda..."
  aws lambda create-function \
    --function-name "$MIGRATE_FN" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://migration.zip" \
    --timeout 900 --memory-size 512 \
    --environment "Variables={PG_CONNECTION_STRING=$PG_CONN}" \
    $VPC_FLAG \
    --region "$REGION" --output text > /dev/null
  echo "Waiting for Lambda to become active..."
  aws lambda wait function-active --function-name "$MIGRATE_FN" --region "$REGION"
fi

echo ""
echo "Invoking migration (this may take 10-20 min on 3.4M rows)..."
echo ""

OUTFILE=$(mktemp)
aws lambda invoke \
  --function-name "$MIGRATE_FN" \
  --region "$REGION" \
  --log-type Tail \
  --cli-read-timeout 900 \
  "$OUTFILE" 2>&1

echo ""
echo "=== Lambda response ==="
python3 -m json.tool "$OUTFILE" 2>/dev/null || cat "$OUTFILE"
rm -f "$OUTFILE"

echo ""
echo "Cleaning up temporary Lambda..."
aws lambda delete-function --function-name "$MIGRATE_FN" --region "$REGION" 2>/dev/null || true

echo ""
echo "✔ Done. Now merge the PR and deploy the API Lambda to use the new indexes/MVs."
