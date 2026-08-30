# syntax=docker/dockerfile:1

# ---- builder: install deps + compile better-sqlite3 for the target arch ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# toolchain only needed here; not carried into the runtime image
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# npm ci when a lockfile exists, otherwise a plain install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- runtime: slim image, no build tools, non-root ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# data dir is a bind mount / volume in compose; make sure it exists and is writable
RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "--max-old-space-size=192", "src/index.js"]
