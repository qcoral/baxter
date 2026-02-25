# ── Stage 1: install dependencies (includes native module compilation) ─────────
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build Next.js ─────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: production runner ─────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy compiled Next.js output and runtime deps
COPY --from=deps    /app/node_modules      ./node_modules
COPY --from=builder /app/.next             ./.next
COPY --from=builder /app/next.config.mjs   ./next.config.mjs
COPY --from=builder /app/package.json      ./package.json

# Copy custom server and its type dependencies (transpiled by ts-node at start)
COPY --from=builder /app/server.ts              ./server.ts
COPY --from=builder /app/lib/socket.ts          ./lib/socket.ts
COPY --from=builder /app/lib/db.ts              ./lib/db.ts
COPY --from=builder /app/tsconfig.json          ./tsconfig.json
COPY --from=builder /app/tsconfig.server.json   ./tsconfig.server.json

EXPOSE 3001

# DB_PATH should point to a mounted persistent volume, e.g. /data/reviews.db
CMD ["npm", "run", "start"]
