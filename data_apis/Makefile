# ───────────────────────────────────────────────────
# Makefile — Data API Service
# ───────────────────────────────────────────────────

.PHONY: help install build clean \
        up down infra-up infra-init \
        dev-api dev-worker \
        lint typecheck check \
        test test-integration \
        docker-build setup local

# ── Default ──────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────

install: ## Install npm dependencies
	npm ci

build: ## Compile TypeScript
	npm run build

clean: ## Remove build artifacts
	rm -rf dist coverage

setup: install build ## Install deps + build (first-time setup)

# ── Docker Compose ───────────────────────────────

up: ## Start all containers (infra + api + worker)
	docker compose up -d --build

down: ## Stop all containers and remove volumes
	docker compose down -v

infra-up: ## Start only infra (DynamoDB Local + LocalStack)
	docker compose up -d dynamodb-local localstack

infra-init: ## Create local DynamoDB tables, S3 buckets, SQS queue
	npm run infra:local:init

# ── Local dev ────────────────────────────────────

dev-api: ## Run API locally with hot reload
	npm run dev:api

dev-worker: ## Run Worker locally with hot reload
	npm run dev:worker

local: infra-up infra-init dev-api ## Start infra + init + run API locally

# ── Quality ──────────────────────────────────────

lint: ## Run ESLint
	npm run lint

typecheck: ## Run TypeScript type checking
	npm run typecheck

check: lint typecheck ## Lint + typecheck

# ── Tests ────────────────────────────────────────

test: ## Run unit tests
	npm test

test-integration: infra-up infra-init ## Run integration tests (starts infra if needed)
	npm run test:integration

# ── Docker image ─────────────────────────────────

docker-build: ## Build production Docker image
	docker build -t data-api-service:latest .
