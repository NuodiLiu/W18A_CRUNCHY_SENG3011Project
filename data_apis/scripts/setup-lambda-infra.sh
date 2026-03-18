#!/usr/bin/env bash
# =============================================================================
# setup-lambda-infra.sh
#
# One-shot script that creates every AWS resource required for the
# ESG Data Service Lambda deployment in the Sydney region (ap-southeast-2).
#
# Idempotent — safe to re-run; existing resources are detected and skipped.
#
# Usage:
#   chmod +x scripts/setup-lambda-infra.sh
#   ./scripts/setup-lambda-infra.sh
#
#   # Override defaults:
#   PROJECT_PREFIX=myapp ENV_SUFFIX=staging ./scripts/setup-lambda-infra.sh
#
# Prerequisites:
#   - AWS CLI v2   (brew install awscli)
#   - Credentials  configured (aws configure  OR  env vars AWS_ACCESS_KEY_ID etc.)
#   - Permissions  IAM, Lambda, API Gateway v2, S3, DynamoDB, SQS, CloudWatch Logs
# =============================================================================
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REGION="${AWS_REGION:-ap-southeast-2}"
PREFIX="${PROJECT_PREFIX:-eia}"
ENV="${ENV_SUFFIX:-dev}"
BASE="${PREFIX}-${ENV}"          # e.g. eia-dev

# Derived resource names — ensure ENV_SUFFIX matches the value set in the application
# environment (config/index.ts defaults to "dev"; override here to match when deploying)
JOBS_TABLE="${BASE}-jobs"
STATE_TABLE="${BASE}-connector-state"
IDEM_TABLE="${BASE}-idempotency"
EVENTS_TABLE="${BASE}-events"
CONFIG_BUCKET="${BASE}-config"
DATALAKE_BUCKET="${BASE}-datalake"
DLQ_NAME="${BASE}-import-jobs-dlq"
QUEUE_NAME="${BASE}-import-jobs"
ROLE_NAME="${BASE}-lambda-role"
API_FN_NAME="${BASE}-api"
WORKER_FN_NAME="${BASE}-worker"
APIGW_NAME="${BASE}-http-api"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo ""; echo "── $* ──────────────────────────────────────────"; }
ok()   { echo "  ✔  $*"; }
skip() { echo "  –  $* (already exists)"; }

# ── Resolve account ───────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ESG Data Service — Lambda Infrastructure Setup        ║"
echo "╚══════════════════════════════════════════════════════════╝"

ACCOUNT_ID=$(aws sts get-caller-identity \
  --query Account --output text --region "$REGION")

echo ""
echo "  Region  : $REGION"
echo "  Account : $ACCOUNT_ID"
echo "  Prefix  : $BASE"

# ── 1. CloudWatch Log Groups ──────────────────────────────────────────────────
log "CloudWatch Log Groups"
for GROUP in "/aws/lambda/${API_FN_NAME}" "/aws/lambda/${WORKER_FN_NAME}"; do
  if aws logs describe-log-groups \
       --log-group-name-prefix "$GROUP" \
       --region "$REGION" \
       --query "logGroups[?logGroupName=='${GROUP}'].logGroupName" \
       --output text | grep -q "$GROUP"; then
    skip "$GROUP"
  else
    aws logs create-log-group \
      --log-group-name "$GROUP" \
      --region "$REGION"
    ok "$GROUP"
  fi
  aws logs put-retention-policy \
    --log-group-name "$GROUP" \
    --retention-in-days 30 \
    --region "$REGION" 2>/dev/null || true
done

# ── 2. DynamoDB Tables ────────────────────────────────────────────────────────
log "DynamoDB Tables"

create_table() {
  local NAME="$1" PK="$2"
  if aws dynamodb describe-table \
       --table-name "$NAME" \
       --region "$REGION" \
       --output text > /dev/null 2>&1; then
    skip "$NAME"
  else
    aws dynamodb create-table \
      --table-name "$NAME" \
      --attribute-definitions "AttributeName=${PK},AttributeType=S" \
      --key-schema "AttributeName=${PK},KeyType=HASH" \
      --billing-mode PAY_PER_REQUEST \
      --region "$REGION" \
      --output text > /dev/null
    ok "$NAME  (PK: $PK)"
  fi
}

