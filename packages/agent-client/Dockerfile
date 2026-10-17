# AgentWatch Agent Client — Docker Image
# Multi-stage build: dev (with tsx watch) and production (compiled JS).

# ─── Base ───────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json .
RUN npm install --frozen-lockfile 2>/dev/null || npm install

# ─── Development ────────────────────────────────────────────────────────────────
FROM base AS development
COPY tsconfig.json .
COPY src ./src
CMD ["npx", "tsx", "src/main/index.ts"]

# ─── Builder ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY tsconfig.json .
COPY src ./src
RUN npm run build

# ─── Production ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY package.json .
RUN npm install --production --frozen-lockfile 2>/dev/null || npm install --production
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/main/index.js"]
