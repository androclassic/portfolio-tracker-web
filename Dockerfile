# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client and build Next.js
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3033

# Copy runtime files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
# Copy source files needed for cache warming script (uses @/ path aliases)
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3033

# Create data directory for SQLite
RUN mkdir -p /data

# Apply migrations safely (not db push), warm caches in background, then start
CMD ["sh", "-c", "npx prisma migrate deploy && (npx tsx --tsconfig tsconfig.json prisma/warm-all-caches.ts > /tmp/cache-warm.log 2>&1 &) && npm run start"]
