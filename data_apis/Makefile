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
	@echo "Stopping any postgres containers on port 5432…"
	-docker stop data-postgres ticketing-postgres 2>/dev/null || true
	$(DC_TEST) up -d dynamodb-local localstack postgres
	@echo "Waiting for services to become healthy…"
	@$(DC_TEST) exec -T dynamodb-local sh -c 'until curl -sf http://localhost:8000 > /dev/null 2>&1 || [ $$? -eq 22 ]; do sleep 1; done' 2>/dev/null || sleep 5
	@$(DC_TEST) exec -T localstack sh -c 'until curl -sf http://localhost:4566/_localstack/health > /dev/null 2>&1; do sleep 1; done' 2>/dev/null || sleep 5
	@$(DC_TEST) exec -T test-postgres sh -c 'until pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done' 2>/dev/null || sleep 5
	PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/eia_dev npm run infra:local:init
	PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/eia_dev npm run test:integration
	$(DC_TEST) down
	@echo "Restarting dev postgres containers…"
	-docker start data-postgres ticketing-postgres 2>/dev/null || true

# ── Docker image ─────────────────────────────────

docker-build: ## Build production Docker image
	docker build -t data-api-service:latest .
