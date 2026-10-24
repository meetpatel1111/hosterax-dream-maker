# 📜 HosteraX Comprehensive Changelog

All notable changes, architectural milestones, and individual commit histories for the **HosteraX Cloud Control Plane** are chronologically documented in this file across granular Semantic Versions with direct commit traceability.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Remote servers over SSH:** place Docker projects on another Linux machine. Add a server, confirm its host key (pinned; a changed key is refused), and choose it under **Run on** or with `htx create --server`. Builds and containers run on the server through the system `ssh` (key login only, strict host checking, a generated ssh config); the app is published on the server's loopback and reached through a port forward over the same connection, so routes, health checks, domains and tunnels work unchanged. Deploy, stop, restart, rollback, logs, delete, self-heal and auto-prune act on the server; an unreachable server shows its projects as unreachable and nothing is restarted. Real connection tests (login, Docker, CPU/RAM/disk), a monitor, key generation, a bootstrap script that authorises the key, `htx server:add|trust|test|bootstrap|rm`, and a dashboard flow. Docker projects only; no edge on the server; tested against a real OpenSSH server and the real Docker CLI with a stand-in Docker daemon.
- **Password protection (`htx gate`, project Settings):** a password page in front of any app, for domains, the edge and public tunnels alike (PBKDF2, signed 12-hour cookie, rate limit, WebSockets).
- **Notifications:** webhook (HMAC-signed), Slack, Discord, ntfy and email channels for failed deploys, crashing or rolled-back apps, servers going down or recovering, failed backups and restore drills, failed tunnels and Docker stopping; de-duplicated; `htx notify:*` and a dashboard page.
- **Docker context detection:** the native Docker client finds the daemon the CLI uses (Colima, Rancher Desktop, OrbStack, Docker Desktop, rootless Docker, Podman).
- **Generated reference docs:** `docs/CLI.md` and `docs/API.md` come from `hosterax help` and the API contract (`npm run docs:write`; CI fails if they drift). `docs/THIRD_PARTY.md` and `npm run licenses:check` inventory every shipped component and fail on strong copyleft or missing licences.
- The tunnel Docker images (cloudflared, ngrok, bore) are pinned by version and digest and can be overridden with `HOSTERAX_<TOOL>_IMAGE`.

- **Free public access (tunnels):** `htx expose <project|edge>` and a dashboard **Public access** page give an app a public https address from any computer, with no public IP or router setup. Providers: Cloudflare Quick Tunnel and named tunnel, localhost.run, Pinggy, Serveo, localtunnel, ngrok, Tailscale Funnel, bore (raw TCP) and an opt-in custom command. `auto` picks the first that works, falling through failures and saying what it tried; tunnels reconnect with backoff, resume after an engine restart, follow a redeployed project's new port and are removed with their project. Admin-only; can only target a deployed project or the edge, never the engine or dashboard; tokens are stored encrypted and kept out of command lines and logs. Optional automatic exposure of every deployed project (off by default). Works from the official Docker image (apps are reached on the Docker host; override with `HOSTERAX_TUNNEL_HOST`).
- `htx expose:ip` / `GET /api/expose/public-ip` looks up the machine's public IP, says whether it is assigned to this machine or behind NAT, and can save it for Magic DNS names.
- **Scheduled backups:** per-database cron schedules with retention (`keepLast`, `keepDays`), run serially, catch-up after downtime, failure events, and REST/CLI/dashboard management (`/api/backups/schedules`, `htx backup:schedule*`, Backups → Schedules).
- **Backup verification:** `POST /api/backups/:id/verify` / `htx backup:verify` check the checksum, authenticate encryption, read the archive end to end and look for a complete-dump footer. Every scheduled run is verified by default.
- **Restore drills:** `POST /api/backups/:id/drill` / `htx backup:drill` restore a backup into an isolated, throwaway container from the source's image and confirm the database answers (Postgres, MySQL/MariaDB, MongoDB, Redis).
- **Opt-in encrypted backup archives** (AES-256-GCM, streaming, authenticated before any restore); downloads are served decrypted.
- **API contract:** `scripts/api-contract.mjs` extracts the engine's routes, generates `hosterax/engine/src/openapi.json` (served at `GET /api/openapi.json`) and fails the test suite when the CLI or dashboard call a route the engine does not serve or use the wrong method (`npm run api:check` / `api:write`).
- **User accounts with enforced roles** (`owner`, `admin`, `developer`, `viewer`): sessions are bearer tokens (`hxs_…`) resolved into the same scope levels the engine already enforces, so every REST route, MCP tool and AI action respects the role, and role changes, disabling and deletion apply to live sessions immediately. First-run setup (`POST /api/auth/setup`) needs an admin credential; there is always at least one active owner; admins cannot create or change admins/owners.
- **Two-factor authentication (TOTP, RFC 6238)** with single-use recovery codes, replay protection and admin reset; secrets are encrypted at rest.
- **Single sign-on (OpenID Connect)** with authorization code + PKCE, full ID-token verification and least-privilege provisioning (never admin/owner).
- Sign-in lockout (8 failures → 15 minutes, per email, uniform for unknown emails), a sign-in audit log (`GET /api/auth/events`), dashboard pages (sign-in, Users & access, Settings → Your account) and CLI commands (`htx users`, `user:add|role|disable|enable|2fa-reset|rm`).

### Changed

