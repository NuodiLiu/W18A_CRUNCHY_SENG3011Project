# ── Build stage ──────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# ── Production stage ─────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist dist/
COPY src/mappings/ dist/mappings/

# Default entrypoint = API; override via CMD or ECS task definition
# API:    node dist/main.js
# Worker: node dist/worker.js
EXPOSE 3000

CMD ["node", "dist/main.js"]