create_table "$JOBS_TABLE"   "job_id"
create_table "$STATE_TABLE"  "connection_id"
create_table "$IDEM_TABLE"   "idempotency_key"

# Events table (query layer replacing S3 Select)
if aws dynamodb describe-table \
     --table-name "$EVENTS_TABLE" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$EVENTS_TABLE"
else
  aws dynamodb create-table \
    --table-name "$EVENTS_TABLE" \
    --attribute-definitions \
      "AttributeName=event_id,AttributeType=S" \
    --key-schema \
      "AttributeName=event_id,KeyType=HASH" \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --output text > /dev/null
  ok "$EVENTS_TABLE  (PK: event_id)"
fi

# ── 3. S3 Buckets ─────────────────────────────────────────────────────────────
log "S3 Buckets"

create_bucket() {
  local BUCKET="$1"
  if aws s3api head-bucket \
       --bucket "$BUCKET" \
       --region "$REGION" 2>/dev/null; then
    skip "$BUCKET"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" \
      --output text > /dev/null
    # Block all public access
    aws s3api put-public-access-block \
      --bucket "$BUCKET" \
      --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
      --region "$REGION"
    # Enable versioning on both buckets
    aws s3api put-bucket-versioning \
      --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled \
      --region "$REGION"
    ok "$BUCKET"
  fi
}

create_bucket "$CONFIG_BUCKET"
create_bucket "$DATALAKE_BUCKET"

# ── 4. SQS — Dead-Letter Queue + Main Queue ───────────────────────────────────
log "SQS Queues"

# DLQ
if aws sqs get-queue-url \
     --queue-name "$DLQ_NAME" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$DLQ_NAME"
  DLQ_URL=$(aws sqs get-queue-url \
    --queue-name "$DLQ_NAME" \
    --region "$REGION" \
    --query QueueUrl --output text)
else
  DLQ_URL=$(aws sqs create-queue \
    --queue-name "$DLQ_NAME" \
    --attributes MessageRetentionPeriod=1209600 \
    --region "$REGION" \
    --query QueueUrl --output text)
  ok "$DLQ_NAME  →  $DLQ_URL"
fi

DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query "Attributes.QueueArn" --output text)

# Main queue  (VisibilityTimeout must cover Lambda max timeout of 900 s)
if aws sqs get-queue-url \
     --queue-name "$QUEUE_NAME" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$QUEUE_NAME"
  QUEUE_URL=$(aws sqs get-queue-url \
    --queue-name "$QUEUE_NAME" \
    --region "$REGION" \
    --query QueueUrl --output text)
  # Ensure visibility timeout is >= Lambda timeout even if queue already existed
  aws sqs set-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attributes VisibilityTimeout=900 \
    --region "$REGION"
  ok "$QUEUE_NAME  visibility timeout ensured = 900 s"
else
  REDRIVE="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"
  QUEUE_URL=$(aws sqs create-queue \
    --queue-name "$QUEUE_NAME" \
    --attributes \
      VisibilityTimeout=900 \
      MessageRetentionPeriod=86400 \
      "RedrivePolicy=${REDRIVE}" \
    --region "$REGION" \
    --query QueueUrl --output text)
  ok "$QUEUE_NAME  →  $QUEUE_URL"
fi

QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query "Attributes.QueueArn" --output text)

# ── 5. IAM Execution Role ─────────────────────────────────────────────────────
log "IAM Role"

TRUST_DOC='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}'

if ROLE_ARN=$(aws iam get-role \
                --role-name "$ROLE_NAME" \
                --query "Role.Arn" --output text 2>/dev/null); then
  skip "$ROLE_NAME"
else
  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_DOC" \
    --description "Lambda execution role for ${BASE}" \
    --query "Role.Arn" --output text)
  ok "$ROLE_NAME  →  $ROLE_ARN"
