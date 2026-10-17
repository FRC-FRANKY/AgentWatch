# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: Development ──────────────────────────────────────────────────────
FROM node:20-alpine AS development

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

USER node

EXPOSE 4000

CMD ["dumb-init", "npm", "run", "dev"]

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S agentwatch -u 1001 -G nodejs

WORKDIR /app

# Only production deps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Ownership
RUN chown -R agentwatch:nodejs /app

USER agentwatch

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["dumb-init", "node", "dist/index.js"]
