# 📜 HosteraX Master Changelog

All notable changes, architectural milestones, and commit histories of the **HosteraX Cloud Control Plane** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-08-18 (Production Release & Autonomous AI Cloud)

### 🚀 Major Platform Highlights
- **Model Context Protocol (MCP) Server**: Full JSON-RPC 2.0 implementation with **34 registered tools** (`hosterax/engine/src/mcp-server.mjs`) enabling Cursor IDE, Claude Desktop, Devin, Windsurf, and OpenAI Codex to autonomously provision projects, trigger deployments, inspect live telemetry, restore databases, and fix errors (`fe7c9c2`, `3ce05ee`, `f6594ef`).
- **Autonomous Multi-Provider AI Copilot**: Built-in CLI & Engine Copilot with support for Google Gemini (`gemini-2.5-flash`), Anthropic Claude (`claude-3-5-sonnet`), OpenAI (`gpt-4o`), and local Ollama (`llama3.2`) with automatic rate-limit backoff and tool retry (`d4d01a7`, `f6594ef`, `dae5e1d`, `e77fb49`).
- **2,502+ App Store Catalog Toolchain**: Consolidated 12 data pipeline scripts into a unified 3-tool engine (`scripts/build-catalog.mjs`, `scripts/enrich-metadata.mjs`, `scripts/sync-catalog.mjs`) ingesting Awesome-Selfhosted, selfh.st, and Awesome-Sysadmin with verified Docker Hub/GHCR multi-arch images and vector SVG logos (`d96a398`, `746f5ae`).
- **Zero-Downtime Blue/Green Deployment Engine**: Atomic proxy routing with health check probes, BuildKit layer caching, and pre-deploy migrations (`db97661`).
- **Native Desktop Application**: Electron 34 desktop app with embedded daemon supervisor, background system tray, and auto-boot engine (`086910e`, `508143a`).
- **Apache License 2.0**: Applied Apache 2.0 across the entire repository to enable global open-source community contributions (`d170d45`, `d3ceb6e`).

### 🌟 Added Features
- **Multi-Node Remote Fleet Management** (`d412e04`):
  - Encrypted SSH connection manager (`hosterax/engine/src/server-manager.mjs`) for remote Linux servers (Ubuntu, Debian, RHEL).
  - Real-time remote hardware telemetry (CPU, RAM, Disk, Docker status).
  - Agentless remote container deployments.
- **Self-Hosted Email Stack** (`508143a`, `2f5bddd`, `7520473`):
  - Automated DNS records generator for DKIM, SPF, DMARC, and MX records.
  - Complete mailbox provisioning, encrypted password hashing, and integrated Webmail client.
  - Email Aliases, Inbound Webhook Forwarding, and Outbound SMTP Relays with 1-click presets (SendGrid, Mailgun, Postmark, Resend, Brevo, AWS SES).
  - Real physical SMTP delivery via `nodemailer` with custom envelope sender resolution (`15ad1ad`, `a6164c7`).
  - SASL authentication validation and instant delivery error toasts (`3cba456`).
- **GitHub App Webhooks & Ephemeral PR Previews** (`d412e04`):
  - Automated push-to-deploy on `git push` to tracked branches.
  - Ephemeral preview environments automatically provisioned on pull requests and torn down on merge.
- **Multi-Tenant RBAC Organizations** (`508143a`):
  - Team switcher with Owner, Admin, Developer, and Viewer permission tiers.
  - Organization-scoped project isolation and invite token management.
- **Point-in-Time Database Snapshots & Remote S3 Sync** (`fe7c9c2`, `16dba68`, `60ecee1`):
  - Automated 1-click snapshot backups for PostgreSQL, MySQL, MongoDB, and Redis.
  - Real physical database dumps with SHA-256 integrity verification.
  - Automated cloud backup synchronization to AWS S3, Cloudflare R2, MinIO, and Backblaze B2.
- **Scheduled Cron Jobs Engine** (`fe7c9c2`):
  - Built-in cron scheduler supporting standard 5-field cron expressions (`hosterax/engine/src/cron-manager.mjs`).
  - Manual execution triggers and persistent run history.
- **AI Container Crash Diagnostics & 1-Click Rollback** (`2f5bddd`, `16dba68`):
  - Autonomous log analysis diagnosing exit codes, memory exhaustion, and stack traces.
  - 1-click self-healing rollback to the last known working release snapshot.