fi

# Attach the AWS-managed basic execution policy (CloudWatch Logs write)
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
  2>/dev/null || true

# Inline policy: least-privilege access to DynamoDB, S3, SQS
INLINE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${JOBS_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${STATE_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${IDEM_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${EVENTS_TABLE}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${EVENTS_TABLE}/index/*"
      ]
    },
    {
      "Sid": "S3Objects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:PutObject", "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::${CONFIG_BUCKET}/*",
        "arn:aws:s3:::${DATALAKE_BUCKET}/*"
      ]
    },
    {
      "Sid": "S3Buckets",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::${CONFIG_BUCKET}",
        "arn:aws:s3:::${DATALAKE_BUCKET}"
      ]
    },
    {
      "Sid": "SQS",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": "${QUEUE_ARN}"
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "${BASE}-permissions" \
  --policy-document "$INLINE_POLICY"
ok "Inline permissions policy attached"

# IAM changes take ~10 s to propagate before Lambda can assume the role
echo "  ⏳ Waiting 15 s for IAM propagation..."
sleep 15

# ── 6. Lambda Functions ───────────────────────────────────────────────────────
log "Lambda Functions"

# Build a minimal placeholder ZIP for the initial function creation.
# CI/CD will overwrite with the real bundle on the first deployment run.
TMPZIP=$(mktemp -d)
echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder — deploy via CI/CD" });' \
  > "${TMPZIP}/index.js"
(cd "$TMPZIP" && zip -q handler.zip index.js)

# API function
if aws lambda get-function \
     --function-name "$API_FN_NAME" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$API_FN_NAME"
else
  aws lambda create-function \
    --function-name "$API_FN_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://${TMPZIP}/handler.zip" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={APP_MODE=api,PORT=3000,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},DDB_EVENTS_TABLE=${EVENTS_TABLE}}" \
    --description "ESG Data Service — HTTP API (Lambda)" \
    --region "$REGION" \
    --output text > /dev/null
  ok "$API_FN_NAME  (512 MB, 30 s timeout)"
fi

# Worker function
if aws lambda get-function \
     --function-name "$WORKER_FN_NAME" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$WORKER_FN_NAME"
else
  aws lambda create-function \
    --function-name "$WORKER_FN_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://${TMPZIP}/handler.zip" \
    --timeout 900 \
    --memory-size 1024 \
    --environment "Variables={APP_MODE=worker,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},DDB_EVENTS_TABLE=${EVENTS_TABLE}}" \
    --description "ESG Data Service — SQS Worker (Lambda)" \
    --region "$REGION" \
    --output text > /dev/null
  ok "$WORKER_FN_NAME  (1024 MB, 900 s timeout)"
fi

rm -rf "$TMPZIP"

# ── 6b. Ensure env vars are up-to-date on existing functions ─────────────────
# update-function-configuration is idempotent and safe to re-run.
log "Lambda Environment Variables (ensure DDB_EVENTS_TABLE is set)"

aws lambda update-function-configuration \
  --function-name "$API_FN_NAME" \
  --environment "Variables={APP_MODE=api,PORT=3000,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},DDB_EVENTS_TABLE=${EVENTS_TABLE}}" \
  --region "$REGION" \
  --output text > /dev/null
ok "$API_FN_NAME  env vars updated"

aws lambda update-function-configuration \
  --function-name "$WORKER_FN_NAME" \
  --environment "Variables={APP_MODE=worker,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},DDB_EVENTS_TABLE=${EVENTS_TABLE}}" \
  --region "$REGION" \
  --output text > /dev/null
ok "$WORKER_FN_NAME  env vars updated"

# Wait for both functions to reach Active state before continuing
echo "  ⏳ Waiting for Lambda functions to become Active..."
aws lambda wait function-active \
  --function-name "$API_FN_NAME" \
  --region "$REGION"
aws lambda wait function-active \
  --function-name "$WORKER_FN_NAME" \
  --region "$REGION"

API_LAMBDA_ARN=$(aws lambda get-function-configuration \
  --function-name "$API_FN_NAME" \
  --region "$REGION" \
  --query FunctionArn --output text)

WORKER_LAMBDA_ARN=$(aws lambda get-function-configuration \
  --function-name "$WORKER_FN_NAME" \
  --region "$REGION" \
  --query FunctionArn --output text)

# ── 7. API Gateway v2 (HTTP API) ──────────────────────────────────────────────
log "API Gateway HTTP API"

EXISTING_API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='${APIGW_NAME}'].ApiId | [0]" \
  --output text)

if [ "$EXISTING_API_ID" != "None" ] && [ -n "$EXISTING_API_ID" ]; then
  skip "$APIGW_NAME  ($EXISTING_API_ID)"
  API_URL="https://${EXISTING_API_ID}.execute-api.${REGION}.amazonaws.com"
else
  # Create the API
  API_ID=$(aws apigatewayv2 create-api \
    --name "$APIGW_NAME" \
    --protocol-type HTTP \
    --description "ESG Data Service HTTP API" \
    --region "$REGION" \
    --query ApiId --output text)

  # Lambda proxy integration (payload format v2.0)
  INTEGRATION_ID=$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${API_LAMBDA_ARN}/invocations" \
    --payload-format-version "2.0" \
    --region "$REGION" \
    --query IntegrationId --output text)

  # Catch-all route
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key '$default' \
    --target "integrations/${INTEGRATION_ID}" \
    --region "$REGION" \
    --output text > /dev/null

  # Auto-deployed default stage
  aws apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy \
    --region "$REGION" \
    --output text > /dev/null

  # Grant API Gateway permission to invoke the Lambda
  aws lambda add-permission \
    --function-name "$API_FN_NAME" \
    --statement-id "apigw-invoke-${API_ID}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
    --region "$REGION" \
    --output text > /dev/null

  API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"
  ok "$APIGW_NAME  →  $API_URL"
fi

# ── 8. SQS → Worker Lambda Event Source Mapping ───────────────────────────────
log "SQS Event Source Mapping"

EXISTING_ESM=$(aws lambda list-event-source-mappings \
  --function-name "$WORKER_LAMBDA_ARN" \
  --event-source-arn "$QUEUE_ARN" \
  --region "$REGION" \
  --query "EventSourceMappings[0].UUID" --output text 2>/dev/null)

if [ "$EXISTING_ESM" != "None" ] && [ -n "$EXISTING_ESM" ]; then
  skip "SQS → $WORKER_FN_NAME  ($EXISTING_ESM)"
else
  aws lambda create-event-source-mapping \
    --function-name "$WORKER_LAMBDA_ARN" \
    --event-source-arn "$QUEUE_ARN" \
    --batch-size 10 \
    --maximum-batching-window-in-seconds 5 \
    --function-response-types ReportBatchItemFailures \
    --region "$REGION" \
    --output text > /dev/null
  ok "SQS → $WORKER_FN_NAME  (batch 10, partial-batch failure reporting ON)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║   ✅  Infrastructure ready                                          ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  %-20s %s\n" "API URL:"          "  ${API_URL}"
printf "║  %-20s %s\n" "API Lambda:"       "  ${API_FN_NAME}"
printf "║  %-20s %s\n" "Worker Lambda:"    "  ${WORKER_FN_NAME}"
printf "║  %-20s %s\n" "SQS Queue:"        "  ${QUEUE_NAME}"
printf "║  %-20s %s\n" "IAM Role:"         "  ${ROLE_NAME}"
printf "║  %-20s %s\n" "DynamoDB tables:"  "  ${JOBS_TABLE}, ${STATE_TABLE},"
printf "║  %-20s %s\n" ""                  "  ${IDEM_TABLE}, ${EVENTS_TABLE}"
printf "║  %-20s %s\n" "S3 buckets:"       "  ${CONFIG_BUCKET}, ${DATALAKE_BUCKET}"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Next: push to main branch to trigger lambda-deploy.yml CI/CD      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
