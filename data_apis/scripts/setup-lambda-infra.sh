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
FRONTEND_BUCKET="${BASE}-frontend"
JOBS_TABLE="${BASE}-jobs"
STATE_TABLE="${BASE}-connector-state"
IDEM_TABLE="${BASE}-idempotency"
CONFIG_BUCKET="${BASE}-config"
DATALAKE_BUCKET="${BASE}-datalake"
DLQ_NAME="${BASE}-import-jobs-dlq"
QUEUE_NAME="${BASE}-import-jobs"
ROLE_NAME="${BASE}-lambda-role"
API_FN_NAME="${BASE}-api"
WORKER_FN_NAME="${BASE}-worker"
APIGW_NAME="${BASE}-http-api"
RDS_INSTANCE_ID="${BASE}-events-db"
RDS_DB_NAME="events"
RDS_DB_USER="postgres"

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

# ── 3. RDS PostgreSQL (events store) ──────────────────────────────────────────
log "RDS PostgreSQL (events store)"

# Retrieve default VPC
DEFAULT_VPC=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --region "$REGION" \
  --query "Vpcs[0].VpcId" --output text)

# Collect all subnets in the default VPC
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${DEFAULT_VPC}" \
  --region "$REGION" \
  --query "Subnets[].SubnetId" --output text | tr '\t' ' ')
SUBNET_LIST=$(echo "$SUBNET_IDS" | tr ' ' '\n' | head -2 | tr '\n' ' ')

# DB subnet group
DB_SUBNET_GROUP="${BASE}-db-subnet"
if aws rds describe-db-subnet-groups \
     --db-subnet-group-name "$DB_SUBNET_GROUP" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$DB_SUBNET_GROUP"
else
  # shellcheck disable=SC2086
  aws rds create-db-subnet-group \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --db-subnet-group-description "Subnet group for ${BASE} events DB" \
    --subnet-ids $SUBNET_LIST \
    --region "$REGION" \
    --output text > /dev/null
  ok "$DB_SUBNET_GROUP"
fi

# Security group allowing port 5432 (test environment — restrict in production)
SG_NAME="${BASE}-rds-sg"
EXISTING_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${DEFAULT_VPC}" \
  --region "$REGION" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")

if [ "$EXISTING_SG" != "None" ] && [ -n "$EXISTING_SG" ]; then
  skip "$SG_NAME ($EXISTING_SG)"
  RDS_SG_ID="$EXISTING_SG"
else
  RDS_SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "RDS PostgreSQL for ${BASE} (test only)" \
    --vpc-id "$DEFAULT_VPC" \
    --region "$REGION" \
    --query GroupId --output text)
  aws ec2 authorize-security-group-ingress \
    --group-id "$RDS_SG_ID" \
    --protocol tcp \
    --port 5432 \
    --cidr 0.0.0.0/0 \
    --region "$REGION" > /dev/null
  ok "$SG_NAME ($RDS_SG_ID)  — port 5432 open (TEST ONLY)"
fi

# Generate or retrieve RDS password from SSM Parameter Store
RDS_PARAM_NAME="/${BASE}/rds/password"
if aws ssm get-parameter --name "$RDS_PARAM_NAME" --region "$REGION" --output text > /dev/null 2>&1; then
  RDS_PASSWORD=$(aws ssm get-parameter \
    --name "$RDS_PARAM_NAME" \
    --with-decryption \
    --region "$REGION" \
    --query "Parameter.Value" --output text)
  skip "SSM parameter $RDS_PARAM_NAME"
else
  RDS_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)
  aws ssm put-parameter \
    --name "$RDS_PARAM_NAME" \
    --value "$RDS_PASSWORD" \
    --type SecureString \
    --region "$REGION" \
    --output text > /dev/null
  ok "SSM SecureString $RDS_PARAM_NAME stored"
fi

# Create RDS instance
if aws rds describe-db-instances \
     --db-instance-identifier "$RDS_INSTANCE_ID" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  skip "$RDS_INSTANCE_ID"
else
  aws rds create-db-instance \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version "16" \
    --master-username "$RDS_DB_USER" \
    --master-user-password "$RDS_PASSWORD" \
    --db-name "$RDS_DB_NAME" \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --publicly-accessible \
    --allocated-storage 20 \
    --storage-type gp2 \
    --no-multi-az \
    --no-deletion-protection \
    --region "$REGION" \
    --output text > /dev/null
  ok "$RDS_INSTANCE_ID  — db.t3.micro PostgreSQL 16, 20GB (waiting for available...)"
  aws rds wait db-instance-available \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --region "$REGION"
  ok "$RDS_INSTANCE_ID  available"
fi

