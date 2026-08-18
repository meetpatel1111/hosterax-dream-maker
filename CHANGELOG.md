# 📜 HosteraX Comprehensive Changelog

All notable changes, architectural milestones, and individual commit histories for the **HosteraX Cloud Control Plane** are chronologically documented in this file across granular Semantic Versions with direct commit traceability.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-08-19 (Autonomous Live Translation & 100% MCP Subsystem Suite)

### 🚀 Highlights

- **Dynamic Real-Time Live Translation Library**: Autonomous Full-DOM live translation engine in `src/lib/live-translator.ts` supporting Spanish, Arabic (RTL), German, French, Japanese, Portuguese, and Chinese with LRU caching.
- **100% Full MCP & CLI Subsystem Coverage**: Added 12 new MCP tools and CLI command bindings for self-hosted email mailboxes/aliases, GitHub webhooks & ephemeral PR previews, and multi-tenant organization RBAC.
- **Lime-Green `[Hx]` Official Branding**: Updated vector `public/favicon.svg`, `public/logo.svg`, multi-resolution `public/favicon.ico`, and desktop/mobile headers with the lime-green rounded emblem and modern typography.
- **Dual GHCR Container Distribution**: Automated multi-arch builds published under both `ghcr.io/meetpatel1111/hosterax` and `ghcr.io/meetpatel1111/hosterax-dream-maker`.

---

## [1.0.0] — 2026-08-18 (General Availability Launch & Production Milestone)

### 🚀 Highlights

- **Apache License 2.0**: Applied Apache 2.0 across the entire repository to enable global open-source community contributions ([`d170d45`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d170d45), [`d3ceb6e`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d3ceb6e)).
- **Comprehensive Open-Source Documentation Suite**: Added `CONTRIBUTING.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and master changelog ([`530e40d`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/530e40d), [`e93ce82`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e93ce82)).
- **2,502+ App Catalog Pipeline Consolidation**: Refactored 12 fragmented scripts into a high-performance 3-tool pipeline (`scripts/build-catalog.mjs`, `scripts/enrich-metadata.mjs`, `scripts/sync-catalog.mjs`) with live star counters, verified Docker Hub/GHCR multi-arch images, and vector SVG logos ([`d96a398`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d96a398), [`746f5ae`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/746f5ae)).
- **Native Desktop App Packaging**: Electron 34 desktop application with embedded daemon supervisor, background system tray, and auto-spawning engine ([`086910e`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/086910e)).
- **Resilient Docker Desktop Error Handling**: Proactive daemon socket probing, log throttling to eliminate repeat log spam when Docker is closed, and actionable recovery feedback ([`f968ed7`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/f968ed7)).
- **Production Cleanliness**: Removed all hardcoded local paths and external scratch folders, replacing them with universal `npx -y hosterax mcp:stdio` execution ([`d96a398`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d96a398), [`746f5ae`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/746f5ae)).

---

## [0.1.9] — 2026-08-18 (Autonomous Multi-Provider AI Copilot)

### 🤖 Added

- **Universal Multi-Provider AI Copilot**: Added built-in terminal copilot supporting **Google Gemini**, **Anthropic Claude**, **OpenAI**, and **local Ollama** ([`f6594ef`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/f6594ef)).
- **Default Gemini 3.5 Flash**: Set `gemini-3.5-flash` as default high-speed, cost-effective reasoning engine for CLI copilot ([`be763a9`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/be763a9), [`9e8523d`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/9e8523d), [`dae5e1d`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/dae5e1d)).
- **Dynamic Model Selection**: Added `htx ai:model` command and `--model <name>` flag for custom model selection ([`ce2a705`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/ce2a705)).
- **Uniform Rate-Limit Backoff**: Implemented exponential backoff with jitter and retry caps across Claude, OpenAI, Ollama, and Gemini API calls ([`3600dcf`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/3600dcf), [`e77fb49`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e77fb49)).
- **Parallel Tool Execution**: Enabled multi-tool batch execution in a single model turn ([`e77fb49`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e77fb49)).

---

## [0.1.8] — 2026-08-18 (Universal Dockerfile Generator & Blue/Green Deployments)

### ⚡ Added

- **Universal Multi-Stage Dockerfile Generator**: Multi-stage zero-config Dockerfile generation for 15+ stacks (Bun, Deno, Next.js standalone, Nuxt, FastAPI, Flask, Django, Spring Boot, .NET, Rust Cargo, Go, Ruby on Rails, PHP Laravel) ([`d26879f`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d26879f)).
- **Zero-Downtime Blue/Green Deployment Engine**: Ephemeral target port deployment, health check probes (`/` and custom `health_path`), BuildKit layer caching, and pre-deploy migrations ([`db97661`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/db97661)).
- **Collision-Free CLI (`htx`)**: Added `htx` and `hosterax` global binary aliases with robust argument parsing ([`3ce05ee`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/3ce05ee), [`78f2aa1`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/78f2aa1), [`2be48f5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/2be48f5), [`bbae924`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/bbae924)).
- **34 Registered MCP Tools**: Expanded MCP Server to full platform coverage across projects, databases, domains, cron jobs, backups, remote servers, and AI rollbacks ([`3ce05ee`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/3ce05ee)).
- **Single Source of Truth Refactor**: Eliminated redundant backup routes and centralized database lifecycle in `hosterax/engine/src/backup-manager.mjs` ([`60ecee1`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/60ecee1)).

