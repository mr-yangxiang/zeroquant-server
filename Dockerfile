# ==========================================
# 阶段 1：构建产物 (Builder)
# ==========================================
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN apt-get update -y && apt-get install -y openssl
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

# ==========================================
# 阶段 2：运行环境 (Runner)
# ==========================================
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "dist/index.js"]
