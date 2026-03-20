# ESG Data Service API

Collection, Retrieval & Preprocessing APIs for ESG and Housing data.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Node.js v20+ (for local development without Docker)

## Quick Start (Docker)

Run the entire service locally with one command:

```bash
# Navigate to the data_apis directory
cd data_apis

# Start all services (API, Worker, DynamoDB Local, LocalStack)
docker compose up -d

# Check services are running
docker compose ps

# View API logs
docker compose logs -f api
```

The API will be available at: **http://localhost:3000**

## API Documentation

Once running, access the Swagger UI at:
```
http://localhost:3000/api-docs
```

## Available Endpoints

### Health Check
```
GET http://localhost:3000/health
```

### Events API
```
GET http://localhost:3000/api/v1/events
GET http://localhost:3000/api/v1/events/{eventId}
GET http://localhost:3000/api/v1/events/types
GET http://localhost:3000/api/v1/events/stats
```

### Collection API
```
POST http://localhost:3000/api/v1/collection/jobs
GET http://localhost:3000/api/v1/collection/jobs/{jobId}
```

### Preprocessing API
```
GET http://localhost:3000/api/v1/preprocessing/pipelines
POST http://localhost:3000/api/v1/preprocessing/jobs
GET http://localhost:3000/api/v1/preprocessing/jobs/{jobId}
```

## Stopping the Service

```bash
# Stop all containers
docker compose down

# Stop and remove all data (fresh start)
docker compose down -v
```

## Local Development (without full Docker)

If you want to run the API locally but still use Docker for infrastructure:

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start infrastructure containers only
docker compose up -d dynamodb-local localstack infra-init

# Build and run API locally
npm run build
npm run start:api
```

## Running Tests

```bash
npm test
```

## Architecture

```
┌──────────┐  ┌──────────┐      (simulated AWS)
│   API    │  │  Worker  │   ┌──────────────────────┐
│ :3000    │  │ SQS poll │   │  DynamoDB Local :8000│
└────┬─────┘  └────┬─────┘   │  LocalStack    :4566│
     └──────┬───────┘        │   └─ S3             │
            └────────────────│   └─ SQS            │
                             └──────────────────────┘
```

## Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `PORT` - API port (default: 3000)
- `AWS_REGION` - AWS region (default: ap-southeast-2)
- `DYNAMODB_ENDPOINT` - DynamoDB endpoint for local dev
- `S3_ENDPOINT` - S3 endpoint for local dev