# Get RDS endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier "$RDS_INSTANCE_ID" \
  --region "$REGION" \
  --query "DBInstances[0].Endpoint.Address" --output text)
PG_CONNECTION_STRING="postgres://${RDS_DB_USER}:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/${RDS_DB_NAME}"
ok "RDS endpoint: $RDS_ENDPOINT"

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
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${IDEM_TABLE}"
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
    --environment "Variables={APP_MODE=api,PORT=3000,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},PG_CONNECTION_STRING=${PG_CONNECTION_STRING}}" \
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
    --environment "Variables={APP_MODE=worker,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},PG_CONNECTION_STRING=${PG_CONNECTION_STRING}}" \
    --description "ESG Data Service — SQS Worker (Lambda)" \
    --region "$REGION" \
    --output text > /dev/null
  ok "$WORKER_FN_NAME  (1024 MB, 900 s timeout)"
fi

rm -rf "$TMPZIP"

# ── 6b. Ensure env vars are up-to-date on existing functions ─────────────────
# update-function-configuration is idempotent and safe to re-run.
log "Lambda Environment Variables (ensure PG_CONNECTION_STRING is set)"

aws lambda update-function-configuration \
  --function-name "$API_FN_NAME" \
  --environment "Variables={APP_MODE=api,PORT=3000,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},PG_CONNECTION_STRING=${PG_CONNECTION_STRING},SERVICE_NAME=datalake-ingest-api,LOG_LEVEL=info}" \
  --region "$REGION" \
  --output text > /dev/null
ok "$API_FN_NAME  env vars updated"

aws lambda update-function-configuration \
  --function-name "$WORKER_FN_NAME" \
  --environment "Variables={APP_MODE=worker,PROJECT_PREFIX=${PREFIX},ENV_SUFFIX=${ENV},PG_CONNECTION_STRING=${PG_CONNECTION_STRING},SERVICE_NAME=datalake-ingest-worker,LOG_LEVEL=info}" \
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

# Rate limiting: 100 req/s steady, burst up to 200
# CORS: open to all origins, GET + OPTIONS only, no auth
APIGW_CORS='{
  "AllowOrigins": ["*"],
  "AllowMethods": ["GET", "OPTIONS"],
  "AllowHeaders": ["Content-Type", "X-Requested-With"],
  "ExposeHeaders": ["X-Request-Id"],
  "MaxAge": 86400
}'
APIGW_THROTTLE='{"ThrottlingBurstLimit":200,"ThrottlingRateLimit":100}'

EXISTING_API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='${APIGW_NAME}'].ApiId | [0]" \
  --output text)

if [ "$EXISTING_API_ID" != "None" ] && [ -n "$EXISTING_API_ID" ]; then
  skip "$APIGW_NAME  ($EXISTING_API_ID)"
  API_ID="$EXISTING_API_ID"
  API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

  # Ensure CORS and throttle are applied even on existing API
  aws apigatewayv2 update-api \
    --api-id "$API_ID" \
    --cors-configuration "$APIGW_CORS" \
    --region "$REGION" \
    --output text > /dev/null
  ok "$APIGW_NAME  CORS updated"

  aws apigatewayv2 update-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --default-route-settings "$APIGW_THROTTLE" \
    --region "$REGION" \
    --output text > /dev/null
  ok "$APIGW_NAME  throttle updated (100 req/s, burst 200)"
else
  # Create the API with CORS configured (no auth)
  API_ID=$(aws apigatewayv2 create-api \
    --name "$APIGW_NAME" \
    --protocol-type HTTP \
    --description "ESG Data Service HTTP API — public read-only, no auth" \
    --cors-configuration "$APIGW_CORS" \
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

  # Catch-all route — no authorizer
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key '$default' \
    --target "integrations/${INTEGRATION_ID}" \
    --region "$REGION" \
    --output text > /dev/null

  # Auto-deployed default stage with rate limiting
  aws apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy \
    --default-route-settings "$APIGW_THROTTLE" \
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
  ok "CORS: AllowOrigins=* AllowMethods=GET,OPTIONS  MaxAge=86400"
  ok "Rate limit: 100 req/s steady, burst 200"
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

# ── 9. S3 Frontend Bucket ─────────────────────────────────────────────────────
log "S3 Frontend Bucket (static site)"

if aws s3api head-bucket \
     --bucket "$FRONTEND_BUCKET" \
     --region "$REGION" 2>/dev/null; then
  skip "$FRONTEND_BUCKET"
else
  aws s3api create-bucket \
    --bucket "$FRONTEND_BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" \
    --output text > /dev/null

  # Block all public access — CloudFront OAC will serve the content
  aws s3api put-public-access-block \
    --bucket "$FRONTEND_BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
    --region "$REGION"
  ok "$FRONTEND_BUCKET  (public access blocked, served via CloudFront)"
fi

# ── 10. CloudFront Distribution ───────────────────────────────────────────────
log "CloudFront Distribution (frontend)"

EXISTING_CF_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[0].DomainName=='${FRONTEND_BUCKET}.s3.${REGION}.amazonaws.com'].Id | [0]" \
  --output text 2>/dev/null)

