# =============================================================
# HosteraX Official Multi-Stage Production Dockerfile
# Supports linux/amd64 and linux/arm64 architectures
# =============================================================

# --- Stage 1: Build Frontend Control Plane ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Install build tools & dependencies
RUN apk add --no-cache python3 make g++ git
COPY package.json package-lock.json* bun.lock* ./
RUN npm install --legacy-peer-deps --prefer-offline

# Copy source code and build production bundle
COPY . .
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:22-alpine AS runner
WORKDIR /app

# Install runtime dependencies: Docker CLI, Git, OpenSSL, CA-Certificates, SQLite
RUN apk add --no-cache \
    docker-cli \
    docker-cli-compose \
    git \
    openssh-client \
    ca-certificates \
    curl \
    sqlite \
    tini

ENV NODE_ENV=production \
    HOSTERAX_PORT=7777 \
    HOSTERAX_HOME=/root/.hosterax \
    PORT=8080

# Install engine production dependencies
COPY hosterax/engine/package.json ./hosterax/engine/
RUN cd hosterax/engine && npm install --omit=dev --legacy-peer-deps

# Copy engine source and CLI
COPY hosterax/engine ./hosterax/engine
COPY hosterax/cli ./hosterax/cli
COPY scripts ./scripts
COPY public ./public
COPY package.json ./

# Link global CLI binaries
RUN npm link ./hosterax/cli

# Copy built frontend assets
COPY --from=frontend-builder /app/.output ./.output
COPY --from=frontend-builder /app/dist ./dist 2>/dev/null || true

# Expose Engine (:7777) and Web Dashboard (:8080)
EXPOSE 7777 8080

# Persistent state volume
VOLUME ["/root/.hosterax"]

# Entrypoint via Tini init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default start command launches both Engine and Web Dashboard
CMD ["node", "hosterax/engine/src/index.mjs"]
