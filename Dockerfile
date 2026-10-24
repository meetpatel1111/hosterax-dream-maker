# =============================================================
# HosteraX Official Multi-Stage Production Dockerfile
# Supports linux/amd64 and linux/arm64 architectures
# =============================================================

# --- Stage 1: Build Frontend Control Plane ---
FROM node:24-alpine AS frontend-builder
WORKDIR /app

# Install build tools & dependencies
RUN apk add --no-cache python3 make g++ git
COPY package.json package-lock.json* bun.lock* ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy source code and build production bundle
COPY . .
# Node-server build: the engine serves it (assets) and runs its SSR entry (pages)
RUN npm run build:engine

# --- Stage 2: Production Runtime ---
FROM node:24-alpine AS runner
WORKDIR /app

# Install runtime dependencies & native build tools
RUN apk add --no-cache \
    docker-cli \
    docker-cli-compose \
    git \
    openssh-client \
    ca-certificates \
    curl \
    sqlite \
    tini \
    python3 \
    make \
    g++

ENV NODE_ENV=production \
    HOSTERAX_PORT=7777 \
    HOSTERAX_HOME=/root/.hosterax

# Install engine production dependencies (better-sqlite3 ships a prebuilt musl binary; the .npmrc
# keeps npm from running node-gyp for it)
COPY hosterax/engine/package.json hosterax/engine/package-lock.json hosterax/engine/.npmrc ./hosterax/engine/
RUN cd hosterax/engine && npm ci --omit=dev --no-audit --no-fund \
    && apk del make g++

# Copy engine source and CLI
COPY hosterax/engine ./hosterax/engine
COPY hosterax/cli ./hosterax/cli
COPY scripts ./scripts
COPY public ./public
COPY package.json ./

# Link global CLI binaries
RUN chmod +x ./hosterax/cli/src/cli.mjs \
    && ln -sf /app/hosterax/cli/src/cli.mjs /usr/local/bin/hosterax \
    && ln -sf /app/hosterax/cli/src/cli.mjs /usr/local/bin/htx

# Copy built frontend assets
COPY --from=frontend-builder /app/.output ./.output

# The engine serves both the API and the built dashboard on :7777.
# Run it with the Docker socket mounted so it can manage containers, e.g.
#   docker run -d -p 7777:7777 -v /var/run/docker.sock:/var/run/docker.sock \
#     -v hosterax-data:/root/.hosterax ghcr.io/<owner>/hosterax
# Requests that arrive through a published port are not "local", so sign in with the API token
# the engine prints on first start (docker logs <container>).
EXPOSE 7777

# Persistent state volume
VOLUME ["/root/.hosterax"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${HOSTERAX_PORT}/api/health" || exit 1

# Entrypoint via Tini init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default start command launches the engine, which also serves the dashboard
CMD ["node", "hosterax/engine/src/index.mjs"]