if [ "$EXISTING_CF_ID" != "None" ] && [ -n "$EXISTING_CF_ID" ]; then
  skip "CloudFront distribution  ($EXISTING_CF_ID)"
  CF_DOMAIN=$(aws cloudfront get-distribution \
    --id "$EXISTING_CF_ID" \
    --query "Distribution.DomainName" --output text)
else
  # Create Origin Access Control for S3
  OAC_CONFIG=$(cat <<OACEOF
{
  "Name": "${BASE}-frontend-oac",
  "Description": "OAC for ${BASE} frontend S3 bucket",
  "SigningProtocol": "sigv4",
  "SigningBehavior": "always",
  "OriginAccessControlOriginType": "s3"
}
OACEOF
)
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "$OAC_CONFIG" \
    --query "OriginAccessControl.Id" --output text)
  ok "Origin Access Control  →  $OAC_ID"

  # Create CloudFront distribution
  CF_CONFIG=$(cat <<CFEOF
{
  "CallerReference": "${BASE}-frontend-$(date +%s)",
  "Comment": "${BASE} frontend static site",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "s3-frontend",
      "DomainName": "${FRONTEND_BUCKET}.s3.${REGION}.amazonaws.com",
      "S3OriginConfig": { "OriginAccessIdentity": "" },
      "OriginAccessControlId": "${OAC_ID}"
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-frontend",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true,
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    }
  },
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [{
      "ErrorCode": 403,
      "ResponsePagePath": "/index.html",
      "ResponseCode": "200",
      "ErrorCachingMinTTL": 10
    }]
  },
  "Enabled": true,
  "HttpVersion": "http2",
  "PriceClass": "PriceClass_All"
}
CFEOF
)

  CF_RESULT=$(aws cloudfront create-distribution \
    --distribution-config "$CF_CONFIG" \
    --query "{Id:Distribution.Id,Domain:Distribution.DomainName}" \
    --output json)
  EXISTING_CF_ID=$(echo "$CF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Id'])")
  CF_DOMAIN=$(echo "$CF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Domain'])")

  # Grant CloudFront OAC permission to read from the S3 bucket
  BUCKET_POLICY=$(cat <<BPEOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontOAC",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${FRONTEND_BUCKET}/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${EXISTING_CF_ID}"
      }
    }
  }]
}
BPEOF
)
  aws s3api put-bucket-policy \
    --bucket "$FRONTEND_BUCKET" \
    --policy "$BUCKET_POLICY" \
    --region "$REGION"

  ok "CloudFront distribution  →  https://${CF_DOMAIN}"
  ok "S3 bucket policy updated for OAC access"
  echo "  ⏳ Distribution deploying (~5-10 min to become fully active)"
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
printf "║  %-20s %s\n" ""                  "  ${IDEM_TABLE}"
printf "║  %-20s %s\n" "RDS (events):"     "  ${RDS_INSTANCE_ID}"
printf "║  %-20s %s\n" "S3 buckets:"       "  ${CONFIG_BUCKET}, ${DATALAKE_BUCKET}"
printf "║  %-20s %s\n" "Frontend bucket:"  "  ${FRONTEND_BUCKET}"
printf "║  %-20s %s\n" "CloudFront URL:"   "  https://${CF_DOMAIN}"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  %-20s %s\n" "PG_CONNECTION_STRING:" ""
printf "║    %s\n"     "${PG_CONNECTION_STRING}"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Add PG_CONNECTION_STRING as a GitHub Repository Secret             ║"
echo "║  Next: push to main branch to trigger lambda-deploy.yml CI/CD      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# ── CloudWatch Dashboard ─────────────────────────────────────────────────────
log "CloudWatch Dashboard"

DASHBOARD_NAME="${BASE}-overview"

