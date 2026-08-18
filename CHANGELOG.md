# 📜 HosteraX Changelog

All notable changes to the **HosteraX Cloud Control Plane** across all commits and releases are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-08-18

### 🚀 Major Highlights
- **Model Context Protocol (MCP) Server**: Full JSON-RPC 2.0 implementation with **34 registered tools** enabling Cursor, Claude Desktop, Devin, Windsurf, and OpenAI Codex to autonomously provision, deploy, inspect, and heal cloud infrastructure.
- **Autonomous Multi-Provider AI Copilot**: Built-in CLI & Engine Copilot with support for Google Gemini (`gemini-2.5-flash`), Anthropic Claude (`claude-3-5-sonnet`), OpenAI (`gpt-4o`), and local Ollama (`llama3.2`).
- **2,502+ App Store Catalog**: Consolidated multi-source catalog engine compiling Awesome-Selfhosted, selfh.st, and Awesome-Sysadmin with live star counters, verified Docker Hub/GHCR images, and high-resolution SVG logos.
- **Native Desktop App**: Electron 34 desktop application with embedded daemon supervisor, background system tray, and auto-spawning engine.
- **Apache License 2.0**: Applied Apache 2.0 across the entire repository to welcome global community contributions.

### 🌟 Added
- **Multi-Node Remote Fleet Management**:
  - Connect to remote Linux servers (Ubuntu, Debian, RHEL) via encrypted SSH.
  - Real-time remote hardware telemetry (CPU, RAM, Disk, Docker status).
  - Agentless deployment of container workloads to remote nodes.
- **Self-Hosted Email Stack**:
  - Automated DNS records generator for DKIM, SPF, DMARC, and MX records.
  - Complete mailbox provisioning, encrypted credential storage, and rich Webmail client.
  - Email Aliases, inbound webhook forwarding, and outbound SMTP relays with 1-click presets (SendGrid, Mailgun, Postmark, Resend, Brevo, AWS SES).
  - Real physical SMTP delivery via `nodemailer` and custom domain envelope sender resolution.
- **GitHub App Webhooks & Ephemeral PR Previews**:
  - Automated push-to-deploy on `git push` to tracked branches.
  - Ephemeral preview environments automatically spun up on pull requests and torn down on merge.
- **Multi-Tenant RBAC Organizations**:
  - Team switcher with Owner, Admin, Developer, and Viewer permission tiers.
  - Organization-scoped project isolation and invite token management.
- **Point-in-Time Database Snapshots & Remote S3 Sync**:
  - Automated 1-click snapshot backups for PostgreSQL, MySQL, MongoDB, and Redis.
  - Real physical dumps with SHA-256 integrity verification.
  - Automated sync to AWS S3, Cloudflare R2, MinIO, and Backblaze B2.
- **Scheduled Cron Jobs Engine**:
  - Built-in cron scheduler supporting standard 5-field cron expressions.
  - Manual execution triggers and execution history logs.
- **AI Container Crash Diagnostics & 1-Click Auto-Rollback**:
  - Automated error log analysis and root-cause determination for failing containers.
  - Instant 1-click self-healing rollback to the last known working release snapshot.
- **Universal Multi-Framework Zero-Config Generator**:
  - Automated multi-stage Dockerfile generation for Next.js (standalone), Vite, Nuxt, SvelteKit, Astro, Remix, TanStack Start, FastAPI, Flask, Django, Go, Rust (Cargo), Spring Boot, .NET, Ruby on Rails, and PHP (Laravel).
- **Collision-Free CLI (`htx` & `hosterax`)**:
  - Zero-dependency CLI package on npm supporting universal `npx -y hosterax mcp:stdio` execution.

### 🛡️ Fixed & Improved
- **Docker Desktop Resilience**: Added active daemon probing, log throttling to prevent log spam when Docker is closed, and actionable recovery feedback during deployments.
- **Rate Limiting Whitelist**: Bypassed loopback addresses (`127.0.0.1`, `::1`, `localhost`) from rate limiting to prevent false HTTP 429 errors during rapid UI telemetry polling.
- **Database Backup Reliability**: Fixed duplicate route definitions and enforced single source of truth for database dumps.
- **TypeScript & Linting**: 100% strict TypeScript compilation (0 errors across 80+ files) and passing ESLint checks.
- **Automated Test Coverage**: 18 comprehensive test suites passing in `npm run test:engine`.

---

## [0.1.5] - 2026-08-16

### 🛡️ Security Hardening & Bug Fixes
- **13 Security Vulnerabilities Patched**:
  - Fixed SQL injection vectors in project and deployment query parameters.
  - Fixed authentication bypass in token verification middleware.
  - Sanitized shell arguments to prevent command injection during zero-config builds.
  - Implemented secure API token hashing with CSPRNG entropy.
  - Added rate limiting with IP-based bucket throttling.
- **Automated SSL/TLS Gateway**:
  - Real ACME HTTP-01 challenge verification with Let's Encrypt and Caddy 2.
  - Dynamic TLS certificate renewal and custom domain routing.

### 🌟 Added
- **Docker Hub & GHCR Live Explorer**:
  - Deep container registry explorer supporting multi-architecture tag inspection (amd64, arm64).
- **Autonomous Self-Healing Watchdog (`self-heal.mjs`)**:
  - 5-second interval health probe monitoring with circuit breaker states (`CLOSED`, `OPEN`, `HALF-OPEN`).
  - Exponential backoff restart supervisor to prevent restart storms.
- **42-Stack Universal Language Detectors**:
  - Auto-detection for Node.js, Python, Go, Rust, Ruby, PHP, Java, and .NET projects.

---

## [0.1.0] - 2026-08-14

### 🌟 Initial Release
- **Core Engine Daemon**: Lightweight native Node.js ESM daemon listening on port `:7777`.
- **SQLite Metadata Store**: Embedded SQLite database in WAL mode stored at `~/.hosterax/hosterax.db`.
- **Zero-Downtime Blue/Green Deployment Engine**: Ephemeral target port deployment with atomic proxy route swapping.
- **Web Dashboard**: Modern frontend built with TanStack Start, React 19, and Tailwind CSS on port `:8080`.
- **Magic DNS Provider**: Instant wildcard domain routing using `nip.io` and `sslip.io`.
- **Live Terminal Log Streaming**: Server-Sent Events (SSE) and WebSocket log broadcasting.