- `PATCH /api/servers/:id` now edits only name, address, user and key (it used to accept any column, including status and metrics) and validates everything that reaches an ssh config; changing the address drops the pinned host key. Password login for servers is refused.

### Fixed

- The dashboard assumed the engine was at `http://localhost:7777`, so a dashboard served by an engine on any other port could not find it. The engine now marks the pages it serves (`Server-Timing: hosterax`) and the dashboard uses its own origin.
- Backups left `in_progress` by a crash are now marked failed on start; a stale unused `backup_schedules` table from an older version is set aside (`backup_schedules_legacy`).

### 🔒 Security

- **Environment variables are encrypted at rest** (AES-256-GCM) in `project_env`, the derived `projects.env_json` cache and compose `services.env_json`. Plaintext written by older versions is encrypted on the next start; env that only lived in `env_json` is imported into `project_env` first. A wrong key now fails loudly instead of deploying without configuration.
- **Fixed: `read`-scoped tokens could read every environment value** (including variables flagged secret) through `env_json` in `GET /api/projects` and `GET /api/projects/:name`. `env_json` is no longer part of any project response, and the project detail view returns service env keys only, masked.
- **Authentication is no longer implicit.** Only genuine same-machine, same-origin requests skip the token; everything else needs `Authorization: Bearer`. `GET /api/auth/me` tells the dashboard who it is. New `HOSTERAX_REQUIRE_AUTH`, `HOSTERAX_TRUSTED_ORIGINS` and `HOSTERAX_DEV` switches.
- **Tokens are stored hashed (SHA-256) and carry scopes** (`read` < `deploy` < `admin`), enforced globally, per MCP tool and for the AI copilot. The unauthenticated `/api/token` endpoint is removed; the first token is printed on first start.
- **Injection and traversal fixes:** Docker calls use argument vectors, image references/hostnames/env keys are validated, git URLs follow `--`, WebSocket log paths are confined, the server bootstrap script no longer interpolates user input.
- **Domain takeover fixed:** hostnames must be unique and ownership is proven with a DNS TXT challenge.
- **At-rest encryption (AES-256-GCM)** for SSH keys, S3 credentials, DKIM/TLS private keys, SMTP relay passwords and AI keys; salted scrypt hashes for mailbox passwords; real DKIM key pairs.
- **Signed confirmation tickets** for destructive AI/MCP actions; public GitHub webhooks verified by HMAC.
- Fuzzy Docker Hub image substitution is now opt-in (`HOSTERAX_IMAGE_DISCOVERY=1`).

### 🐛 Fixed

- The README claimed `HOSTERAX_PUBLIC_IP` was detected automatically. It never was: Magic DNS names used `127.0.0.1` unless you set it. The table now says so, and `htx expose:ip --save` sets it.
- **Engine no longer aborts on Node 24.21+.** `better-sqlite3` 11 and 12 crash the whole process (`Assertion failed: (env) != nullptr`) when the garbage collector frees a statement or database wrapper, which the engine does constantly because it prepares statements ad hoc; the Docker image runs Node 24. Upgraded to `better-sqlite3` 13, which does not have the problem and ships prebuilt binaries (no compiler needed); `hosterax/engine/.npmrc` sets `ignore-scripts=true` so lockfile installs (CI, Docker) do not run `node-gyp` for it, which needs a C++ toolchain and failed on Windows runners. A regression test (`sqlite-gc.test.mjs`) fails on the old versions. **Breaking:** `better-sqlite3` 13 needs Node 22 or newer, so the minimum Node version is now 22 (Node 20 is end-of-life).
- Engine failed to boot (`catalogAppsList is not defined`) and `npm ci` failed against a private registry lockfile.
- Backups, rollbacks, database provisioning, start/stop/restart and the 9-stage audit now perform the real operation and report failure honestly instead of returning fake success.
- Environment variables have a single source of truth (`project_env`); webhook handling consolidated; duplicated self-heal methods and an un-awaited Docker probe removed.
- CLI commands called routes and fields that do not exist (`projects`, `rollback`, `env`, `db:create`, `backup:*`, `domain:*`, `tokens`…); they now match the engine API.
- Dashboard: honest sign-in (no fake accounts or local-storage "auth"), folder/zip uploads, removed hardcoded metrics and counts, corrected stack/app/tool counts, Servers page no longer invents CPU/RAM figures.
- **The engine could not serve the dashboard.** The production build targeted a Cloudflare-style SSR worker and produced no `index.html`, so the Docker image, the npm package and the desktop app answered `404` at `/`. The engine now serves the build's assets itself and runs its Node SSR entry as a loopback-only child (new `dashboard-server.mjs`); build it with `npm run build:engine`. `npm run build` still produces the Lovable/Cloudflare build.
- Dockerfile exposed a dashboard port that did not exist and used `npm install`; release workflow could never create a release (`needs.gate` was not a dependency) and swallowed packaging errors.

### Changed

- Machine translation of the whole page is now opt-in (Settings → Language & translation) because it sends on-screen text to third parties; third-party favicon lookup services were removed and app logos can be disabled (Settings → Privacy).
- App catalog entries carry an `imageVerified` flag (608 verified, the rest best-guess).
- MCP now exposes 46 tools. Documentation (README, SECURITY, ARCHITECTURE, CLI README) rewritten to match actual behavior, including known limitations.

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