---

## [0.1.7] — 2026-08-18 (Physical Runtime Enforcement & Advanced Email Stack)

### 📧 Added

- **Elimination of Simulation Code**: Replaced mock data with real physical Docker database provisioning, real SHA-256 verified disk dumps, and live kernel telemetry ([`16dba68`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/16dba68), [`e846f83`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e846f83)).
- **Advanced Email Management**:
  - Email Aliases, Inbound Webhook Forwarding, and Outbound SMTP Relays ([`2f5bddd`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/2f5bddd)).
  - Real physical SMTP delivery over `nodemailer` to personal inboxes ([`7520473`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/7520473)).
  - SASL authentication validation and instant delivery error toasts ([`3cba456`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/3cba456)).
  - Secret protection masking API keys in list responses ([`de55825`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/de55825)).
  - Automatic custom domain envelope sender resolution ([`15ad1ad`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/15ad1ad), [`a6164c7`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/a6164c7)).
  - Visual email template editor with live preview and 1-click relay presets (SendGrid, Mailgun, Postmark, Resend, Brevo, AWS SES) ([`17af1a5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/17af1a5)).
- **AI Container Crash Diagnostics & 1-Click Rollbacks**: Automated error log analysis and instant rollback to the last working release snapshot ([`2f5bddd`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/2f5bddd)).
- **Health Route Alias**: Added `/api/health` alias and awaited asynchronous email dispatch ([`2cf8268`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/2cf8268)).

---

## [0.1.6] — 2026-08-18 (Parity Phase 2 & 3: Remote Fleet, Orgs, RBAC & i18n)

### 🌐 Added

- **Remote Multi-Node Server Management (SSH)**: Connect to remote Linux servers (Ubuntu, Debian, RHEL) via encrypted SSH with real-time hardware telemetry and connection tests ([`d412e04`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d412e04)).
- **GitHub App Webhooks & Ephemeral PR Previews**: Automated push-to-deploy on `git push` and ephemeral environments automatically provisioned on pull requests and torn down on merge ([`d412e04`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d412e04)).
- **Multi-Tenant RBAC Organizations**: Team switcher with Owner, Admin, Developer, and Viewer permission tiers ([`508143a`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/508143a)).
- **Self-Hosted Email Stack**: Automated DKIM, SPF, DMARC, and MX DNS record generator, mailbox provisioning, and Webmail client ([`508143a`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/508143a)).
- **8-Language Internationalization with RTL**: Instant localization for English, Spanish, French, German, Chinese, Japanese, and Arabic with dynamic RTL layout switching ([`508143a`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/508143a)).
- **Live DNS Queries**: Direct DNS resolution queries via `node:dns` ([`e846f83`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e846f83)).

---

## [0.1.5] — 2026-08-18 (Parity Phase 1: S3 Backup Sync, Cron Jobs & MCP Server)

### 💾 Added

- **Remote S3/R2 Backup Sync**: Automated cloud snapshot synchronization to AWS S3, Cloudflare R2, MinIO, and Backblaze B2 ([`fe7c9c2`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/fe7c9c2)).
- **Scheduled Cron Jobs Engine**: Built-in 5-field cron scheduler with manual triggers and execution history tracking ([`fe7c9c2`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/fe7c9c2)).
- **Model Context Protocol (MCP) Server**: JSON-RPC 2.0 MCP server for direct AI agent integration via Stdio and HTTP ([`fe7c9c2`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/fe7c9c2)).
- **TLS Manager Integration**: Seamless integration between Caddy automatic HTTPS, Certbot, and custom certificates ([`49d5ecf`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/49d5ecf)).
- **Full Production Build Verification**: 100% clean TypeScript compilation, ESLint fixes, and Elasticsearch resolution ([`11d3c3a`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/11d3c3a)).

---

## [0.1.4] — 2026-08-16 (Security Hardening & ACME SSL Gateway)

### 🛡️ Security

- **13 Security Vulnerabilities Patched** ([`5605d04`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/5605d04), [`196d43d`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/196d43d)):
  - Fixed SQL injection vectors in project and deployment query parameters.
  - Fixed authentication bypass in token verification middleware.
  - Sanitized shell arguments to prevent command injection during zero-config builds.
  - Implemented secure API token hashing with CSPRNG entropy.
  - Added rate limiting with IP-based bucket throttling.
- **5 Medium-Priority Issues Patched**: Header validation, path traversal guards, and memory leak cleanups ([`24c6765`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/24c6765)).

### 🌟 Added

- **Automated ACME SSL/TLS Gateway**: Real HTTP-01 challenge verification with Let's Encrypt and Caddy 2 ([`825112f`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/825112f), [`81adcc7`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/81adcc7)).
- **Docker Hub & GHCR Live Explorer**: Deep registry explorer supporting multi-architecture tag inspection ([`a6cdafb`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/a6cdafb)).
- **Autonomous Self-Healing Watchdog Engine**: 5-second interval health probe monitoring and circuit breaker states (`CLOSED`, `OPEN`, `HALF-OPEN`) ([`a6cdafb`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/a6cdafb), [`81adcc7`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/81adcc7)).

---

## [0.1.3] — 2026-08-15 (42-Stack Universal Language & Framework Registry)

### 📦 Added

- **42-Stack Universal Language Detectors**: Zero-config detection across 10 programming languages (Node.js, Python, Go, Rust, Ruby, PHP, Java, .NET) ([`1990a12`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/1990a12), [`a6cdafb`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/a6cdafb)).
- **Framework Manifest Parsers**: Automated detection for Next.js, Nuxt, SvelteKit, Astro, Remix, Vite, FastAPI, Flask, Django, Laravel, Rails, and Cargo ([`1990a12`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/1990a12)).
- **Interactive App Catalog View**: Category filters, instant search, and one-click installation cards ([`a6cdafb`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/a6cdafb)).

---

## [0.1.2] — 2026-08-12 - 2026-08-14 (Standalone Engine Daemon & Projects API)

### ⚙️ Added

- **Standalone Engine Daemon (`:7777`)**: Lightweight native Node.js ESM daemon listening on port `:7777` ([`1730fa3`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/1730fa3), [`0897f19`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/0897f19)).
- **RESTful Projects API**: Implemented CRUD routes for `/api/projects`, `/api/deployments`, and `/api/tokens` ([`4251168`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/4251168), [`0897f19`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/0897f19)).
- **Process Supervisor**: Background process manager with stdout/stderr capture and auto-restart policy ([`1730fa3`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/1730fa3)).
- **Dynamic Port Allocation**: Conflict-free port allocator assigning ephemeral ports to new release builds ([`1730fa3`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/1730fa3)).

---

## [0.1.1] — 2026-07-25 - 2026-07-27 (Engine Connectivity & Local Integration)

### 🔌 Added

- **Zero-Config Deployments**: Initial zero-config pipeline restoring engine connectivity ([`e684420`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/e684420)).
- **Local Engine Connector (`/local`)**: Direct connection route between web frontend and local engine daemon ([`ac089b5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/ac089b5)).
- **Unified Project View**: Consolidated multi-page project tabs into unified project layout ([`c364d2e`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/c364d2e)).
- **Preliminary OAuth & MCP Access**: Early authentication and Model Context Protocol transport handlers ([`2bbf537`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/2bbf537)).
- **Real-Time Log Listeners**: Initial Server-Sent Events (SSE) and WebSocket log listeners ([`641fb95`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/641fb95)).

---

## [0.1.0] — 2026-07-22 - 2026-07-24 (Genesis & Control Plane Foundation)

### 🌟 Initial Release

- **Project Genesis**: TanStack Start + React 19 + TypeScript + Tailwind CSS project initialization ([`d31d6fa`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/d31d6fa)).
- **Dashboard UI Layout**: HosteraX dark/light theme, navigation shell, and server status cards ([`8ec3c80`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/8ec3c80), [`7f465e5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/7f465e5)).
- **Deployment Stack Foundation**: Deployment progress indicators, terminal logs view, and status badges ([`6135039`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/6135039), [`100b040`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/100b040)).
- **HosteraX Runtime System**: Architectural foundation, constraint definitions, and runtime models ([`0be9aa5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/0be9aa5), [`ab909bf`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/ab909bf)).
- **Magic DNS Support**: Dynamic wildcard routing via `nip.io` and `sslip.io` ([`8ec3c80`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/8ec3c80)).
- **SQLite Metadata Store**: Embedded SQLite database in WAL mode stored at `~/.hosterax/hosterax.db` ([`0be9aa5`](https://github.com/meetpatel1111/hosterax-dream-maker/commit/0be9aa5)).
