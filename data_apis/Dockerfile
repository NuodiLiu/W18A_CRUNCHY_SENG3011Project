# ── Build stage ──────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.scripts.json* ./
COPY src/ src/
COPY scripts/ scripts/

# Build app (src/) + scripts/ 
RUN npm run build && ./node_modules/.bin/tsc scripts/init-local-infra.ts --outDir dist/scripts --esModuleInterop --module Node16 --moduleResolution Node16 --skipLibCheck --target ES2022

# ── Production stage ─────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist dist/
COPY --from=builder /app/dist/scripts dist/scripts/
COPY src/mappings/ dist/mappings/

# Default entrypoint = API; override via CMD or ECS task definition
# API:    node dist/main.js
# Worker: node dist/worker.js
EXPOSE 3000

CMD ["node", "dist/main.js"]
