# ==========================================
# 阶段 1：构建产物 (Builder)
# ==========================================
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ==========================================
# 阶段 2：运行环境 (Runner)
# ==========================================
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./
COPY --chown=node:node --from=builder /app/quant_engine ./quant_engine

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 3002

USER node
CMD ["node", "dist/index.js"]