DASHBOARD_BODY=$(cat << DASHBOARD
{
  "widgets": [
    {
      "type": "metric", "x": 0, "y": 0, "width": 12, "height": 6,
      "properties": {
        "title": "Lambda Invocations and Errors",
        "metrics": [
          ["AWS/Lambda", "Invocations", "FunctionName", "${API_FN_NAME}",    {"label": "API Invocations"}],
          ["AWS/Lambda", "Errors",      "FunctionName", "${API_FN_NAME}",    {"label": "API Errors",     "color": "#d62728"}],
          ["AWS/Lambda", "Invocations", "FunctionName", "${WORKER_FN_NAME}", {"label": "Worker Invocations"}],
          ["AWS/Lambda", "Errors",      "FunctionName", "${WORKER_FN_NAME}", {"label": "Worker Errors",  "color": "#ff7f0e"}]
        ],
        "view": "timeSeries", "stat": "Sum", "period": 60, "region": "${REGION}"
      }
    },
    {
      "type": "metric", "x": 12, "y": 0, "width": 12, "height": 6,
      "properties": {
        "title": "Lambda Duration p50 and p99 (ms)",
        "metrics": [
          ["AWS/Lambda", "Duration", "FunctionName", "${API_FN_NAME}",    {"label": "API p50",    "stat": "p50"}],
          ["AWS/Lambda", "Duration", "FunctionName", "${API_FN_NAME}",    {"label": "API p99",    "stat": "p99"}],
          ["AWS/Lambda", "Duration", "FunctionName", "${WORKER_FN_NAME}", {"label": "Worker p50", "stat": "p50"}],
          ["AWS/Lambda", "Duration", "FunctionName", "${WORKER_FN_NAME}", {"label": "Worker p99", "stat": "p99"}]
        ],
        "view": "timeSeries", "period": 60, "region": "${REGION}"
      }
    },
    {
      "type": "metric", "x": 0, "y": 6, "width": 12, "height": 6,
      "properties": {
        "title": "Import Jobs (Created / Done / Failed)",
        "metrics": [
          ["ESG/DataLake", "ImportJobCreated", "service", "datalake-ingest-api",    {"label": "Created", "color": "#1f77b4"}],
          ["ESG/DataLake", "ImportJobDone",    "service", "datalake-ingest-worker", {"label": "Done",    "color": "#2ca02c"}],
          ["ESG/DataLake", "ImportJobFailed",  "service", "datalake-ingest-worker", {"label": "Failed",  "color": "#d62728"}]
        ],
        "view": "timeSeries", "stat": "Sum", "period": 300, "region": "${REGION}"
      }
    },
    {
      "type": "metric", "x": 12, "y": 6, "width": 12, "height": 6,
      "properties": {
        "title": "Events Ingested per Period",
        "metrics": [
          ["ESG/DataLake", "EventsIngested", "service", "datalake-ingest-worker", {"label": "Events"}]
        ],
        "view": "timeSeries", "stat": "Sum", "period": 300, "region": "${REGION}"
      }
    },
    {
      "type": "metric", "x": 0, "y": 12, "width": 12, "height": 6,
      "properties": {
        "title": "HTTP Requests and Errors",
        "metrics": [
          ["ESG/DataLake", "HttpRequests", "service", "datalake-ingest-api", {"label": "Requests"}],
          ["ESG/DataLake", "HttpErrors",   "service", "datalake-ingest-api", {"label": "Errors", "color": "#d62728"}]
        ],
        "view": "timeSeries", "stat": "Sum", "period": 60, "region": "${REGION}"
      }
    },
    {
      "type": "metric", "x": 12, "y": 12, "width": 12, "height": 6,
      "properties": {
        "title": "HTTP Latency p50 / p99 (ms)",
        "metrics": [
          ["ESG/DataLake", "HttpLatency", "service", "datalake-ingest-api", {"label": "p50", "stat": "p50"}],
          ["ESG/DataLake", "HttpLatency", "service", "datalake-ingest-api", {"label": "p99", "stat": "p99"}]
        ],
        "view": "timeSeries", "period": 60, "region": "${REGION}"
      }
    },
    {
      "type": "log", "x": 0, "y": 18, "width": 24, "height": 6,
      "properties": {
        "title": "Recent Errors",
        "query": "SOURCE '/aws/lambda/${API_FN_NAME}' | SOURCE '/aws/lambda/${WORKER_FN_NAME}' | fields @timestamp, service, msg, jobId, requestId\n| filter level = 'error'\n| sort @timestamp desc\n| limit 50",
        "region": "${REGION}",
        "view": "table"
      }
    }
  ]
}
DASHBOARD
)

if aws cloudwatch put-dashboard \
     --dashboard-name "$DASHBOARD_NAME" \
     --dashboard-body "$DASHBOARD_BODY" \
     --region "$REGION" \
     --output text > /dev/null 2>&1; then
  ok "Dashboard: ${DASHBOARD_NAME}"
  echo "  https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=${DASHBOARD_NAME}"
else
  echo "  Warning: Dashboard creation failed (non-fatal — create manually in CloudWatch console)"
fi
