# ───────────────────────────────────────────────────
# Makefile — Data API Service
# ───────────────────────────────────────────────────

.PHONY: help install build clean \
        up down down-clean infra-up infra-init \
        dev-api dev-worker \
        lint typecheck check \
        test test-integration \
        docker-build setup local

# ── Variables ────────────────────────────────────

DC       = docker compose
DC_TEST  = docker compose -f docker-compose.yml -f docker-compose.test.yml

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

up: ## Start all containers (infra + api + worker) — persistent data
	$(DC) up -d --build

down: ## Stop all containers (keep volumes/data)
	$(DC) down

down-clean: ## Stop all containers and remove volumes (full reset)
	$(DC) down -v

infra-up: ## Start only infra (DynamoDB Local + LocalStack) — persistent
	$(DC) up -d dynamodb-local localstack

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

test-integration: ## Run integration tests (ephemeral in-memory infra)
	$(DC_TEST) up -d dynamodb-local localstack
	npm run infra:local:init
	npm run test:integration
	$(DC_TEST) down

# ── Docker image ─────────────────────────────────

docker-build: ## Build production Docker image
	docker build -t data-api-service:latest .