- **Universal Multi-Framework Dockerfile Generator** (`d26879f`):
  - Multi-stage Dockerfile generator for Bun, Deno, Next.js (standalone), Nuxt, SvelteKit, Astro, Remix, TanStack Start, FastAPI, Flask, Django, Go, Rust (Cargo), Spring Boot, .NET, Ruby on Rails, and PHP (Laravel).
- **Collision-Free CLI (`htx` & `hosterax`)** (`3ce05ee`, `78f2aa1`, `2be48f5`, `bbae924`):
  - Zero-dependency CLI on npm supporting universal `npx -y hosterax mcp:stdio` execution.
- **8-Language Internationalization with RTL** (`508143a`):
  - Instant localization for English, Spanish, French, German, Chinese, Japanese, and Arabic (with dynamic RTL layout switching).
- **Full Open-Source Documentation Suite** (`530e40d`):
  - Added `CONTRIBUTING.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`.

### 🛡️ Fixed & Improved
- **Docker Desktop Offline Resilience** (`f968ed7`): Added active daemon probing, log throttling to eliminate repeat log spam when Docker is closed, and actionable recovery feedback.
- **Loopback Rate-Limit Whitelist** (`f968ed7`, `d96a398`): Bypassed loopback addresses (`127.0.0.1`, `::1`, `localhost`) from rate limiting to eliminate false HTTP 429 errors during rapid UI telemetry polling.
- **Secret Protection** (`de55825`): Masked sensitive SMTP relay credentials and API keys in API responses.
- **Elimination of Simulation Code** (`16dba68`, `e846f83`): Replaced mock data with real live DNS queries via `node:dns`, physical Docker database provisioning, and kernel hardware metrics.
- **TypeScript & Test Verification** (`11d3c3a`): 100% clean TypeScript type check (0 errors across 80+ files) and 18 passing backend test suites in `npm run test:engine`.

---

## [0.1.5] — 2026-08-16 (Security Hardening & Self-Healing Watchdog)

### 🛡️ Security Hardening & Vulnerability Patches
- **13 Security Vulnerabilities Patched** (`5605d04`, `196d43d`, `24c6765`):
  - Fixed SQL injection vectors in project and deployment query parameters.
  - Fixed authentication bypass in token verification middleware.
  - Sanitized shell arguments to prevent command injection during zero-config builds.
  - Implemented secure API token hashing with CSPRNG entropy.
  - Added rate limiting with IP-based bucket throttling.
- **Automated SSL/TLS Gateway** (`825112f`, `81adcc7`, `49d5ecf`):
  - Real ACME HTTP-01 challenge verification with Let's Encrypt and Caddy 2.
  - Dynamic TLS certificate renewal and custom domain routing.

### 🌟 Added Features
- **Docker Hub & GHCR Live Explorer** (`a6cdafb`):
  - Deep container registry explorer supporting multi-architecture tag inspection (amd64, arm64).
- **Autonomous Self-Healing Watchdog Engine** (`a6cdafb`, `81adcc7`):
  - 5-second interval health probe monitoring with circuit breaker states (`CLOSED`, `OPEN`, `HALF-OPEN`).
  - Exponential backoff restart supervisor to prevent restart storms.
- **42-Stack Universal Language Detectors** (`1990a12`, `a6cdafb`):
  - Auto-detection for Node.js, Python, Go, Rust, Ruby, PHP, Java, and .NET projects.

---

## [0.1.0] — 2026-08-14 (Core Architecture & Control Plane Foundation)

### 🌟 Added Features
- **Control Plane Engine Daemon** (`1730fa3`, `4251168`, `0be9aa5`):
  - Lightweight native Node.js ESM daemon listening on port `:7777`.
  - SQLite database in WAL mode stored at `~/.hosterax/hosterax.db`.
- **Zero-Downtime Blue/Green Deployment Pipeline** (`6135039`, `e684420`):
  - Ephemeral target port deployment with atomic proxy route swapping.
- **Web Dashboard** (`8ec3c80`, `d31d6fa`):
  - Modern frontend built with TanStack Start, React 19, and Tailwind CSS on port `:8080`.
- **Magic DNS Provider** (`8ec3c80`):
  - Dynamic wildcard routing using `nip.io` and `sslip.io`.
- **Live Terminal Log Streaming** (`6135039`):
  - Real-time Server-Sent Events (SSE) and WebSocket log broadcasting.
- **Initial CLI & Projects API** (`0be9aa5`, `4251168`, `2bbf537`):
  - Early command-line interface, project management endpoints, and OAuth MCP access.
