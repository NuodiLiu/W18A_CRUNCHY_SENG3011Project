# ───────────────────────────────────────────────────
# Makefile — ESG Data Service shortcuts
# ───────────────────────────────────────────────────

.PHONY: help install build clean \
        up down logs logs-api logs-worker ps \
        dev-api dev-worker infra-init \
        test test-unit test-integration \
        lint typecheck check \
        docker-build docker-push

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

# ── Docker Compose (one-click local env) ─────────

up: ## Start all containers (infra + api + worker)
	docker compose up -d --build

down: ## Stop all containers and remove volumes
	docker compose down -v

ps: ## Show running containers
	docker compose ps

logs: ## Tail logs for all containers
	docker compose logs -f

logs-api: ## Tail API container logs
	docker compose logs -f api

logs-worker: ## Tail Worker container logs
	docker compose logs -f worker

restart-api: ## Restart API container only
	docker compose restart api

restart-worker: ## Restart Worker container only
	docker compose restart worker

# ── Local dev (no Docker for app, only infra) ────

infra-up: ## Start only infra containers (DynamoDB Local + LocalStack)
	docker compose up -d dynamodb-local localstack

infra-init: ## Create local DynamoDB tables, S3 buckets, SQS queue
	npm run infra:local:init

dev-api: ## Run API locally with tsx (hot reload)
	npm run dev:api

dev-worker: ## Run Worker locally with tsx (hot reload)
	npm run dev:worker

# ── Quality ──────────────────────────────────────

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint with auto-fix
	npm run lint:fix

typecheck: ## Run TypeScript type checking
	npm run typecheck

check: lint typecheck ## Lint + typecheck

# ── Tests ────────────────────────────────────────

test: ## Run unit tests
	npm test

test-unit: ## Run unit tests (alias)
	npm test

test-integration: ## Run integration tests (requires infra running)
	npm run test:integration

test-all: ## Run all tests
	npm run test:all

# ── Docker image ─────────────────────────────────

docker-build: ## Build production Docker image
	docker build -t esg-data-service:latest .

docker-push: ## Tag and push to ECR (requires AWS auth)
	@echo "Usage: make docker-push REGISTRY=<account>.dkr.ecr.<region>.amazonaws.com TAG=<tag>"
	docker tag esg-data-service:latest $(REGISTRY)/esg-data-service:$(TAG)
	docker push $(REGISTRY)/esg-data-service:$(TAG)

# ── Compound commands ────────────────────────────

setup: install build ## Install deps + build (first-time setup)

fresh: down up ## Tear down and rebuild everything

local: infra-up infra-init dev-api ## Start infra + init + API (no Docker for app)
