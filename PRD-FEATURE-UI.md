# HosteraX — Complete Feature & UI Product Requirements Document

**Version:** 2.1 (Complete Codebase Inventory)  
**Date:** 2026-07-22  
**Author:** meetpatel1111  
**Product:** HosteraX — Open-source, self-hostable deployment platform  
**Repo:** [github.com/hosterax/hosterax](https://github.com/hosterax/hosterax)  
**Version:** 0.2.2  
**License:** Apache 2.0  
**Monorepo:** Turborepo v2 + pnpm workspaces + Bun 1.3.10

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Monorepo Architecture](#2-monorepo-architecture)
3. [Application Ecosystem](#3-application-ecosystem--complete-inventory)
4. [Tech Stack](#4-tech-stack)
5. [Target Users & Personas](#5-target-users--personas)
6. [Complete Feature Inventory](#6-complete-feature-inventory)
7. [All UI Components Inventory](#7-all-ui-components-inventory)
8. [All Pages & Routes](#8-all-pages--routes)
9. [All API Endpoints](#9-all-api-endpoints)
10. [Database Schema](#10-database-schema)
11. [Design System & Tokens](#11-design-system--tokens)
12. [Localization System](#12-localization-system)
13. [Infrastructure & Deployment](#13-infrastructure--deployment)
14. [Build & CI/CD Pipeline](#14-build--cicd-pipeline)
15. [Gap Analysis & Recommendations](#15-gap-analysis--recommendations)
16. [UI Enhancement Roadmap](#16-ui-enhancement-roadmap)
17. [Performance & Accessibility Requirements](#17-performance--accessibility-requirements)
18. [Success Metrics](#18-success-metrics)

---

## 1. Product Overview

HosteraX is an **open-source (Apache 2.0), self-hosted deployment platform with built-in CI/CD** — the "Vercel/Heroku for your own infrastructure." Point it at any git repo, and it auto-detects the stack, builds, configures SSL/domains, and deploys with zero configuration files, zero pipelines, and zero YAML. HosteraX is a self-hosted-only product and does not provide any compute, cloud, or SaaS services.

### Core Value Propositions

- **Zero-config deploys** — Push-to-deploy from any git repo. Auto-detects 42 stacks across 12 languages.
- **Two deployment modes:**
  - **Desktop app (Electron):** Control plane on your machine, drives servers over SSH, nothing exposed publicly.
  - **Self-hosted server:** Always-on team deployment with login/auth, runs on your own infrastructure via Docker Compose.
- **Three interfaces:** Desktop (Electron GUI), Dashboard (Next.js web UI), CLI (Commander.js terminal).
- **Full managed backend:** Postgres, MySQL, MongoDB, Redis, workers, WebSockets, object storage, scheduled jobs.
- **Automatic SSL** via Let's Encrypt with wildcard domains and auto-renewal.
- **Built-in CDN** with edge caching, HTTP/3, Brotli compression via OpenResty.
- **Self-hosted mail server** (SMTP/IMAP/webmail) with DKIM/SPF/DMARC via iRedMail + Zero Email.
- **Scheduled backups** with S3/local destinations and one-click restore.
- **Real-time monitoring:** Live build logs (SSE), container metrics (CPU/memory/disk/network), xterm.js terminal.
- **Multi-node ready** on self-hosted.
- **One-click app catalog** — 17 pre-built templates (n8n, Ghost, Directus, Metabase, Gitea, etc.).
- **Multi-tenant** with orgs, teams, and roles.
- **Full audit trail** with retention-based pruning.
- **MCP (Model Context Protocol) support** for AI agent integration (OAuth 2.1 + JSON-RPC).
- **Internationalization** — 8 locales (EN, AR, DE, ES, FR, JA, PT, ZH) across 23 namespace files.

---

## 2. Monorepo Architecture

### 2.1 Directory Structure

```
hosterax/
├── apps/                              # Deployable applications
│   ├── api/                           # @repo/api — Hono v4 REST API (control plane)
│   ├── dashboard/                     # @repo/dashboard — Next.js 16 admin UI
│   ├── web/                           # @repo/web — Next.js 16 marketing site + docs
│   ├── desktop/                       # @repo/desktop — Electron 40 desktop app
│   ├── cli/                           # @repo/cli — Commander.js CLI (npm package)
│   └── email/                         # @repo/email — Self-hosted mail engine
├── packages/                          # Shared libraries
│   ├── core/                          # @repo/core — Types, constants, stacks registry, utils
│   ├── adapters/                      # @repo/adapters — Platform abstraction layer
│   ├── db/                            # @repo/db — Database schema + repos (Drizzle ORM)
│   ├── ui/                            # @repo/ui — Shared React UI components
│   ├── onboarding/                    # @repo/onboarding — Setup wizard logic
│   └── db-email/                      # @repo/db-email — Email server DB schema
├── scripts/                           # Build/release scripts
├── fixtures/                          # Test fixtures
├── docs/                              # Documentation + i18n READMEs
├── .github/workflows/                 # CI + Release pipelines
├── .githooks/                         # Git hooks (post-merge, post-rewrite)
└── build/                             # Build output (cli tarballs)
```

### 2.2 Internal Dependency Graph

```
@repo/core        ← no internal deps (only zod)
@repo/db          ← depends on @repo/core
@repo/adapters    ← depends on @repo/core
@repo/ui          ← peer deps on React, uses class-variance-authority, clsx, tailwind-merge
@repo/onboarding  ← no internal deps
@repo/db-email    ← depends on drizzle-orm + pg

apps/api          ← depends on @repo/adapters, @repo/core, @repo/db
apps/dashboard    ← depends on @repo/core, @repo/ui, @repo/onboarding
apps/cli          ← depends on @repo/core, @repo/onboarding
apps/desktop      ← depends on @repo/core, @repo/onboarding
apps/web          ← depends on @repo/core, @repo/ui
apps/email        ← depends on @repo/db-email
```

### 2.3 Application Port Map

| App                | Port     | Notes                                                  |
| ------------------ | -------- | ------------------------------------------------------ |
| web (marketing)    | 3000     | Public marketing site + docs                           |
| dashboard          | 3001     | Admin UI (private)                                     |
| api                | 4000     | Control plane HTTP API                                 |
| _(saas-dashboard)_ | _(3002)_ | _(removed — HosteraX does not provide cloud services)_ |
| _(saas-api)_       | _(4100)_ | _(removed — HosteraX does not provide cloud services)_ |

---

## 3. Application Ecosystem — Complete Inventory

Beyond the main HosteraX platform, the monorepo contains several standalone applications and engines:

### 3.1 Webmail Client (`apps/email/client/`)

A full-featured **React 19 single-page application** (57 pages, ~2,495 component LOC):

**Tech:**

- **React 19** + react-router v7 (client-side routing)
- **tRPC v11** + TanStack React Query (type-safe API calls)
- **Jotai** atomic state management (atoms for: activeFolder, selectedThread, page, mailQuery, sidebarVisibility, settings, searchTerm, searchArea, searchPopoverOpen, composeState, mailboxSearchParams)
- **Nuqs** URL state management
- **TipTap / Novel** rich text editor (slash commands, markdown shortcuts, autocomplete suggestions)
- **Tailwind CSS 4** + **shadcn/ui** (57 components)
- **Vite** build tool

**Architecture:**

- tRPC router with 10 sub-routers: `mail`, `drafts`, `labels`, `settings`, `shortcut`, `templates`, `user`, `cookiePreferences`, `branding` + 6 stubs
- IMAP folder-based threading via X-GM-THRID and References headers
- SSE bridge for IMAP IDLE push notifications
- Encrypted session-based credential storage
- Rate limiting, audit logging, HTML sanitization on server

### 3.2 Email Server (`apps/email/server/`)

A **Hono + Bun** backend providing:

- **IMAP** access via ImapFlow (folder listing, message fetch, search, threading by X-GM-THRID/References)
- **SMTP** sending
- **tRPC v11** router (10 sub-routers: mail, drafts, labels, settings, shortcut, templates, user, cookiePreferences, branding + 6 stubs)
- **Session management** with encrypted password storage
- **SSE** bridge for IMAP IDLE (push notifications)
- **Rate limiting**, **audit logging**, **HTML sanitization**
- **Drizzle ORM** with SQLite (session, settings, label, shortcut, threadState, cookieConsent, branding tables)

### 3.3 iRedMail Engine (`apps/email/engine/`)

A **bash-based installer** for self-hosted email infrastructure:

- **Postfix** (MTA)
- **Dovecot** (IMAP/POP3)
- **Amavis** (virus scanning)
- **ClamAV** (antivirus)
- **SpamAssassin** (spam filtering)
- **iRedAPD** (policy daemon)
- **fail2ban** (intrusion prevention)
- **logwatch** (log monitoring)
- Strips iRedAdmin/SOGo/Roundcube/nginx/PHP/MySQL/LDAP/Netdata

### 3.4 Deploy Test Fixtures (`fixtures/deploy/`)

20 minimal "hello world on $PORT" apps across 8 stacks for validating stack detection and build pipeline:

| Stack            | Variants                                    | Count |
| ---------------- | ------------------------------------------- | ----- |
| Node.js          | Single `package.json` + Express hello world | 2     |
| Python/FastAPI   | `requirements.txt` + FastAPI app            | 2     |
| Java/Spring Boot | Maven `pom.xml` + Spring Boot app           | 4     |
| Kotlin           | Gradle `build.gradle.kts` + Ktor app        | 3     |
| Rust/Axum        | `Cargo.toml` + Axum server                  | 3     |
| .NET             | `.csproj` + minimal API                     | 2     |
| Go               | `go.mod` + HTTP server                      | 2     |
| Laravel/PHP      | `composer.json` + artisan-served app        | 2     |

---

## 4. Tech Stack

| Layer               | Technology                                                                        |
| ------------------- | --------------------------------------------------------------------------------- |
| **Runtime**         | Bun 1.3.10 (primary), Node.js >=22 (Electron)                                     |
| **Monorepo**        | Turborepo v2 + pnpm workspaces                                                    |
| **Package Manager** | Bun (lockfile: bun.lock), pnpm as npm alternative                                 |
| **API Framework**   | Hono v4 (lightweight, Express-like)                                               |
| **Database ORM**    | Drizzle ORM v0.45                                                                 |
| **Database**        | PostgreSQL 16 (production) / PGlite (embedded, dev/desktop)                       |
| **Cache/Queue**     | Redis 7 via BullMQ (production) / in-process in-memory fallback                   |
| **Auth**            | Better Auth v1.5 (Drizzle adapter, org plugin, MCP OAuth)                         |
| **Dashboard UI**    | Next.js 16 (App Router), React 19, Tailwind CSS 4                                 |
| **Marketing/Docs**  | Next.js 16 + FumaDocs v16 (MDX documentation framework)                           |
| **Desktop**         | Electron 40 + electron-forge (Squirrel .zip, DMG, AppImage)                       |
| **CLI**             | Commander.js, @clack/prompts, chalk, ora                                          |
| **Charts**          | Recharts, Chart.js + react-chartjs-2                                              |
| **Terminal**        | xterm.js (browser terminal emulation)                                             |
| **Icons**           | Lucide React                                                                      |
| **Animations**      | GSAP v3, Motion v12 (Framer Motion)                                               |
| **Toast**           | sonner v2                                                                         |
| **Forms**           | Custom form components (no React Hook Form)                                       |
| **Validation**      | Zod v4                                                                            |
| **Infrastructure**  | Docker, OpenResty/Nginx, certbot, SSH2                                            |
| **Cloud**           | _(Removed — HosteraX does not provide cloud services)_                            |
| **Storage**         | AWS SDK v3 (S3-compatible)                                                        |
| **Payments**        | Stripe                                                                            |
| **Email**           | iRedMail (Postfix + Dovecot + Amavis + iRedAPD + fail2ban) + Zero Email (webmail) |
| **CI/CD**           | GitHub Actions (CI + Release)                                                     |
| **Code Quality**    | Prettier, TypeScript strict                                                       |

---

## 5. Target Users & Personas

### Persona A: Solo Developer / Indie Hacker (Alex)

- **Needs:** Deploy personal projects, side projects, and MVPs quickly without DevOps.
- **Pain points:** Heroku/Vercel expensive at scale; self-hosting too complex.
- **Primary interface:** Desktop app (Electron) + CLI.
- **Key features:** Push-to-deploy, SSL auto-config, free subdomain, env vars, one-click apps.

### Persona B: Small Team / Startup (Casey)

- **Needs:** Team deployment with preview environments, staging/prod, team access control.
- **Pain points:** Managing multiple servers, environments, and DBs is tedious.
- **Primary interface:** Dashboard (web) + CLI.
- **Key features:** Team orgs, env vars per environment, preview deployments, rollbacks, backups.

### Persona C: DevOps Engineer (Jordan)

- **Needs:** Self-hosted PaaS for the company; custom infrastructure, Docker, monitoring.
- **Pain points:** Configuration drift, scaling, backup management, security compliance.
- **Primary interface:** Dashboard + API + CLI.
- **Key features:** Multi-server SSH, Docker migration, custom domains, analytics, backup policies, audit log.

_(Note: HosteraX does not provide cloud/SaaS services. The product is self-hosted only.)_

---

## 6. Complete Feature Inventory

### 6.1 Core Platform

| Feature                            | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-target deployment            | ✅     | Docker containers, bare processes, SSH remote servers                                                                                                                                                                                                                                                                                                                                                                          |
| Zero-config stack detection        | ✅     | 42 stacks across 12 languages (JS/TS, Go, Rust, Python, Ruby, PHP, Java, C#, Elixir, Docker, Static, Generic)                                                                                                                                                                                                                                                                                                                  |
| Monorepo support                   | ✅     | 10 workspace detectors: pnpm, npm/yarn, Rush, Cargo, Go, uv, Elixir umbrella, Maven, Gradle, .NET solutions                                                                                                                                                                                                                                                                                                                    |
| Project environments               | ✅     | Production, Preview, Development (per-environment config)                                                                                                                                                                                                                                                                                                                                                                      |
| Deploy trigger: git push           | ✅     | Webhook-triggered from GitHub (push, PR, check-run)                                                                                                                                                                                                                                                                                                                                                                            |
| Deploy trigger: manual             | ✅     | From dashboard, CLI, API                                                                                                                                                                                                                                                                                                                                                                                                       |
| Deploy trigger: folder upload      | ✅     | Browser tar.gz builder, upload from local machine                                                                                                                                                                                                                                                                                                                                                                              |
| Deploy trigger: URL/template       | ✅     | Deploy from public URL or app template                                                                                                                                                                                                                                                                                                                                                                                         |
| Deploy trigger: release source     | ✅     | Deploy prebuilt distributions from GitHub releases (asset template with {tag}/{version}/{os}/{arch} placeholders) or HTTPS tarballs (with sha256 verification)                                                                                                                                                                                                                                                                 |
| Deploy trigger: CLI folder         | ✅     | `hosteraX deploy` from local directory (non-git auto-detects folder upload)                                                                                                                                                                                                                                                                                                                                                    |
| Deploy flag: --refresh             | ✅     | Re-apply current env vars to active deploy (no git pull, no rebuild)                                                                                                                                                                                                                                                                                                                                                           |
| Deploy flag: --smart-route         | ✅     | Rebuild only services changed since the active deploy                                                                                                                                                                                                                                                                                                                                                                          |
| Deploy flag: --force-all           | ✅     | Rebuild every enabled service (skip smart routing)                                                                                                                                                                                                                                                                                                                                                                             |
| Deploy flag: --service-ids         | ✅     | Deploy specific comma-separated service IDs                                                                                                                                                                                                                                                                                                                                                                                    |
| Deploy flag: --watch               | ✅     | Stream deployment logs to terminal until finished                                                                                                                                                                                                                                                                                                                                                                              |
| Rollback                           | ✅     | Git-based (checkout + rebuild) or snapshot-based (artifact archive with retention)                                                                                                                                                                                                                                                                                                                                             |
| Smart routing (deploy)             | ✅     | Automatic service URL resolution + hostname label generation                                                                                                                                                                                                                                                                                                                                                                   |
| Build pipeline                     | ✅     | 5-step FSM: queued → building → deploying → ready/failed, with SSE log streaming                                                                                                                                                                                                                                                                                                                                               |
| Build strategy                     | ✅     | Per-project: `server` (build in workspace) or `local` (build on host machine)                                                                                                                                                                                                                                                                                                                                                  |
| Build cache dirs                   | ✅     | Per-stack cache directories preserved across builds (`.next/cache`, `.cache`, `.nuxt`, etc.) for faster repeat builds                                                                                                                                                                                                                                                                                                          |
| Required tool versions             | ✅     | Per-stack minimum version requirements (e.g. node >= 20.9.0 for Next.js)                                                                                                                                                                                                                                                                                                                                                       |
| Build env vars injected            | ✅     | 16 env vars injected into every build: CI=true, telemetry disabled for all frameworks, color output forced, package manager update notifiers disabled                                                                                                                                                                                                                                                                          |
| Provision lock (concurrent builds) | ✅     | Two-layer lock: in-process mutex + Postgres advisory lock — prevents duplicate builds across replicas                                                                                                                                                                                                                                                                                                                          |
| Release versioning                 | ✅     | Semantic version tracking per deployment                                                                                                                                                                                                                                                                                                                                                                                       |
| Concurrent build limit             | ✅     | Max 1 concurrent per project, max 5 pending sessions                                                                                                                                                                                                                                                                                                                                                                           |
| Build timeout                      | ✅     | Configurable, default 30 minutes                                                                                                                                                                                                                                                                                                                                                                                               |
| Environment variables              | ✅     | Per-project, per-service, per-environment; encrypted at rest; max 100 per project                                                                                                                                                                                                                                                                                                                                              |
| Personal access tokens             | ✅     | Scoped tokens for API access (with resource grants)                                                                                                                                                                                                                                                                                                                                                                            |
| MCP OAuth                          | ✅     | OAuth 2.1 + MCP protocol for AI agent integration                                                                                                                                                                                                                                                                                                                                                                              |
| MCP JSON-RPC server                | ✅     | Streamable-HTTP JSON-RPC 2.0 at `/api/mcp`; accepts PAT or OAuth tokens; auto-generates tools from HTTP route registry (opt-in via `mcp` block); dispatches through real Hono app (full auth+permission stack); supports initialize/tools/list/tools/call/ping; 3 protocol versions (2025-06-18/2025-03-26/2024-11-05); capability-aware tool filtering (owner/admin/member/restricted); hard-deny for tokens/auth/mcp modules |
| Image catalog proxy                | ✅     | Proxies image catalog with 5min cache; empty catalog when no external registry linked                                                                                                                                                                                                                                                                                                                                          |
| Personal Access Tokens             | ✅     | Full PAT lifecycle with scoped resource grants; 8 grantable types; read-only flag (rejects mutations); expiry support; wildcard project scope (create-only); OAuth MCP binding (authorize/disconnect/list); grant validation ≤ minter's own access                                                                                                                                                                             |
| OAuth authorization server         | ✅     | Full OAuth 2.1 with consent, grants, and token management                                                                                                                                                                                                                                                                                                                                                                      |

### 6.2 Project & Service Management

| Feature                      | Status | Details                                                        |
| ---------------------------- | ------ | -------------------------------------------------------------- |
| Project CRUD                 | ✅     | Create, read, update, delete projects                          |
| Project groups (apps)        | ✅     | Parent grouping for project environments (`project_app` table) |
| Service CRUD                 | ✅     | Services within projects (kind: compose, monorepo, standalone) |
| Service env vars             | ✅     | Per-service environment variables                              |
| Service container management | ✅     | Start, stop, restart, inspect containers                       |
| Service terminal             | ✅     | WebSocket container exec (Docker)                              |
| Service drift detection      | ✅     | Compose spec vs running state comparison                       |
| App day-2 settings           | ✅     | Post-deployment configuration via schema-defined forms         |
| App settings: field types    | ✅     | text, password, boolean, select, number, with validation       |
| App management surfaces      | ✅     | Custom href or schema-based management pages                   |
| Resource grants/permissions  | ✅     | Fine-grained access control per resource type                  |
| Project library              | ✅     | Templates, repositories, local projects, URL import            |

### 6.3 Domains & SSL

| Feature                      | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom domain management     | ✅     | Full CRUD with DNS TXT verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Automatic Let's Encrypt SSL  | ✅     | Auto-provision and renewal (14 days before expiry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Wildcard SSL                 | ✅     | Via Let's Encrypt DNS-01 challenge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Free subdomains (hx.domains) | ✅     | For self-hosted deployments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| External ingress             | ✅     | Cloudflare Tunnel, load balancers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Manual SSL certificates      | ✅     | Bring-your-own certificate upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Domain verification          | ✅     | DNS TXT record challenge (`_hosteraX-challenge`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SSL status tracking          | ✅     | none, provisioning, active, expired, error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Primary domain selection     | ✅     | Per-service primary domain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Domain proxy                 | ✅     | Edge routing via OpenResty. Vercel.json rewrites/redirects/headers compiled to OpenResty locations                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — Vercel.json compilation    | ✅     | Parses `vercel.json` routing config, compiles to OpenResty locations; supports cleanUrls, trailingSlash flags                                                                                                                                                                                                                                                                                                                                                                                                                       |
| — Per-deployment route table | ✅     | Ordered list of rules per deployment; atomic replace on redeploy; scoped for rollback safety                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| — Route match types          | ✅     | Exact path, prefix, wildcard/param with capture groups                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| — Route actions              | ✅     | Proxy to origin URL (with websocket upgrade), rewrite to static path (SPA fallback), redirect (301/302/307/308 with capture substitution), response headers                                                                                                                                                                                                                                                                                                                                                                         |
| SSL renew-all                | ✅     | Batch renewal across all domains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Verify-pending domains       | ✅     | Background job for pending verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Route rules                  | ✅     | Rate limiting, IP/country bans, access control lists (CIDR/country/method allow/deny), hotlink protection (referrer-based), URL rewrite/redirect                                                                                                                                                                                                                                                                                                                                                                                    |
| — Rate limit spec            | ✅     | Per-client rps + burst, configurable 429 status, fixed 1s window, per-server nginx ceiling                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| — Ban spec                   | ✅     | IP list, CIDR ranges, ISO 3166-1 alpha-2 countries, User-Agent substrings (case-insensitive), empty-UA blocking                                                                                                                                                                                                                                                                                                                                                                                                                     |
| — Access spec                | ✅     | Allow/deny CIDRs, allow countries, HTTP method allow-list                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| — Hotlink spec               | ✅     | Referrer allow-list, configurable empty-referrer behavior, custom block status code (default 403)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| — Lua rules engine           | ✅     | 7 embedded Lua scripts compiled into OpenResty shared dict at boot: `rules_guard.lua` (IP/country/UA/method ACL eval), `rules_lib.lua` (CIDR-match, country-code hash lookup), `pipe_log.lua` (access-log pipe to API), `pipe_stream.lua` (log-tail SSE), `site_logger.lua` (per-site log dispatch), `mgmt_api.lua` (runtime rule reload + status), `geo_country.lua` (GeoLite2 country lookup), `webhook_handler.lua` (webhook forwarding); embedded as base64 constants via `embed-lua.ts` codegen, travel inside compiled binary |
| — Lua auto-embedded          | ✅     | `scripts/embed-lua.ts` — codegen that base64-encodes all `.lua` files into `lua-embedded.ts`; compiled binary carries its own Lua runtime so no file-system dependency                                                                                                                                                                                                                                                                                                                                                              |

### 6.4 Analytics & Monitoring

| Feature                       | Status | Details                                                                                                                                                              |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server analytics              | ✅     | Request counts, bandwidth, status codes                                                                                                                              |
| Geo-IP analytics              | ✅     | Geographic request breakdown                                                                                                                                         |
| Container resource monitoring | ✅     | CPU, memory, disk, network per container (SSE streaming)                                                                                                             |
| Server resource monitoring    | ✅     | Live CPU/memory/disk via SSE (`useMonitorStream`)                                                                                                                    |
| Live build logs               | ✅     | Server-Sent Events (SSE) with real-time log streaming                                                                                                                |
| Live terminal access          | ✅     | xterm.js over WebSocket (server SSH + container exec)                                                                                                                |
| Deployment history            | ✅     | Per-service status, duration, logs                                                                                                                                   |
| Build session logs            | ✅     | Full build output stored per session                                                                                                                                 |
| Deployment stats              | ✅     | Total deployments, success rate, avg duration                                                                                                                        |
| Dashboard overview analytics  | ✅     | Project count, deployment numbers, resource usage, dashboard rollup                                                                                                  |
| Analytics pipeline            | ✅     | OpenResty shared-dict real-time counters (log_by_lua) → scraper flush to DB every 5min (POST /analytics/flush, read+delete); merges DB archive + live OpenResty tail |
| Real-time analytics SSE       | ✅     | GET /analytics/usage/stream — 5s interval SSE stream with abort-aware disconnect; streams CPU/memory/bandwidth per container                                         |
| Geo analytics                 | ✅     | Daily country-level aggregates per server+domain; on-demand scrape triggers fresh data pull                                                                          |
| Server analytics              | ✅     | Per-server minute-bucket persistence; live unflushed data proxy via SSH; on-demand scrape (self-throttled, deduped with analytics read)                              |
| Container info                | ✅     | GET /analytics/container — container status, IP, uptime for a project                                                                                                |
| Audit log                     | ✅     | Full event trail with retention pruning                                                                                                                              |

### 6.4a Dockerfile Compiler

| Feature             | Status | Details                                                                                                                                                                              |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dockerfile parser   | ✅     | Parses Dockerfile AST (FROM, RUN, COPY, CMD, ENTRYPOINT, ENV, EXPOSE, WORKDIR, USER, ARG, VOLUME, LABEL, SHELL, HEALTHCHECK, ONBUILD, STOPSIGNAL); preserves comments and formatting |
| Dockerfile compiler | ✅     | Compiles runtime config + source into production Dockerfile; supports ENV injection, port mapping, build args, health checks                                                         |
| Build context       | ✅     | `prepareDockerBuildContext` — creates `.dockerignore`, writes Dockerfile, copies source into context tarball                                                                         |
| Build plan          | ✅     | `computeDockerBuildPlan` — determines build cache strategy, base image selection, layer ordering                                                                                     |

### 6.4b Toolchain & Stack Detection

| Feature                   | Status | Details                                                                                                                                       |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack catalog             | ✅     | 42 stacks across 12 languages with detection signatures, build commands, install commands, package managers, cache dirs, output dirs          |
| Toolchain checks          | ✅     | Version detection for core tooling: git, node, npm, pnpm, yarn, bun, python, pip, java, maven, gradle, go, rust, cargo, dotnet, ruby, bundler |
| Toolchain installer       | ✅     | Automated install scripts for missing toolchain components                                                                                    |
| Package manager detection | ✅     | Auto-detects npm/yarn/pnpm/bun from lockfile presence; falls back to `packageManager` field in package.json                                   |

### 6.4c Platform Adapter Architecture (`packages/adapters/src/`)

**Three-layer architecture** composed by the `Platform` factory — 3 runtimes, 3 infra providers, 1 system manager. All code lives in the same codebase; `createPlatform()` resolves the right combination at startup via dynamic imports (zero-bleed: unused deps never loaded).

```
┌──────────────┬──────────────┬─────────────────────────────┬────────────────┐
│              │  cloud       │  selfhosted                 │  desktop       │
│              │              ├──────────────┬──────────────┤                │
│              │              │  docker      │  bare        │                │
├──────────────┼──────────────┼──────────────┼──────────────┼────────────────┤
│  Runtime     │  Docker/Bare │  Docker      │  Bare        │  Bare          │
│  Routing     │  Nginx       │  Nginx       │  Nginx       │  No-op         │
│  SSL         │  certbot     │  certbot     │  certbot     │  No-op         │
│  System      │  docker, git │  docker, git │  git, nginx  │  -             │
│  Toolchain   │  per-stack   │  -           │  per-stack   │  -             │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────────┘
```

#### 6.4c.1 Shared Types (`src/types.ts` — 641 lines)

Pure data types shared across all adapter layers:

| Type                            | Purpose                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceConfig`                | CPU cores (fractional), memory MB, disk MB — single source of truth for build & runtime resources                                                                                                                                                                                                         |
| `DEFAULT_RESOURCE_CONFIG`       | Production runtime floor: 0.5 vCPU · 512 MB · 5 GB disk                                                                                                                                                                                                                                                   |
| `DEFAULT_BUILD_RESOURCE_CONFIG` | Build-time ceiling: 4 vCPU · 8 GB · 10 GB disk                                                                                                                                                                                                                                                            |
| `ContainerStatus`               | 7-state: queued, building, deploying, running, stopped, failed, cancelled, **missing** (drift detection)                                                                                                                                                                                                  |
| `BuildConfig`                   | 20+ fields: sessionId, projectId, repoUrl, branch, commitSha, localPath, buildStrategy, stack, buildImage, packageManager, installCommand, buildCommand, outputDirectory, port, hasServer, isStatic, envVars, resources, gitToken, gitCredentialHelperPath, gitSsh (privateKey+knownHosts), cloneOnServer |
| `DeployConfig`                  | deploymentId, projectId, buildSessionId, imageRef, environment, port, startCommand, resources, restartPolicy, runtimeName, publicEndpoints, productionPaths, previousDeploymentId, adopt flag                                                                                                             |
| `BuildResult`                   | sessionId, status, imageRef, durationMs, errorMessage, **startCommand** (overrides snapshot when build detects post-build changes like Next.js standalone)                                                                                                                                                |
| `DeploymentResult`              | deploymentId, containerId, url, status                                                                                                                                                                                                                                                                    |
| `BuildStep`                     | 5-step FSM: prepare → clone → install → build → deploy                                                                                                                                                                                                                                                    |
| `LogEntry`                      | timestamp, message, level (info/warn/error), step, stepStatus, serviceName, serviceId, rawData, seq (monotonic SSE event id)                                                                                                                                                                              |
| `ProvisionLock`                 | Serialization gate for server-scoped provisioning (in-process mutex + Postgres advisory lock)                                                                                                                                                                                                             |
| `ContainerInfo`                 | containerId, status, ip, hostPort, uptimeSeconds, usage (ResourceUsage)                                                                                                                                                                                                                                   |
| `ResourceUsage`                 | cpuPercent, memoryMb, diskMb, networkRxBytes, networkTxBytes                                                                                                                                                                                                                                              |
| `RouteConfig`                   | `ProxyRouteConfig` (targetUrl) or `StaticRouteConfig` (staticRoot) + shared: domain, tls, webhookProxy, proxyLocations, redirects, headerRules                                                                                                                                                            |
| `SslResult`                     | domain, expiresAt, issuer, verified (boolean), reason (issued/renewed/missing/read_error) — distinguishes "no cert yet" from "transient read failure"                                                                                                                                                     |
| `ManualCert`                    | certPem (fullchain PEM), keyPem — for bring-your-own certificates                                                                                                                                                                                                                                         |
| `SshConfig`                     | host, port, username, hostVerifier, password, privateKey, privateKeyPassphrase, sshAgent, useSystemSsh, sshJumpHost, sshArgs                                                                                                                                                                              |
| `CommandExecutor`               | Full interface: exec, streamExec, writeFile, readFile, exists, mkdir, rm, transferIn, dispose, onDisconnect, rawExec, forwardUnixSocket, forwardPort, openShell, reverseForward                                                                                                                           |
| `ShellSession`                  | stdin (Writable), stdout (Readable), stderr (Readable), setWindow(cols, rows), close(signal), onClose                                                                                                                                                                                                     |

#### 6.4c.2 Platform Factory (`src/platform.ts` — 330 lines)

`createPlatform(config: PlatformConfig): Promise<Platform>` — the single entry point. Returns:

- `target`: "cloud" | "selfhosted" | "desktop"
- `runtime`: RuntimeAdapter
- `routing`: RoutingProvider
- `ssl`: SslProvider
- `system`: SystemManager | null
- `executor`: CommandExecutor | null

`PlatformConfig` supports: target, runtime (docker/bare), docker connection options, bare options, nginx provider options, cloud provider options, admin proxy, ssh config, pre-built executor, state store, installer config, provision lock. Singleton via `initPlatform()` / `getPlatform()` — all service code calls `getPlatform()`.

#### 6.4c.3 Runtime Layer (`src/runtime/`)

**RuntimeAdapter Interface** (`src/runtime/types.ts` — 581 lines):

Capability-based design — `RuntimeCapability` enum (17 caps):

- `build`, `deploy`, `multiServiceDeploy`, `stop`, `start`, `restart`, `destroy`
- `containerInfo`, `runtimeLogs`, `streamLogs`, `usage`, `containerIp`
- `rollback` (makeActive, archive, purge primitives)
- `serviceShell` (interactive PTY shell inside deployment)
- `projectContainerSweep` (orphan sweep by label)
- `deploymentContainerQuery` (reconciliation by deployment label)
- `inContainerExec` (port probe inside container)

Rollback primitives: `makeActive(RollbackInput)`, `archive(DeploymentRef)`, `purge(DeploymentRef)` — idempotent, compose into "deploy landed: archive prev + activate new" flow.

Multi-service compose: `MultiServiceRuntimeAdapter` extends RuntimeAdapter with `ensureServiceGroup`, `deployServiceWorkload`, `buildImages` (batch with shared clone), `finalizeServiceGroup` (mesh re-resolution), `registerExistingWorkload`. Docker compose DTOs: DockerContainerSummary, DockerContainerDetail, DockerVolumeInfo, DockerNetworkInfo, DockerMount, DockerPortBinding.

**Runtime Implementations** (factory in `src/runtime/index.ts`):

| Runtime         | File                | Mechanism                                            | Key Features                                                                                                                                                                                                                                    |
| --------------- | ------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DockerRuntime` | `runtime/docker.ts` | dockerode over local socket, SSH tunnel, or TCP+mTLS | Full container lifecycle; Docker Compose multi-service; label-based querying; health checks; resource limits; restart policy; network management; remote Docker over SSH with streamlocal forwarding; host fingerprint pinning (TOFU or strict) |
| `BareRuntime`   | `runtime/bare.ts`   | Child processes via supervisor                       | Capistrano-style release dir symlink swap; `--link-dest` hard-link optimization; process adoption (model externally-managed process)                                                                                                            |
| `CloudRuntime`  | `runtime/cloud.ts`  | SSH executor over remote VMs                         | Remote VM lifecycle; cloud admin proxy for static pages; SSH-based management                                                                                                                                                                   |

**Process Supervision** (`src/runtime/supervisor/`):

| Supervisor          | File                     | Mechanism           | Features                                                                                                                                                                                                                                |
| ------------------- | ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SystemdSupervisor` | `systemd.ts` (271 lines) | systemd unit files  | `Type=exec` unit files; `systemctl enable --now` activation; journalctl logs; auto-restart on crash (Restart=on-failure); WantedBy=multi-user.target for reboot survival; EADDRINUSE detection with DeployError; artifact path tracking |
| `NohupSupervisor`   | `nohup.ts` (256 lines)   | `nohup + PID files` | `setsid` process group isolation; PID file tracking; graceful→SIGKILL shutdown with 10s grace; log file tailing; artifact path tracking                                                                                                 |
| `detectSupervisor`  | `detect.ts` (51 lines)   | Probes `systemd`    | Checks `/run/systemd/system` + `command -v systemctl`; auto-selects systemd or nohup                                                                                                                                                    |

**Source Transfer** (`src/runtime/transfer.ts` — 131 lines): `CommandExecutor.transferIn()` (SSH/local via tar pipe). `createTarball()` with `prepareSourceTarArgs()` — 3-tier precedence: explicit includes > git truth (ls-files --cached --others --exclude-standard) > name-based exclude fallback. Transfer verification (non-empty target check).

**Build Pipeline** (`src/runtime/build-pipeline.ts`):
5-step FSM with SSE log streaming; BuildLogger with ring buffer + replay; step lifecycle events (running→completed/failed/skipped); parseLogLevel for log level auto-detection.

**Deploy Pipeline** (`src/runtime/deploy-pipeline.ts`):
Pre-flight checks, resource validation, service readiness ordering, prompt user for port conflicts.

**Volume Namespace** (`src/runtime/volume-namespace.ts` — 75 lines):
Project-scoped Docker volume naming (`hosterax-{slug}-{name}` prefix) to prevent cross-project data corruption. Handles bind mounts, anonymous volumes, already-scoped names. Pure string logic, zero dependencies.

**Other runtime modules:**

- `deploy-pipeline.ts`: Pre-flight checks, resource validation, service readiness ordering, port conflict prompts via `runDeployPipeline()`
- `port-conflict.ts`: `probeListeningPort()` + `ensurePortAvailable()` — detect port occupants via process listener probes
- `docker-paths.ts`: `resolveDockerfileCandidates()` — find Dockerfile in build context
- `route-registration.ts`: `registerResolvedRoutes()` — atomic route table replace per deployment (ordered rule list, scoped for rollback safety)
- `transfer.ts`: Source transfer via `CommandExecutor.transferIn()` (SSH/local tar pipe); `createTarball()` with 3-tier precedence (explicit includes > git truth > name-based exclude fallback); macOS metadata stripping; transfer verification

#### 6.4c.4 Infrastructure Layer (`src/infra/`)

**Routing & SSL Provider Interfaces** (`src/infra/types.ts` — 53 lines):

- `RoutingProvider`: registerRoute, removeRoute
- `SslProvider`: provisionCert, renewCert, installCert (BYO certs), verifyCert (read-only)

**Nginx/OpenResty Provider** (`src/infra/nginx.ts` — 808 lines):
The primary self-hosted implementation. Writes OpenResty server blocks to `sites-enabled/`, reloads gracefully.

Router features:

- Proxy routes (proxy_pass with full header set: Host, X-Real-IP, X-Forwarded-For/Proto, Upgrade/WebSocket)
- Static routes (root + try_files SPA fallback)
- Composite routing: extra proxy locations (API backend), redirects (vercel.json), global response headers
- Webhook proxy location (`/_hosterax/hooks/`)
- Lua integration (log_by_lua + access_by_lua with rules guard)
- ACME challenge location (`.well-known/acme-challenge/`)
- HTTP→HTTPS redirect when TLS + certs present
- Atomic config writes (random-suffix temp file + mv)
- Pre-write snapshot → validate → rollback on failed reload (self-rollback)
- Route state sidecar (`{slug}.route.json`) preserving full RouteConfig for cert provisioning

SSL features:

- `provisionCert` — certbot certonly --webroot; rewrites vhost with SSL; re-registers with route state sidecar
- `renewCert` — certbot renew (or delegates to provisionCert if no cert exists yet)
- `installCert` — X509 validation + private key matching check before writing; same on-disk path as certbot
- `verifyCert` — read-only PEM parser; distinguishes missing vs read_error
- Cert info: X509Certificate.validTo parsing, issuer tracking

Rate limiting (`src/infra/nginx.ts` lines 630-807):

- `applyRateLimit(config)` — writes `ratelimit.conf` snippet with geo whitelist, map, limit_req_zone
- `getRateLimitConfig()` — parses current snippet back from disk
- Self-rollback on failed reload (nginx.conf + snippet snapshots)
- Geo whitelist: loopback + user-specified CIDRs
- `limit_req zone=global_limit burst=${n} nodelay` with 429 status

**OpenResty Lua System** (`src/infra/openresty-lua.ts` — 576 lines):

Path detection: `detectOpenRestyPaths()` parses `openresty -V` for sbin-path/conf-path/pid-path; fallback probes known locations (`/usr/local/openresty/...`, `/etc/openresty/...`, `/etc/nginx/...`); re-detects on stale paths.

Lua scripts deployed to `/usr/local/openresty/site/lualib/hosterax/`:

| Script                | Phase          | Purpose                                                                                                                                                                       |
| --------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_logger.lua`     | log_by_lua     | Atomic shared-dict counters (minute-bucket: requests, bandwidth in/out, response time, unique IPs); geo hit counts; lifetime totals; domain index marker; raw-log ring buffer |
| `pipe_log.lua`        | module         | Push request log into shared-dict queue for `/stream` SSE; geo_country lookup; per-domain subscriber flag                                                                     |
| `pipe_stream.lua`     | content_by_lua | SSE live-log endpoint (127.0.0.1:9145); 1-hour connection limit; 100 entries per cycle; heartbeat; drain stale queue                                                          |
| `mgmt_api.lua`        | content_by_lua | REST endpoints: `/health`, `/analytics`, `/analytics/totals`, `/analytics/geo`, `/logs/recent`, `/logs/stream`, `/rules` (CRUD for per-route rules cache)                     |
| `geo_country.lua`     | module         | MaxMind GeoLite2 lookup via lua-resty-maxminddb FFI; per-worker LRU cache; graceful fallback if DB missing                                                                    |
| `rules_lib.lua`       | module         | Per-worker compiled-rule cache; IPv4 helpers (int conversion, CIDR match); Lua patterns for user-agent matching; method set; hotlink referrer check                           |
| `rules_guard.lua`     | access_by_lua  | Enforce per-route rules: IP/CIDR allow/deny, country allow/ban, bad user-agent, hotlink protection, rate-limit counters                                                       |
| `webhook_handler.lua` | content_by_lua | Handle forwarded webhooks with local proxy + shared-dict fallback storage                                                                                                     |

Embedded Lua (`src/infra/lua-embedded.ts` — codegen from `scripts/embed-lua.ts`):
All 8 .lua scripts base64-encoded as TypeScript const `EMBEDDED_LUA`. The compiled binary carries its own Lua runtime — no filesystem dependency. `luaSourceAvailable()` gates vhost Lua directives (missing scripts → rules/logging off, sites UP). Self-healing: `ensureLuaScripts()` checks script presence + sha256 bundle hash on every deploy; reinstalls + stamps version marker + reloads on drift.

Geo deps (libmaxminddb, lua-resty-maxminddb opm package, GeoLite2-Country.mmdb) installed non-fatally via `installGeoDeps()` — analytics work without geo.

Shared-dict zones patched into nginx.conf:

- `analytics` (256 MB) — minute-bucket counters, daily geo, totals
- `request_data` (128 MB) — raw-log ring buffers + live-log pipe queue
- `rules` (32 MB) — per-route rules cache (reload-free POST /rules)
- `rl_counters` (16 MB) — rate-limit counters (separate from `rules` to prevent LRU-eviction of rulesets during floods)

Management port: `127.0.0.1:9145` — internal REST + SSE, queried via SSH tunnel.

**Vercel Routing Compiler** (`src/infra/vercel-routing.ts` — 159 lines):
`compileVercelRouting(routing: RoutingConfig)` — pure function (no I/O, unit-testable). Compiles vercel.json rewrites/redirects/headers/cleanUrls/trailingSlash to OpenResty locations. Security: `isSafePath()`, `isSafeDestination()`, `isSafeTargetUrl()`, `isSafeHeaderKey/value()` guards prevent nginx config injection. Unsupported patterns (`has`/`missing` conditions, ambiguous source patterns) are recorded in `skipped[]` — never silently dropped.

**Other Infra Providers:**

- `CloudInfraProvider` (`cloud.ts`): Routing + SSL on remote cloud VMs via SSH executor
- `NoopInfraProvider` (`noop.ts`): Desktop/dev — all methods no-op

#### 6.4c.5 System Layer (`src/system/`)

**System Types** (`src/system/types.ts` — 216 lines):

- `SystemComponentDefinition`: name, label, description, installable, category (core/infrastructure)
- `ComponentStatus`: full status with installed, version, availableVersion, updateAvailable, running, healthy, removable, removeSupported, removeBlockedReason
- `Feature`: build, deploy, routing, ssl — with prerequisite rules
- `InstallerConfig`: acmeEmail, domain, edgePolicy, promptUser
- Edge types: `ProxyKind` (nginx/caddy/apache/traefik/haproxy/openresty), `EdgeClassification` (free/ours/known/unknown), `EdgeOccupant`, `EdgePolicy`, `EdgeStopTarget`
- `ImportedSite`: serverNames, ssl, target (proxy/static), tls, source — normalized from existing proxy configs
- `ProxyScanResult`: proxy kind + sites + warnings

**Command Executors** (`src/system/executor.ts` — 19 lines):

| Executor            | File                     | Mechanism                      | Use Case                                                                                                                               |
| ------------------- | ------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `LocalExecutor`     | `local-executor.ts`      | `child_process` + `fs`         | Same-machine operations                                                                                                                |
| `SshExecutor`       | `ssh-executor.ts`        | `ssh2` library                 | Remote commands with key/password auth; rawExec with byte-stream; forwardUnixSocket; forwardPort; openShell PTY; reverseForward tunnel |
| `SystemSshExecutor` | `system-ssh-executor.ts` | OpenSSH binary + ControlMaster | Agent auth; SSH jump host; ControlMaster multiplexing (`ssh -fN`); PTY shell with remote stty resize; fireAndForget commands           |

`createExecutor(ssh?)` — if no SSH config, returns LocalExecutor. `useSystemSsh` flag selects SystemSshExecutor over SshExecutor.

**System Manager** (`src/system/setup.ts` — 569 lines):
Orchestrates server provisioning with cached 24h TTL:

- `checkAll()` / `checkRequired()` — run component checks
- `checkFeature(feature)` — fast path from cache, slow path from checks
- `requireFeature(feature)` — throw if not ready
- `ensureFeature(feature)` — check → install missing → revalidate
- `setup(onLog, config)` — full 3-phase: check → install → validate → cache
- `verify()` — force re-verification
- `invalidate()` — clear cache (call on component failure)
- Provision lock serializes check→install→revalidate section across concurrent deploys

**Component Checks** (`src/system/checks.ts`):

- `checkAll()` — checks all 4 components: git, docker, openresty, certbot
- `checkComponents(names)` — batch parallel checks
- Individual: `checkDocker`, `checkGit`, `checkOpenResty`, `checkCertbot`

**Component Installers** (`src/system/installer.ts`):

- `COMPONENT_INSTALLERS` — registered installers for docker, git, openresty, certbot, rsync
- `COMPONENT_UNINSTALLERS` — distro-aware removal (apt/dnf/yum/brew/apk)
- Each installer: resolve environment → get plan → stream install → verify

**System Catalog** (`src/system/catalog.ts`):
Hardcoded install recipes per component per OS/distro/package-manager. Same pattern as toolchain catalog.

**Edge Systems:**

- `edge-preflight.ts` — `probeEdge()` scans ports 80/443; classifies occupants (free/ours/known/unknown); `classifyProxy()` identifies proxy kind; `freeEdgeTargets()` resolves stop targets
- `edge-takeover.ts` — `runEdgeTakeover()` stops foreign proxy → installs OpenResty → re-registers sites → reuses/issues certs → verifies; full rollback on failure. `recoverInterruptedTakeover()` reads on-disk journal for crash recovery
- `available-version.ts` — package-manager probe for newer versions without `apt-get update`

**Remote Journal** (`src/system/remote-journal.ts`):
Exactly-once remote execution via POSIX `hx-run` wrapper. Survives SSH disconnect: journals stdout/stderr/exit to `<baseDir>/ops/<opId>/`, re-harvests on reconnect. Used by `execReliable()`, `runReliable()`, `runJournaled()`. Functions: `ensureRemoteJournal()`, `parseFrame()`, `OpInterruptedError`.

**Other System Modules:**

- `state.ts` — `SetupStateStore` interface + `FileStateStore` (file-based) implementation
- `environment.ts` — `resolveEnvironment()` probes OS, arch, distro, package manager, service manager
- `reachability.ts` — `probeTcp()`, `probeHttp()`, `waitForReady()` — network reachability probes
- `port-listen.ts` — `parseListeningPorts()`, `probePortListeningOnce()`, `waitForPortListening()` — port listening checks via `cat /proc/net/tcp*`
- `output-exists.ts` — `probeStaticOutput()` — check if build output directory exists
- `reverse-tunnel.ts` — dynamic loopback listener → `ssh -O forward -R` for git-credential relay
- `remote-transfer.ts` — resumable rsync (`--partial --inplace --append-verify`) over OpenSSH; fallback to ssh2 SFTP
- `ssh-client.ts` — SSH connection management with pooling
- `ssh-support.ts` — SSH key generation, known_hosts management
- `debug.ts` — `systemDebug()` + `formatDuration()` — structured debug logging
- `errors.ts` — `isRemoteConnectionError()`, `isRetryableRemoteConnectionError()`, `isSshAuthError()`, `isRuntimeNotFoundError()`, `isSshDisconnectedError()`, `SshDisconnectedError`
- `components.ts` — `SYSTEM_COMPONENTS` registry, `getSystemComponentDefinition()`
- `system-ssh.ts` — OpenSSH binary helper with ControlMaster support
- `elevated-executor.ts` — `sudo -n sh -c` wrapper for non-root servers with passwordless sudo; elevates only write operations

#### 6.4c.6 Toolchain Layer (`src/toolchain/`)

Stack-level tool validation and installation for bare-metal builds. Mirrors the system component catalog but for language-specific tools.

**Toolchain Types** (`src/toolchain/types.ts` — 84 lines):

- `ToolchainStatus`: name, label, installed, version, requiredVersion, healthy, message
- `ToolchainCheckResult`: tools[], ready, missing[], outdated[]
- `ToolchainCheckEntry`: label, versionCommand, parseVersion, missingMessage, installable, providedBy
- `ToolchainInstallPlan`: supported, unsupportedReason, installCommand, startCommand, verifyCommand, fallbackInstallCommands
- `ToolchainInstallResult`: tool, success, version, error

**Toolchain Catalog** (`src/toolchain/catalog.ts` — 536 lines):
Check recipes and install plan factories for 16 tools:

| Tool                    | Check Command           | Installable | Notes                                                                                       |
| ----------------------- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Node.js                 | `node --version`        | ✅          | Pinned to NodeSource node_22.x (nodistro suite, no curl\|bash); heals stale nodesource.list |
| Bun                     | `bun --version`         | ✅          | Pinned to bun-v1.2.0; cross-platform installer                                              |
| Go                      | `go version`            | ✅          | linux-amd64/arm64 tarball from go.dev; brew on macOS                                        |
| Rust                    | `rustc --version`       | ✅          | rustup.sh                                                                                   |
| Python 3                | `python3 --version`     | ✅          | apt/dnf/yum/brew per platform                                                               |
| pip                     | `pip3 --version`        | ✅          | providedBy: python3; ensurepip or distro package                                            |
| Ruby                    | `ruby --version`        | ✅          | apt/dnf/yum/brew                                                                            |
| Bundler                 | `bundler --version`     | ✅          | providedBy: ruby; gem install                                                               |
| PHP                     | `php --version`         | ✅          | + composer installation alongside                                                           |
| Composer                | `composer --version`    | ✅          | providedBy: php; installer script or brew                                                   |
| Java                    | `java --version 2>&1`   | ✅          | openjdk-21-jdk per platform                                                                 |
| Maven                   | `mvn -version 2>&1`     | ✅          | Distro package or brew                                                                      |
| Gradle                  | `gradle --version 2>&1` | ✅          | Distro packages lag; ./gradlew wrapper preferred                                            |
| .NET                    | `dotnet --version`      | ✅          | dot.net install.sh or brew                                                                  |
| Elixir                  | `elixir --version 2>&1` | ✅          | erlang + elixir distro packages or brew                                                     |
| npm/cargo/npm/javac/mix | (parent-provided)       | ❌          | Shipped with parent (node/go/java/elixir)                                                   |

**Toolchain Checks** (`src/toolchain/checks.ts` — 187 lines):

- `checkTool(executor, name)` — single tool check with optional minVersion
- `checkTools(executor, names)` — parallel batch check
- `checkToolchain(executor, language)` — resolve required tools from `LANGUAGES[lang].requiredTools`
- `checkToolchainForStack(executor, stackId)` — resolve from `STACKS[stackId].requiredTools` (stacks may override language list, e.g. webmail uses bun not node)
- Version comparison: semantic (`compareVersions`), numeric parts extraction

**Toolchain Installer** (`src/toolchain/installer.ts` — 190 lines):

- `installTool(executor, name)` — resolve environment → get install plan → stream install → fallback commands → start command → verify
- `installTools(executor, names)` — sequential with dependency ordering (parents before children); skips already-healthy tools

#### 6.4c.7 Source Archive & Transfer (`src/archive.ts` — 162 lines)

`prepareSourceTarArgs(localPath, options)` — builds `tar` create args with 3-tier precedence:

1. **Explicit includes** (compiled stacks): pack exactly those paths
2. **Git truth** (`git ls-files -z --cached --others --exclude-standard`): honours .gitignore precisely; tracked `build/` survives, gitignored `dist/` drops. Appends `alsoInclude` paths (e.g. `.next`) on top
3. **No git fallback**: name-based `--exclude` list with root-anchoring for ambiguous names

`getTarCreateEnv()` — sets `COPYFILE_DISABLE=1`, `COPY_EXTENDED_ATTRIBUTES_DISABLE=1` for macOS metadata stripping. `TarTransferOptions` with excludes, includes, alsoInclude. `gitTrackedFiles()` returns null when not in a git work tree.

#### 6.4c.8 Dockerfile Compiler (`src/dockerfile/`)

| Module   | File          | Purpose                                                                                                                                                                                                                           |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser   | `parser.ts`   | Parse Dockerfile AST: FROM, RUN, COPY, CMD, ENTRYPOINT, ENV, EXPOSE, WORKDIR, USER, ARG, VOLUME, LABEL, SHELL, HEALTHCHECK, ONBUILD, STOPSIGNAL; preserves comments and formatting                                                |
| Compiler | `compiler.ts` | Compile runtime config + source into production Dockerfile; ENV injection, port mapping, build args, health checks                                                                                                                |
| Types    | `types.ts`    | Full type system: 16 instruction keywords, WorkspaceBuildPlan, WorkspaceStagePlan, WorkspaceCommand, WorkspaceCopyStep, WorkspaceExposedPort, WorkspacePlanDiagnostic, WorkspaceRuntimePlan, WorkspaceRunStep, WorkspaceStageStep |

#### 6.4c.9 Backup Adapters (`src/backup/`)

Four-axis plug-in architecture, independently extensible:

**Axis 1 — Executors (HOW):**

| Executor | Runtime       | Mechanism                                |
| -------- | ------------- | ---------------------------------------- |
| Docker   | DockerRuntime | Container exec, volume mount, tar stream |
| Cloud    | CloudRuntime  | SSH executor over remote VMs             |
| Bare     | BareRuntime   | Direct SSH/process commands              |

Interface: `listSources()`, `execStream()`, `streamPath()` (tar + compress), `receiveStream()` (extract), `copyVolumeLocal()` (same-daemon), `probeVolume()` (exists/empty check), `pipeIntoCommand()` (stdin pipe to process), `stopService()`/`startService()`/`isRunning()`.

**Axis 2 — Producers (WHAT):**

| Producer       | File                          | Detection                 | Mechanism                                                                                        |
| -------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| pg-dump        | `producers/pg-dump.ts`        | Postgres image match      | libpq-based, custom format + plain SQL fallback, gzip, AES-256-GCM encrypt, FK-ordered catalogue |
| mysql-dump     | `producers/mysql-dump.ts`     | MySQL/MariaDB image match | mysqldump                                                                                        |
| mongo          | `producers/mongo.ts`          | MongoDB image match       | mongodump                                                                                        |
| redis          | `producers/redis.ts`          | Redis image match         | rdb-save (SAVE + copy RDB)                                                                       |
| volume         | `producers/volume.ts`         | Universal fallback (LAST) | tar of Docker volume                                                                             |
| custom-command | `producers/custom-command.ts` | Explicit-only (no detect) | User-defined command                                                                             |

**Axis 3 — Destinations (WHERE):**

| Destination     | File                                 | Mechanism                                        |
| --------------- | ------------------------------------ | ------------------------------------------------ |
| S3-compatible   | `destinations/s3.ts`                 | AWS SDK v3 — supports AWS, R2, Wasabi, B2, MinIO |
| SFTP            | `destinations/sftp.ts`               | SSH2 SFTP with resumable upload                  |
| Local           | `destinations/local.ts`              | Local filesystem                                 |
| hosterax_server | `destinations/sftp.ts` (shared impl) | Via SFTP to managed server                       |

Interface: `preflight()`, `put()`, `get()`, `head()`, `list()`, `delete()`, `deleteMany()`, `presignGet()`, `presignPut()`. Capabilities: streamingPut/Get, multipart, presigned URIs, quota, serverSideCopy.

**Axis 4 — Triggers (WHEN):**
manual, cron (BullMQ or in-process DB-polling), webhook, pre_deploy.

**Backup Infrastructure:**

- Registry: `registerExecutor/Producer/Destination()`, `resolveExecutor/Producer/Destination()`, `resolveProducerForService()`
- Key builder: `artifactKey()`, `manifestKey()`, `runPrefix()` — deterministic paths per project/policy/run
- Manifest: `buildManifest()`, `validateManifest()` — signed with sha256 per artifact
- Credentials: `setBackupCredentialSecret()` — unified S3 (accessKey/secretKey/endpoint/region/bucket), SFTP (host/port/user/key/pass), local (basePath)
- HashingPassthrough: streaming sha256 computation during upload
- Volume transfer: `transferVolume()` — stream-tars Docker volume to destination with on-the-fly compression
- Subgraph dump/restore: FK-closed DB slice in 3 scopes (instance/org/project) for team migration + project transfer

#### 6.4c.10 Native Module Migration Framework (`src/system/modules/`)

Signed, per-module migration catalogs for infra components (OpenResty first). Trust chain: catalog-source → verify → reconcile.

| Module          | File                   | Purpose                                                                                                                                                                                                                                           |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types           | `types.ts` (103 lines) | `ModuleCatalog`, `ModuleVersion`, `ModuleStep` (FileStep/ExecStep), `VerifiedCatalog`, `ApplyTier` (auto/consent)                                                                                                                                 |
| Verify          | `verify.ts`            | Ed25519 signature verification + asset sha256 hash verification before any write/execute                                                                                                                                                          |
| On-box manifest | `on-box-manifest.ts`   | Persistent ledger of applied migrations per module per server                                                                                                                                                                                     |
| Catalog source  | `catalog-source.ts`    | Fetch remote from pinned GitHub ref or load embedded fallback (base64 catalog + detached ed25519 signature)                                                                                                                                       |
| Reconcile       | `reconcile.ts`         | Apply pending migrations: ordered, run-once, tiered (auto runs unattended, consent requires confirmation with warning); content-addressed file steps (sha256 skip); verified exec steps (distro-aware .sh); crash-resume safe via run-once ledger |

**OpenResty Module:** Signed catalog entry for OpenResty 1.1.0 with `resize-rl-counters.sh` asset. Embedded in binary via `scripts/embed-catalog.ts`. Air-gapped instances migrate without network.

#### 6.4c.11 Proxy Import & Migration (`src/system/proxy-import/`)

Scan existing reverse proxy configs and import sites as HosteraX projects:

| Proxy   | File              | Detection                   | Extraction                                          |
| ------- | ----------------- | --------------------------- | --------------------------------------------------- |
| Nginx   | `nginx.ts`        | `/etc/nginx/sites-enabled/` | `server_name`, `proxy_pass`, `root`, SSL cert paths |
| Caddy   | `caddy.ts`        | Caddyfile                   | Site blocks, hostnames, reverse proxy destinations  |
| Apache  | `apache.ts`       | Apache vhost configs        | `ServerName`, `ProxyPass`, `DocumentRoot`           |
| Traefik | (in proxy-import) | Docker labels               | Route extraction from labels                        |
| HAProxy | (in proxy-import) | Config                      | Frontend/backend configuration                      |

Parsing utils (`parse-utils.ts`): shared regex extraction, config normalization, server_name parsing, upstream resolution.

`scanImportableSites()` + `canImportProxy()` — scan and validate existing proxy installations.

#### 6.4c.12 Infra Tests

| Test                   | File                                       | Scope                                                                       |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Nginx test             | `infra/nginx.test.ts`                      | NginxProvider route registration, SSL provisioning, rate limiting           |
| Lua embedded test      | `infra/lua-embedded.test.ts`               | Ensures lua-embedded.ts matches on-disk lua/*.lua sources (drift detection) |
| Environment test       | `system/environment.test.ts`               | OS/distro/package-manager detection                                         |
| Elevated executor test | `system/elevated-executor.test.ts`         | Sudo wrapper behavior                                                       |
| Edge preflight test    | `system/edge-preflight.test.ts`            | Port 80/443 occupant classification                                         |
| Reconcile test         | `system/modules/reconcile.test.ts`         | Migration apply logic                                                       |
| Verify test            | `system/modules/verify.test.ts`            | Signature + hash verification                                               |
| Catalog source test    | `system/modules/catalog-source.test.ts`    | Catalog resolution                                                          |
| Catalog embedded test  | `system/modules/catalog-embedded.test.ts`  | Embedded catalog loading                                                    |
| Available version test | `system/available-version.test.ts`         | Version detection                                                           |
| Remote journal test    | `system/remote-journal.test.ts`            | Exactly-once execution                                                      |
| Reachability test      | `system/reachability.test.ts`              | TCP/HTTP probes                                                             |
| Port listen test       | `system/port-listen.test.ts`               | Port listening detection                                                    |
| Catalog test           | `system/catalog.test.ts`                   | Component catalog                                                           |
| Proxy import test      | `system/proxy-import/proxy-import.test.ts` | Nginx/Caddy/Apache config parsing                                           |
| Volume namespace test  | `runtime/volume-namespace.test.ts`         | Volume name scoping                                                         |
| Chain integration test | `system/modules/chain.integration.test.ts` | End-to-end module migration                                                 |

#### 6.4c.13 Archive & Tar (`src/archive.ts`)

| Feature                  | Details                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Git truth file list      | `git ls-files -z --cached --others --exclude-standard` — honours .gitignore precisely |
| 3-tier tar precedence    | explicit includes > git truth + alsoInclude > name-based exclude fallback             |
| macOS metadata stripping | COPYFILE_DISABLE=1, --no-mac-metadata, --no-xattrs, --no-acls, --no-fflags            |
| Root-anchored excludes   | Ambiguous names (build/dist/data) anchored to archive root (`./name`)                 |
| Temp file cleanup        | mkdtemp for git file lists; cleanup() in finally block                                |
| Transfer verification    | Post-transfer non-empty target check                                                  |

#### 6.4c.14 Key Design Patterns

| Pattern                  | Implementation                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Capability-based runtime | `RuntimeCapability` enum + `supports(cap)` — no silent stubs, clean error on unsupported call |
| Dual-path file ops       | `NginxProvider` uses executor (remote) or node:fs (local) with atomic tmp+mv writes           |
| Self-rollback            | Config snapshotted before write; failed reload restores snapshot and re-reloads               |
| Never-throw degrade      | Lua availability gates vhost directives; geo deps non-fatal; ensureLuaScripts never throws    |
| Stamp-last migrations    | Version marker written AFTER all assets; crash mid-write = stale (re-applied next deploy)     |
| Zero-bleed imports       | Dynamic imports per platform target; Docker deps never loaded for bare/cloud mode             |
| Provision lock           | In-process keyed async-mutex + Postgres advisory lock for server-scoped serialization         |
| Exactly-once remote exec | POSIX `hx-run` wrapper with journal; survives SSH disconnect, re-harvests on reconnect        |

### 6.5 Backup System

| Feature                        | Status | Details                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled backups              | ✅     | Cron expressions (backup FSM: queued→preparing→snapshotting→uploading→verifying→succeeded/failed)                                                                                                                                                                                                                                  |
| Backup destination types       | ✅     | S3-compatible, SFTP, local filesystem                                                                                                                                                                                                                                                                                              |
| Backup targets                 | ✅     | Database dump (via libpq), filesystem archive, per-service scope                                                                                                                                                                                                                                                                   |
| Backup executors               | ✅     | 3 executor implementations: `BareExecutor` (local/SSH), `DockerExecutor` (container volume snapshots), `CloudExecutor` (SSH remote VMs)                                                                                                                                                                                            |
| Backup producers               | ✅     | 7 types: `pg-dump` (custom format + plain SQL fallback), `mysql-dump`, `mongo` (mongodump), `redis` (rdb-save), `volume` (tar of Docker volume), `custom-command` (user-defined), `detect` (auto-select from project type)                                                                                                         |
| Backup manifests               | ✅     | Signed backup manifests (`manifest.json` with sha256 checksums per file, encrypted credentials reference, producer metadata); verified on restore                                                                                                                                                                                  |
| Backup key builder             | ✅     | Deterministic key paths per destination: `{projectId}/{policyId}/{runId}/` with `.backup` suffix for S3/SFTP objects                                                                                                                                                                                                               |
| SHA256 streaming               | ✅     | Streaming hash computation during upload — no full-file buffering; used for manifest checksums                                                                                                                                                                                                                                     |
| Credentials abstraction        | ✅     | Unified `BackupCredentials` type with `resolveConnectionConfig()` — wraps S3 (accessKey/secretKey/endpoint/region/bucket), SFTP (host/port/user/key/pass), and local (basePath); keys are AWS-style env var names                                                                                                                  |
| Volume transfer                | ✅     | `transferVolume` — stream-tars a Docker volume to a destination (compress on-the-fly, pipe to upload); used by volume producer                                                                                                                                                                                                     |
| Retention policies             | ✅     | Automatic cleanup with policy-based retention (count + age, hybrid), dry-run mode                                                                                                                                                                                                                                                  |
| Retention protection           | ✅     | Protect individual runs from pruning with optional expiry date                                                                                                                                                                                                                                                                     |
| One-click restore              | ✅     | From any completed backup run                                                                                                                                                                                                                                                                                                      |
| Two-step restore flow          | ✅     | Prepare (staged, with confirmation token) → Apply (destructive). Fork mode to restore to a different server                                                                                                                                                                                                                        |
| Pre/Post hooks                 | ✅     | Shell commands run before/after each backup on the target server                                                                                                                                                                                                                                                                   |
| Multiple trigger types         | ✅     | Auto (schedule), manual, pre-deploy                                                                                                                                                                                                                                                                                                |
| Backup orchestrator            | ✅     | Dual-backend job runner: BullMQ + Redis (production) — 3 queues (backup-run, backup-schedule, backup-recurring) with exponential backoff and job dedup; in-process DB-polling (dev/desktop) — polls `backup_run` table every 30s with `setImmediate` fast-path, concurrency cap (default 2), cron-parser-based recurring schedules |
| Postgres advisory lock helper  | ✅     | Session-level `pg_advisory_lock` via dedicated pooled connection; FNV-1a 31-bit hash → bigint key                                                                                                                                                                                                                                  |
| Subgraph dump/restore          | ✅     | FK-closed DB slice in 3 scopes: instance/org/project. Drizzle data-only (no DDL). Powers team migration + project transfer                                                                                                                                                                                                         |
| Artifact verification          | ✅     | Post-upload verification step (checksum + size)                                                                                                                                                                                                                                                                                    |
| Destination preflight          | ✅     | Write + read + delete a probe object to verify destination                                                                                                                                                                                                                                                                         |
| Module catalog (embedded)      | ✅     | Offline migration catalog baked into compiled binary as base64 via `scripts/embed-catalog.ts`; includes signed manifest (`catalog.json`), detached ed25519 signature (`catalog.json.sig`), and assets; verified at load time; air-gapped instances migrate without network                                                         |
| OpenResty module               | ✅     | `src/system/modules/catalog/openresty/` — signed catalog entry for OpenResty 1.1.0; includes `resize-rl-counters.sh` asset; embedded in binary                                                                                                                                                                                     |
| **Plugin: pg_dump**            | ✅     | Libpq-based, single-DB or `--all`, gzip compressed, AES-256-GCM encrypted, FK-ordered catalogue                                                                                                                                                                                                                                    |
| **Plugin: filesystem archive** | ✅     | `tar` + gzip of directory, supports exclude patterns, encrypted output                                                                                                                                                                                                                                                             |
| **Plugin: retention executor** | ✅     | Policy: keep N most recent, remove >T days, or hybrid. Dry-run mode                                                                                                                                                                                                                                                                |

### 6.6 Mail Server (Self-hosted)

| Feature                 | Status | Details                                                                 |
| ----------------------- | ------ | ----------------------------------------------------------------------- |
| Full mail server        | ✅     | iRedMail provisioning (Postfix + Dovecot + Amavis + iRedAPD + fail2ban) |
| Webmail                 | ✅     | Zero Email webmail deployment                                           |
| SPF/DKIM/DMARC          | ✅     | Auto-configuration with DNS records                                     |
| DNS auto-configuration  | ✅     | Wizard-driven setup with 8 DNS record types                             |
| Mailbox management      | ✅     | Per-domain mailboxes, aliases, forwardings, quotas                      |
| Domain management       | ✅     | Multi-domain mail hosting                                               |
| Outbound relay          | ✅     | Configurable outbound SMTP relay                                        |
| Mail backup policy      | ✅     | Backup policy for mail server data                                      |
| Mail test email         | ✅     | Send test email functionality                                           |
| Mail component health   | ✅     | Health checks for all mail components                                   |
| Mail server stats       | ✅     | Sending stats, mailbox usage                                            |
| DNS scanning            | ✅     | DNS record verification and scanning                                    |
| Bulk restart            | ✅     | Restart all mail components                                             |
| Reputation monitoring   | ✅     | Sending reputation banner                                               |
| Welcome modal           | ✅     | First-time mail setup walkthrough                                       |
| Setup progress          | ✅     | Step-by-step setup progress tracking                                    |
| Port conflict detection | ✅     | Port usage analysis and resolution                                      |
| Client setup guides     | ✅     | iOS, Android, Desktop (Thunderbird/Outlook), Nodemailer code examples   |

### 6.7 Billing System _(Removed — HosteraX does not provide cloud/SaaS services)_

_The billing system is entirely out of scope. HosteraX does not provide compute, cloud, SaaS, or billing services. The billing code is retained for reference only and is not part of the active HosteraX product:_

| Feature                     | Status | Details                                   |
| --------------------------- | ------ | ----------------------------------------- |
| Multi-tier plans            | ❌     | Not part of HosteraX                      |
| Stripe integration          | ❌     | Not part of HosteraX                      |
| Credit-based usage metering | ❌     | Not part of HosteraX                      |
| Pricing cards               | ❌     | Not part of HosteraX                      |
| Billing usage chart         | ❌     | Not part of HosteraX                      |
| Open Stripe Portal          | ✅     | Direct link to Stripe customer portal     |
| Billing unavailable state   | ✅     | Graceful fallback when billing is offline |
| Org cleanup                 | ✅     | Orphaned org cleanup on billing events    |

### 6.8 One-click Apps Catalog

| Feature                  | Status | Details                                       |
| ------------------------ | ------ | --------------------------------------------- |
| **Convex**               | ✅     | Reactive backend + dashboard                  |
| **n8n**                  | ✅     | Workflow automation (available for install)   |
| **Ghost**                | ✅     | Publishing platform (with MySQL)              |
| **Directus**             | ✅     | Headless CMS                                  |
| **NocoDB**               | ✅     | Airtable-style database UI                    |
| **Metabase**             | ✅     | BI/analytics                                  |
| **Grafana**              | ✅     | Dashboards                                    |
| **Gitea**                | ✅     | Self-hosted Git                               |
| **code-server**          | ✅     | VS Code in browser                            |
| **Uptime Kuma**          | ✅     | Uptime monitoring                             |
| **Vaultwarden**          | ✅     | Password manager                              |
| **FreshRSS**             | ✅     | RSS reader                                    |
| **Stirling PDF**         | ✅     | PDF toolkit                                   |
| **IT-Tools**             | ✅     | Developer utilities                           |
| **Excalidraw**           | ✅     | Whiteboard                                    |
| **Mail**                 | ✅     | HosteraX Mail setup wizard                    |
| **Buzz**                 | 🚧     | Collaboration workspace (coming soon)         |
| Installable from catalog | ✅     | `n8n`, `convex`, `mail` currently installable |

### 6.9 Notification System

| Feature            | Status | Details                                                 |
| ------------------ | ------ | ------------------------------------------------------- |
| Multi-channel      | ✅     | In-app, email, webhook, Slack                           |
| Channel management | ✅     | CRUD for notification channels                          |
| Subscriptions      | ✅     | Per-channel per-user subscriptions                      |
| Defaults           | ✅     | System-wide notification defaults                       |
| Delivery queue     | ✅     | Queue with retry logic                                  |
| Delivery history   | ✅     | Per-delivery status tracking                            |
| Categories         | ✅     | 12 event categories with default enabled/disabled state |

Notification categories (defined in `apps/api/src/lib/notification-categories.ts` — static code registry, no DB round-trip):

| Category ID                  | Label                      | Default     | Description                                                               |
| ---------------------------- | -------------------------- | ----------- | ------------------------------------------------------------------------- |
| `deploy.failed`              | Deploy failed              | ✅ Enabled  | Build/deploy errored out with error message + log snippet                 |
| `deploy.succeeded`           | Deploy succeeded           | ❌ Disabled | Every successful production deploy                                        |
| `deploy.cancelled`           | Deploy cancelled           | ❌ Disabled | In-flight deploy was cancelled                                            |
| `backup.failed`              | Backup failed              | ✅ Enabled  | Backup run errored (includes destination + policy)                        |
| `backup.succeeded`           | Backup succeeded           | ❌ Disabled | Each successful backup                                                    |
| `backup.restore_completed`   | Restore completed          | ✅ Enabled  | Restore finished or failed                                                |
| `job.run.failed`             | Job failed                 | ✅ Enabled  | Job errored out (includes exit code)                                      |
| `job.run.succeeded`          | Job succeeded              | ❌ Disabled | Each successful job run                                                   |
| `job.run.started`            | Job started                | ❌ Disabled | Job began running                                                         |
| `domain.expiring`            | SSL cert expiring          | ✅ Enabled  | Daily check — cert under 7 days left, fires when renewer can't reach host |
| `domain.verification_failed` | Domain verification failed | ✅ Enabled  | DNS check didn't pass during initial domain setup                         |
| `member.added`               | New member joined          | ❌ Disabled | Someone accepted an invite and joined the organization                    |
| `member.removed`             | Member removed             | ❌ Disabled | A member was removed from the organization                                |
| `invitation.sent`            | Invitations sent           | ❌ Disabled | An admin sent invite(s) to new members                                    |
| `billing.alert`              | Billing alert              | ✅ Enabled  | Payment failed, plan limit reached, or invoice overdue                    |
| `quota.warning`              | Quota warning              | ✅ Enabled  | Approaching a plan limit (storage, deployments, members)                  |

### 6.10 System Management (Self-hosted)

| Feature                                                                                      | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSH server management                                                                        | ✅     | Add/remove/list, key/password/agent auth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SSH connection pooling                                                                       | ✅     | Connection reuse with pool management                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SSH port forwarding                                                                          | ✅     | Tunnel management (saved across sessions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Remote command execution                                                                     | ✅     | Reliable remote execution with retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| System component checks                                                                      | ✅     | Docker, Git, OpenResty, certbot version checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Component installer                                                                          | ✅     | Installer for Docker, Git, OpenResty, certbot, rsync                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Toolchain checks                                                                             | ✅     | Per-language tool validation and installation                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Edge detection                                                                               | ✅     | Scans ports 80/443 before OpenResty install; classifies occupants as free/ours/known/unknown                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Edge takeover                                                                                | ✅     | Stops foreign proxy (systemd unit, Docker container, or bare process) → installs OpenResty → re-registers sites → reuses/issues certs → verifies. Full rollback on any failure                                                                                                                                                                                                                                                                                                                                           |
| Edge rollback journal                                                                        | ✅     | On-disk journal (`/var/lib/hosterax/edge-takeover.json`) tracks takeover state; crash recovery via `recoverInterruptedTakeover`                                                                                                                                                                                                                                                                                                                                                                                          |
| EdgePolicy authorization                                                                     | ✅     | User-accepted authorization with explicit stop targets — avoids silent takeovers                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Recognized proxies                                                                           | ✅     | nginx, caddy, apache, traefik, haproxy, openresty (detectable as occupants)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Proxy import (Nginx)                                                                         | ✅     | Scan `/etc/nginx/sites-enabled/` over SSH, parse `server_name`, `proxy_pass`, `root`, SSL cert paths, decompile into HosteraX projects                                                                                                                                                                                                                                                                                                                                                                                   |
| Proxy import (Caddy)                                                                         | ✅     | Scan Caddyfile for site blocks, extract hostnames and reverse proxy destinations                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Proxy import (Apache)                                                                        | ✅     | Scan Apache vhost configs for `ServerName`, `ProxyPass`, `DocumentRoot` directives                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Proxy import (Traefik)                                                                       | ✅     | Detect Traefik containers and Docker labels for route extraction                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Proxy import (HAProxy)                                                                       | ✅     | Detect HAProxy frontend/backend configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Docker migration                                                                             | ✅     | Adopt existing Docker containers as HosteraX services                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Docker migration preflight                                                                   | ✅     | Pre-migration compatibility check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Self-update mechanism                                                                        | ✅     | Update scanning + one-click apply                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Unified update scanner                                                                       | ✅     | Single channel scans ALL entities (git projects, release/dist projects, self-app, webmail, template apps) via `getProjectCommitStatus`; caches result in `update_status` table                                                                                                                                                                                                                                                                                                                                           |
| Drift resolution                                                                             | ✅     | Dispatches per-project by mode: commit (branch/commit SHA comparison), release (version comparison), image (tag comparison)                                                                                                                                                                                                                                                                                                                                                                                              |
| Data transfer                                                                                | ✅     | Whole-instance export/import with passphrase-encrypted secret bundle (scrypt KDF + AES-256-GCM); import modes: wipe (truncate+insert) or merge (onConflictDoNothing for singleton/auth tables); envelope version validation                                                                                                                                                                                                                                                                                              |
| Server migration                                                                             | ✅     | Self-hosted server migration wizard (2 targets: server, tunnel)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Migration preflight                                                                          | ✅     | Read-only readiness check with checklist before deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Migration switch-back                                                                        | ✅     | Reverse migration (team → single-user) with remote-unreachable error handling                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Migration lock                                                                               | ✅     | Prevents concurrent migrations; typed errors for lock-acquire failure, already-in-progress, target-not-empty                                                                                                                                                                                                                                                                                                                                                                                                             |
| Server tunnel management                                                                     | ✅     | Tunnel provision, teardown, agent lifecycle (2 providers: ngrok, Cloudflare)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tunnel agent lifecycle                                                                       | ✅     | Single agent per instance; exponential backoff reconnect (1s–30s) on transient disconnect; cancel on SIGTERM/SIGINT                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tunnel provider interface                                                                    | ✅     | Generic `TunnelProvider` with preflight/create/delete/connect lifecycle; typed error classes per failure mode                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tunnel record                                                                                | ✅     | externalId, slug, publicUrl returned from provider; slug may differ from request (random for ngrok free + CF quick-tunnel)                                                                                                                                                                                                                                                                                                                                                                                               |
| Rate limit settings                                                                          | ✅     | Per-server rate limit configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Named rate limit policies                                                                    | ✅     | 9 policies with per-window limits: default-anon (300/min/IP), default-authed (3000/min/user), auth-tight (10/min/IP), auth-loose (60/min/user), mcp (300/min/IP), read-authed (600/min/user), write-authed (300/min/user), webhook-ingress (120/min/IP), billing-portal (20/min/org) — sliding-window-counter algorithm (weighted blend of current + previous window); dual backend: Redis Lua or in-memory; fail-open on store errors; 4 subject types (ip/user/org/global); backend auto-selected by probing REDIS_URL |
| Credential encryption discriminator                                                          | ✅     | `enc1:` prefix distinguishes AES-256-GCM ciphertext from plaintext; SSE server credentials encrypted at rest, decrypted only at ssh2 handoff; plaintext without prefix returned as-is (backward compat)                                                                                                                                                                                                                                                                                                                  |
| PAT minting format                                                                           | ✅     | `hx_pat_` prefix + 43-char base64url secret (256-bit entropy); SHA-256 hash persisted; 6-char prefix stored for display recognition                                                                                                                                                                                                                                                                                                                                                                                      |
| Dual-path audit emitter                                                                      | ✅     | `audit.record()` (sync/awaited) for security-sensitive events (auth, member, billing); `audit.recordAsync()` (fire-and-forget) for high-volume events (deployments, settings); both swallow errors — audit insert failure never breaks the user action                                                                                                                                                                                                                                                                   |
| Two-layer provision lock                                                                     | ✅     | In-process keyed async-mutex (collapses N waiters into 1) + Postgres session-level advisory lock; per-scope-key serialization; auto-cleanup of idle entries                                                                                                                                                                                                                                                                                                                                                              |
| Startup hook system                                                                          | ✅     | Self-hosted only; feature modules register hooks, `runStartupHooks()` runs once at boot; mode-tagged (selfhosted/desktop); errors caught+logged (non-fatal); current hooks: tunnel autostart, self-adopt reconcile                                                                                                                                                                                                                                                                                                       |
| Rate limit subject types                                                                     | ✅     | ip, user, org, global — per-policy granularity                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rate limit dual backend                                                                      | ✅     | Redis (production) or in-memory (dev/desktop) with auto-detect + env override                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| _(Cloud-only features removed from this section — HosteraX does not provide cloud services)_ |
| Self-app adopt deployment                                                                    | ✅     | HosteraX deploys itself as a first-class "adopt" deployment: health-probes the port, syncs project.port to live dashboard port, but never starts a second process                                                                                                                                                                                                                                                                                                                                                        |
| Boot-time self-healing                                                                       | ✅     | On boot: backfills adopt deployments, re-applies routes, re-issues SSL certs, warms public URL cache, reconciles port drift                                                                                                                                                                                                                                                                                                                                                                                              |
| Server manifest (disaster recovery)                                                          | ✅     | Each server carries `/root/.hosterax/manifest.json` mirroring deployed projects; lost orchestrator can scan and re-adopt — no secrets written                                                                                                                                                                                                                                                                                                                                                                            |
| SSH tunnel multiplexing                                                                      | ✅     | 4 tunnel types over existing SSH connections: raw TCP, HTTP requests, SSE streams, port forwarding                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Desktop tunnel manager                                                                       | ✅     | Persisted tunnel config (`server_tunnels` table); auto-reopened at boot via startup hook; connection retain/release for tunnel lifetime                                                                                                                                                                                                                                                                                                                                                                                  |
| Dual-path audit emitter                                                                      | ✅     | Sync path for security-sensitive events, async path for high-volume audit; two reliability tiers                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Two-layer provision lock                                                                     | ✅     | In-process mutex + Postgres advisory lock for concurrent deploy serialization across replicas                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Three-state remote operations                                                                | ✅     | Present/absent/unreachable distinction — prevents delete-hang (absent vs. unreachable) and false-failure bugs                                                                                                                                                                                                                                                                                                                                                                                                            |
| Per-server GitHub auth                                                                       | ✅     | Credential precedence: server-specific PAT > App token > PAT > relay; deploy key auto-registration via GitHub API                                                                                                                                                                                                                                                                                                                                                                                                        |
| Zero-auth desktop mode                                                                       | ✅     | API trusts 127.0.0.1 traffic without authentication; auto-provisioned admin user                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Route permission enforcement                                                                 | ✅     | Compile-time TypeScript-enforced route classification: every route MUST declare a permission tag or explicit `public`; boot-time scanner exits on misconfigured routes                                                                                                                                                                                                                                                                                                                                                   |
| DNS bypass (DoH resolver)                                                                    | ✅     | Google DNS-over-HTTPS primary, `node:dns` fallback — globally consistent DNS answers independent of host resolver                                                                                                                                                                                                                                                                                                                                                                                                        |
| SSH key path denylist                                                                        | ✅     | Explicit deny of `/etc`, `/proc`, `/sys` paths for SSH key files to prevent credential exfiltration                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Credential encryption discriminator                                                          | ✅     | `"enc1:"` prefix distinguishes encrypted from plaintext without trial-decryption — avoids silent corruption                                                                                                                                                                                                                                                                                                                                                                                                              |
| Post-deploy screenshots                                                                      | ✅     | Optional headless browser screenshot service for deployed sites (Puppeteer/Playwright)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Module updates                                                                               | ✅     | Native module version tracking and updates                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Signed module catalog                                                                        | ✅     | Ed25519-signed migration catalog for infra modules (OpenResty first); pulled from pinned GitHub ref or embedded fallback                                                                                                                                                                                                                                                                                                                                                                                                 |
| Auto vs consent apply tiers                                                                  | ✅     | `auto` steps run unattended (safe/additive); `consent` steps require operator confirmation with warning                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Content-addressed file steps                                                                 | ✅     | Verified by sha256 before writing; skipped when on-box file already matches                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Verified exec steps                                                                          | ✅     | Distro-aware .sh scripts, verified via signature + hash before execution                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Run-once migration ledger                                                                    | ✅     | Per-step ledger ensures each migration runs exactly once; crash-resume safe                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Remote command journaling                                                                    | ✅     | Exactly-once remote execution via POSIX `hx-run` wrapper; survives SSH disconnect, journals stdout/stderr/exit to `<baseDir>/ops/<opId>/`, re-harvests on reconnect instead of re-running                                                                                                                                                                                                                                                                                                                                |
| Setup state persistence                                                                      | ✅     | DB-backed (API) or file-based (FileStateStore) cache of component install status; skips re-checks until explicit re-verify or component failure                                                                                                                                                                                                                                                                                                                                                                          |
| Environment detection                                                                        | ✅     | Probes OS (linux/darwin), arch (amd64/arm64), distro (ubuntu/debian/fedora/rhel/centos/alpine), package manager (apt/dnf/yum/apk/brew), service manager (systemd/launchd), root/sudo capabilities                                                                                                                                                                                                                                                                                                                        |
| Available version tracking                                                                   | ✅     | Package-manager probe for newer git/rsync/openresty/certbot versions; no `apt-get update` needed, uses local index                                                                                                                                                                                                                                                                                                                                                                                                       |
| Remote source transfer                                                                       | ✅     | Resumable rsync (--partial --inplace --append-verify) over OpenSSH; fallback to stall-proof ssh2 SFTP for password auth without sshpass                                                                                                                                                                                                                                                                                                                                                                                  |
| Elevated executor                                                                            | ✅     | `sudo -n sh -c` wrapper for non-root servers with passwordless sudo; only elevates write operations (exec, writeFile, mkdir, rm); reads pass through unprivileged                                                                                                                                                                                                                                                                                                                                                        |
| SystemManager orchestrator                                                                   | ✅     | Full server provisioning: check → install missing → validate → cache. Feature readiness queries with 24h cache TTL. Concurrent-provision serialization via provision lock                                                                                                                                                                                                                                                                                                                                                |
| Runtime mode rules                                                                           | ✅     | Docker mode: build→[git,docker], deploy→[docker], routing→[openresty], ssl→[openresty,certbot]. Bare mode: build→[git], deploy→[stack runtime], same routing/ssl                                                                                                                                                                                                                                                                                                                                                         |
| dpkg lock recovery                                                                           | ✅     | `ensureAptReady`: recovers from interrupted dpkg state before package operations                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Component uninstall support                                                                  | ✅     | Distro-aware removal for rsync, certbot, OpenResty with package-manager mapping (apt/dnf/yum/brew/apk)                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 6.11 Scheduling & Jobs

| Feature             | Status | Details                                                                                                                                                                                                                                                               |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled jobs      | ✅     | CRON, one-time, and manual trigger jobs                                                                                                                                                                                                                               |
| Job run history     | ✅     | Per-run status, logs, duration                                                                                                                                                                                                                                        |
| Job triggers        | ✅     | CRON expression, event-based, webhook                                                                                                                                                                                                                                 |
| Job actions         | ✅     | API call, webhook, deploy, backup, custom command                                                                                                                                                                                                                     |
| Notification config | ✅     | Per-job notification on success/failure                                                                                                                                                                                                                               |
| Retry policy        | ✅     | Configurable retry count and delay                                                                                                                                                                                                                                    |
| Live job output     | ✅     | SSE streaming for running jobs                                                                                                                                                                                                                                        |
| System jobs         | ✅     | 9 built-in jobs: SSL renewal (cron 03:17 daily), orphan sweep, backup retention prune, audit event prune, deployment reconcile sweep, pending domain verification, instance update scan, module scan, due-once dispatch. All operator-tunable via Jobs UI             |
| Custom jobs         | ✅     | User-created command jobs; cron/recurring/manual/one-time schedule; retry up to 10x with backoff; env vars + encrypted secrets; multi-server fan-out; dependency chaining; 7 event triggers; per-job notification overrides; max 10k char command, 200k stored output |

### 6.12 GitHub Integration

| Feature                | Status | Details                                 |
| ---------------------- | ------ | --------------------------------------- |
| GitHub App integration | ✅     | Installation, webhooks, OAuth flow      |
| Push webhook           | ✅     | Auto-deploy on git push                 |
| PR webhook             | ✅     | Preview deployments for PRs             |
| Check run webhook      | ✅     | GitHub Actions check-run integration    |
| File change detection  | ✅     | `changed-files` webhook processing      |
| Source resolution      | ✅     | app/gh-cli/local source detection       |
| GitHub OAuth login     | ✅     | OAuth-based authentication              |
| GitHub device flow     | ✅     | CLI device authorization flow           |
| Server GitHub connect  | ✅     | Per-server GitHub App authentication    |
| GitHub deploy keys     | ✅     | Deploy key management per server        |
| Webhook event pruning  | ✅     | Automatic cleanup of old webhook events |

### 6.13 Docker Integration

| Feature                       | Status | Details                                                                 |
| ----------------------------- | ------ | ----------------------------------------------------------------------- |
| Docker runtime adapter        | ✅     | Full container lifecycle (build, deploy, stop, start, restart, destroy) |
| Dockerfile parser             | ✅     | Parse, compile, and generate workspace build plans                      |
| Docker Compose support        | ✅     | Multi-service compose deployments (group deploy + rollback)             |
| Image catalog browsing        | ✅     | Browse available Docker images                                          |
| Docker adoption               | ✅     | Import existing containers as HosteraX services                         |
| Container health checks       | ✅     | Health check integration                                                |
| Container resource limits     | ✅     | CPU/memory limits per container                                         |
| Container restart policy      | ✅     | Configurable restart behavior                                           |
| Docker network management     | ✅     | Network context (networkId/name)                                        |
| Docker connection: local      | ✅     | Local Docker socket (zero config, default)                              |
| Docker connection: SSH tunnel | ✅     | Remote Docker over SSH with streamlocal forwarding                      |
| Docker connection: TCP + mTLS | ✅     | Remote Docker over TCP with mutual TLS authentication                   |
| Host fingerprint pinning      | ✅     | TOFU (trust-on-first-use) or strict pinned fingerprints                 |
| Container exec terminal       | ✅     | WebSocket-based shell exec into running containers                      |
| Container summary + detail    | ✅     | List all containers with status + detailed inspect                      |
| Drift detection               | ✅     | Compose spec vs running state comparison                                |

### 6.14 Workspace & Metadata Support

| Feature                                                        | Status | Details                                                            |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| Vercel config import                                           | ✅     | Parse `vercel.json` for build config, rewrites, redirects, headers |
| Render config import                                           | ✅     | Parse `render.yaml` for start/build commands and env vars          |
| Stack detection: Next.js                                       | ✅     | `next.config.js`, `package.json` detection                         |
| Stack detection: Nuxt                                          | ✅     | `nuxt.config.*` detection                                          |
| Stack detection: SvelteKit                                     | ✅     | `svelte.config.js` detection                                       |
| Stack detection: Remix                                         | ✅     | `remix.config.*` detection                                         |
| Stack detection: Astro                                         | ✅     | `astro.config.*` detection                                         |
| Stack detection: Vite                                          | ✅     | `vite.config.*` detection                                          |
| Stack detection: Angular                                       | ✅     | `angular.json` detection                                           |
| Stack detection: Gatsby                                        | ✅     | `gatsby-config.*` detection                                        |
| Stack detection: CRA                                           | ✅     | `react-scripts` detection                                          |
| Stack detection: Vue                                           | ✅     | `vue.config.*` detection                                           |
| Stack detection: Express/Fastify/Hono/NestJS/Koa/Adonis/Elysia | ✅     | Package-level detection                                            |
| Stack detection: Go/Gin/Fiber/Echo                             | ✅     | `go.mod` + framework imports                                       |
| Stack detection: Rust/Actix/Axum/Rocket                        | ✅     | `Cargo.toml` + crate detection                                     |
| Stack detection: Python/Django/Flask/FastAPI                   | ✅     | Pipfile, requirements.txt, pyproject.toml                          |
| Stack detection: Ruby/Rails/Sinatra                            | ✅     | Gemfile detection                                                  |
| Stack detection: PHP/Laravel/Symfony                           | ✅     | composer.json detection                                            |
| Stack detection: Java/Spring Boot/Quarkus/Kotlin               | ✅     | Maven/Gradle + properties                                          |
| Stack detection: C#/.NET/Blazor                                | ✅     | `.csproj`/`.sln` detection                                         |
| Stack detection: Elixir/Phoenix                                | ✅     | `mix.exs` detection                                                |
| Stack detection: Docker                                        | ✅     | Dockerfile detection                                               |
| Stack icons                                                    | ✅     | DevIcon CDN icons for all 42 stacks                                |
| Port detection                                                 | ✅     | Contextual port detection per language                             |
| Dependency analysis                                            | ✅     | Parse manifests into dependency maps                               |
| Build output transfer excludes                                 | ✅     | 14 default excludes + stack-aware exclusions                       |

### 6.15 SSH & Remote Management

| Feature                    | Status | Details                                                                                                                                                                                                                           |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH connection management  | ✅     | Connection pooling, cleanup, disconnect subscriber pattern                                                                                                                                                                        |
| SSH key generation         | ✅     | RSA key pair generation for onboarding                                                                                                                                                                                            |
| SSH password auth          | ✅     | Password-based authentication                                                                                                                                                                                                     |
| SSH agent forwarding       | ✅     | Agent-based authentication                                                                                                                                                                                                        |
| SFTP file operations       | ✅     | File transfer over SSH                                                                                                                                                                                                            |
| SFTP resumable upload      | ✅     | Multi-attempt SFTP with resume-from-offset; stall detection (30s) and progress callbacks (2.5s intervals)                                                                                                                         |
| SSH executor (ssh2)        | ✅     | Remote command execution via `ssh2` with transport-aware abort, raw exec, PTY shell, Unix socket forward, port forward, reverse tunnel, retry on channel-open failure                                                             |
| System SSH executor        | ✅     | OpenSSH binary with ControlMaster multiplexing (`ssh -fN`); PTY shell with remote `stty` resize + marker file; `pipeLocal` for local→remote pipe; `fireAndForget` best-effort commands; `forwardUnixSocket` with auto-reestablish |
| Reverse tunnel             | ✅     | Dynamic loopback listener → `ssh -O forward -R` allocates remote port; used for git-credential relay                                                                                                                              |
| Remote journal             | ✅     | Reliable command execution with journal and retry                                                                                                                                                                                 |
| Port forwarding            | ✅     | Local/remote port forwarding tunnels (-W mode for system-ssh, forwardPort for ssh2)                                                                                                                                               |
| Server reachability        | ✅     | TCP liveness probe (raw socket, 2.5s timeout) + HTTP probe (configurable status threshold)                                                                                                                                        |
| Known hosts reconciliation | ✅     | Parses `~/.ssh/known_hosts`, integrates with host-verifier                                                                                                                                                                        |
| Static output probe        | ✅     | In-instance check for deployment output directory and servable index.html                                                                                                                                                         |

### 6.16 Dependency Detection Capabilities

| Language              | Manifest Files                                                                                                                                     | Package Managers     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| JavaScript/TypeScript | `package.json`, `bun.lock`, `yarn.lock`, `pnpm-lock.yaml`, `package-lock.json`                                                                     | npm, yarn, pnpm, bun |
| Python                | `requirements.txt`, `pyproject.toml`, `Pipfile`, `Pipfile.lock`, `uv.lock`                                                                         | pip, uv, poetry      |
| Go                    | `go.mod`, `go.sum`, `go.work`                                                                                                                      | go                   |
| Rust                  | `Cargo.toml`, `Cargo.lock`                                                                                                                         | cargo                |
| Ruby                  | `Gemfile`, `Gemfile.lock`                                                                                                                          | bundler              |
| PHP                   | `composer.json`, `composer.lock`                                                                                                                   | composer             |
| Java                  | `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `gradle-wrapper.properties`, `.sln`, `.csproj`, `gradlew` | maven, gradle        |
| Elixir                | `mix.exs`                                                                                                                                          | mix                  |

### 6.17 Desktop App Features

| Feature                           | Status | Details                                                                                                                                                                                                                                                        |
| --------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 40 shell                 | ✅     | BrowserWindow management                                                                                                                                                                                                                                       |
| Dynamic free port allocation      | ✅     | Never conflicts with fixed ports; persisted across restarts for stable session cookies                                                                                                                                                                         |
| Auto-start on boot                | ✅     | Via `hosteraX up` command                                                                                                                                                                                                                                      |
| Self-contained bundling           | ✅     | Bundled hosteraX-api binary (bun --compile), Next.js dashboard standalone, PGlite embedded DB, SQL migrations                                                                                                                                                  |
| Zero external dependencies        | ✅     | No external Postgres needed (PGlite); no Redis (in-process job runner); no separate Node.js (ELECTRON_RUN_AS_NODE)                                                                                                                                             |
| Loopback-only binding             | ✅     | API binds 127.0.0.1 only (zero-auth mode, no LAN exposure)                                                                                                                                                                                                     |
| Auth secret persistence           | ✅     | BETTER_AUTH_SECRET generated once, persisted in userData — sessions survive restarts                                                                                                                                                                           |
| Dashboard launch                  | ✅     | `utilityProcess.fork` (preferred, no Dock tile) → fallback `ELECTRON_RUN_AS_NODE` spawn                                                                                                                                                                        |
| Graceful shutdown                 | ✅     | SIGTERM → 4s → SIGKILL; awaits PGlite lock release before auto-update handoff                                                                                                                                                                                  |
| Auto-update                       | ✅     | GitHub releases with advisory support                                                                                                                                                                                                                          |
| Update progress window            | ✅     | Visual update progress UI                                                                                                                                                                                                                                      |
| Onboarding flow                   | ✅     | `@repo/onboarding` — 6-step wizard logic as a standalone 300-line package                                                                                                                                                                                      |
| — Step definitions                | ✅     | 6 steps with titles+subtitles: choose ("Get Started"), selfhost-choice ("Where should HosteraX run?"), ssh ("Connect to your server"), tunnel ("Internet Access"), preferences ("Build Preferences"), loading ("Connecting…")                                  |
| — Branching navigation            | ✅     | `nextStep()` / `prevStep()` — fully state-driven: choose→cloud→loading; selfhost→local→tunnel; selfhost→remote→SSH; private IP→tunnel→preferences→loading; public IP→preferences→loading; edge tunnel→loading directly                                         |
| — SSH validation                  | ✅     | `validateServerAddress(ip)` — hostname/IP regex; `validateSshPayload(payload)` — checks host, method-dependent fields (password/key); `isPrivateIp(ip)` — detects RFC1918, loopback, link-local, ULA                                                           |
| — SSH payload builder             | ✅     | `buildSshSettings(payload: SshPayload): SystemSettings` — normalizes user SSH input (host, port default 22, user default root, method, password, keyPath, passphrase, jumpHost, sshArgs)                                                                       |
| — API client                      | ✅     | `buildSetupPayload()` — converts SystemSettings+TunnelConfig+buildMode+authMode→`SetupPayload`; `pushInstanceSettings()` — POSTs to `/api/system/setup` with 10s timeout, returns boolean; `waitForApi()` — polls `/api/health` up to 30 times at 1s intervals |
| — Platform adapter                | ✅     | `OnboardingPlatform` interface: `openExternal(url)`, `browseFile()`, custom `fetch` — implemented per host (Electron, CLI)                                                                                                                                     |
| — State model                     | ✅     | `OnboardingState` — path (cloud/selfhost), hostingMode (remote/local), ssh (SshPayload), tunnel (TunnelConfig), buildMode (auto/server/local), apiUrl, dashboardUrl                                                                                            |
| — Types                           | ✅     | `OnboardingPath` (cloud                                                                                                                                                                                                                                        | selfhost), `HostingMode` (remote | local), `OnboardingStep` (6-step union), `SshPayload` (host,user,method,password,keyPath,passphrase,port,jumpHost,sshArgs), `TunnelConfig` (provider: edge | cloudflare | ngrok, token), `SystemSettings` (normalized API shape), `SetupPayload` (API wire format) |
| Tunnel config                     | ✅     | Provider selection: ngrok, Cloudflare                                                                                                                                                                                                                          |
| Git credential relay              | ✅     | SSH reverse tunnel git credential forwarding — relays operator's local `gh` identity to remote server WITHOUT persisting any credential; nonce-gated, host-pinned to github.com, repo-pinned, per-relay rate limited (30/min)                                  |
| Relay security model              | ✅     | Ephemeral 0700 bash script at `~/.hosterax/cred-<session>.sh`; in-process ssh2 channels or system-ssh ControlMaster `-O forward -R`                                                                                                                            |
| Server GitHub auth precedence     | ✅     | Server-specific credential > App installation token > PAT > relay — stored encrypted at rest with `enc1:` prefix discriminator                                                                                                                                 |
| macOS code signing + notarization | ✅     | Developer ID signing + notarization (entitlements: `entitlements.mac.plist`, `entitlements.daemon.plist`)                                                                                                                                                      |
| Cross-platform builds             | ✅     | Windows .zip, macOS .dmg (arm64 + x64), Linux .AppImage                                                                                                                                                                                                        |
| IPC bridge                        | ✅     | Context bridge exposing `window.desktop` API                                                                                                                                                                                                                   |
| Crash reporting                   | ✅     | Basic crash handler                                                                                                                                                                                                                                            |
| OAuth popup bridge                | ✅     | Desktop IPC for OAuth popup auth                                                                                                                                                                                                                               |
| Stage script                      | ✅     | `build/stage.ts` — compiles API binary, stages dashboard, bundles PGlite + migrations                                                                                                                                                                          |
| Bundle script                     | ✅     | `build/bundle.mjs` — esbuild bundler for main + preload scripts                                                                                                                                                                                                |

### 6.18 CLI Features

| Feature            | Status | Details                                         |
| ------------------ | ------ | ----------------------------------------------- |
| Full CLI suite     | ✅     | 27 command modules                              |
| Setup wizard       | ✅     | Interactive first-run experience                |
| Service management | ✅     | `hosteraX up/stop/status` for daemon management |
| Project management | ✅     | `hosteraX init/deploy/project/service`          |
| Domain management  | ✅     | `hosteraX domain`                               |
| Server management  | ✅     | `hosteraX server`                               |
| System management  | ✅     | `hosteraX system`                               |
| Mail management    | ✅     | `hosteraX mail`                                 |
| Backup management  | ✅     | `hosteraX backup`                               |
| Token management   | ✅     | `hosteraX token`                                |
| Login/logout       | ✅     | `hosteraX login/logout`                         |
| Logs               | ✅     | `hosteraX logs` with streaming                  |
| Doctor             | ✅     | `hosteraX doctor` for diagnostics               |
| Update self        | ✅     | `hosteraX update` for CLI + server updates      |
| Install desktop    | ✅     | `hosteraX install` to download desktop app      |
| API client         | ✅     | `hosteraX api` for raw HTTP calls               |
| Cache management   | ✅     | `hosteraX cache` subcommand                     |
| Reset admin        | ✅     | `hosteraX reset-admin` for password recovery    |
| Sparse checkout    | ✅     | Deploy from specific subdirectory               |
| Folder deploy      | ✅     | Deploy from local filesystem                    |
| Deploy stream      | ✅     | Real-time deployment log output                 |
| Config file        | ✅     | `hosteraX.json` linking config                  |
| Dashboard launch   | ✅     | `hosteraX open` to launch dashboard             |
| GitHub releases    | ✅     | Release asset resolution for self-update        |

### 6.19 Connectivity & Error Handling

| Feature                     | Status | Details                                                                                                                                                      |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connectivity classification | ✅     | 8 result codes: reachable, unreachable, auth_failed, permission_denied, timeout, protocol_error, misconfigured, unknown                                      |
| Error taxonomy              | ✅     | 7 error classes: AppError, NotFoundError (404), UnauthorizedError (401), ForbiddenError (403), ValidationError (400), ConflictError (409), DeployError (500) |
| Safe error messages         | ✅     | 2000-char limit, credential leak prevention                                                                                                                  |
| Query limit/pagination      | ✅     | Configurable pagination defaults                                                                                                                             |
| SSH disconnected error      | ✅     | Typed `SshDisconnectedError` with transport-drop detection and in-flight op abort                                                                            |
| SSH auth error detection    | ✅     | Pattern matching for "All configured authentication methods failed"                                                                                          |
| Retryable connection errors | ✅     | 15+ patterns: ECONNRESET, ECONNREFUSED, ETIMEDOUT, EHOSTUNREACH, "Channel open failure", "open failed", etc.                                                 |
| Docker not-found detection  | ✅     | `isRuntimeNotFoundError`: detects Docker 404 and "no such container/image/volume/network" for idempotent cleanup                                             |
| Debug logging toggle        | ✅     | `SYSTEM_DEBUG_LOGS` env var (1/true/yes/on/debug) with scoped tracing                                                                                        |

### 6.20 Security Features

| Feature                  | Status | Details                                                      |
| ------------------------ | ------ | ------------------------------------------------------------ |
| Better Auth integration  | ✅     | Email/password, OAuth (GitHub, Google), email OTP, MCP OAuth |
| Organization auth        | ✅     | Better Auth org plugin (multi-tenant)                        |
| Role-based access        | ✅     | Owner, admin, member roles                                   |
| Resource grants          | ✅     | Fine-grained permission grants per resource type             |
| Personal access tokens   | ✅     | Scoped tokens with resource-level grants                     |
| Internal auth token      | ✅     | Service-to-service authentication                            |
| Rate limiting            | ✅     | 9 named rate limit policies                                  |
| CORS/CSRF protection     | ✅     | Origin guard middleware                                      |
| Loopback peer protection | ✅     | Loopback origin validation                                   |
| Audit trail              | ✅     | Full event audit log with retention                          |
| Encrypted env vars       | ✅     | Environment values encrypted at rest                         |
| SSL auto-config          | ✅     | Let's Encrypt auto-provisioning + renewal                    |
| DNS verification         | ✅     | Domain ownership TXT verification                            |
| IP/country banning       | ✅     | Per-route access control rules                               |
| Hotlink protection       | ✅     | Referrer-based hotlink blocking                              |
| Input validation         | ✅     | Zod schemas, max string lengths, port ranges                 |

### 6.21 Internationalization

| Feature                | Status | Details                                                                                                                                                                                                                                          |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supported locales      | ✅     | English (en), Arabic (ar), German (de), Spanish (es), French (fr), Japanese (ja), Portuguese (pt), Chinese (zh)                                                                                                                                  |
| Translation namespaces | ✅     | 23 namespace files: auth, billing, brand, chrome, dashboard, deploy, deployments, emails, emailsAdmin, importProject, jobs, library, migration, misc, onboarding, overview, projectDetail, projectSettings, projects, servers, settings, widgets |
| RTL support            | ✅     | Arabic language direction detection                                                                                                                                                                                                              |
| Dynamic loading        | ✅     | Lazy-loaded dictionary with webpack context                                                                                                                                                                                                      |
| Deep merge             | ✅     | Locale override merging                                                                                                                                                                                                                          |
| Language switcher      | ✅     | UI component in sidebar                                                                                                                                                                                                                          |

### 6.22 Platform Abstraction Layer — Adapters Architecture Summary

The `@repo/adapters` package is HosteraX's unified abstraction for deploying to any target. It composes **4 layers** (Runtime, Infra, System, Toolchain) + supporting subsystems (Dockerfile compiler, backup adapters, proxy import, archive, native module migration). All code lives in the same codebase; `createPlatform()` resolves the right combination at startup via dynamic imports (zero-bleed: unused deps never loaded).

#### Runtime Layer (`src/runtime/`)

| Class                   | File                            | Mechanism                                            | Key Features                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DockerRuntime**       | `runtime/docker.ts`             | dockerode over local socket, SSH tunnel, or TCP+mTLS | Full container lifecycle; Docker Compose multi-service; label-based querying; health checks; resource limits; restart policy; network management; remote Docker over SSH with streamlocal forwarding; host fingerprint pinning (TOFU or strict) |
| **BareRuntime**         | `runtime/bare.ts`               | Child processes via CommandExecutor                  | Capistrano-style release dir symlink swap; `--link-dest` hard-link optimization; process adoption; PID tracking; process group kill (setsid)                                                                                                    |
| **CloudRuntime**        | `runtime/cloud.ts`              | SSH executor over remote VMs                         | Remote VM lifecycle; cloud admin proxy for static pages; SSH-based management                                                                                                                                                                   |
| **Process Supervision** | `runtime/supervisor/`           | systemd (271 lines) or nohup (256 lines)             | `systemd`: Type=exec unit files, journalctl logs, auto-restart, reboot survival. `nohup`: setsid process groups, PID files, graceful→SIGKILL shutdown. Auto-detected via `detectSupervisor`                                                     |
| **BuildPipeline**       | `runtime/build-pipeline.ts`     | BuildLogger + BuildEnvironment                       | 5-step FSM (prepare→clone→install→build→deploy); SSE log streaming; ring buffer + replay; step lifecycle events                                                                                                                                 |
| **DeployPipeline**      | `runtime/deploy-pipeline.ts`    | Pre-flight checks → deploy                           | Resource validation; service readiness ordering; port conflict prompts                                                                                                                                                                          |
| **Source Transfer**     | `runtime/transfer.ts`           | Tar pipe via executor                                | 3-tier include precedence (explicit > git ls-files > name-based exclude); macOS metadata stripping; transfer verification                                                                                                                       |
| **Volume Namespace**    | `runtime/volume-namespace.ts`   | String prefixing (pure, zero deps)                   | Project-scoped Docker volume naming (`hosterax-{slug}-{name}`) to prevent cross-project data corruption                                                                                                                                         |
| **Port Conflict**       | `runtime/port-conflict.ts`      | Process listener probe                               | `probeListeningPort()` + `ensurePortAvailable()` — detect and resolve port occupants                                                                                                                                                            |
| **Dockerfile Paths**    | `runtime/docker-paths.ts`       | File resolution                                      | `resolveDockerfileCandidates()` — find Dockerfile in build context                                                                                                                                                                              |
| **Route Registration**  | `runtime/route-registration.ts` | Atomic route table replace                           | Per-deployment ordered route rule replacement; scoped for rollback safety                                                                                                                                                                       |

#### Infrastructure Layer (`src/infra/`)

| Provider                      | File                                  | Mechanism                                       | Key Features                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NginxProvider** (OpenResty) | `infra/nginx.ts` (808 lines)          | Writes OpenResty server blocks, graceful reload | Proxy/static routes; ACME challenge location; HTTP→HTTPS redirect; Lua integration (log_by_lua + access_by_lua); webhook proxy; atomic config writes (tmp+mv); pre-write snapshot → validate → rollback on failed reload; route state sidecar; rate limiting (geo whitelist, limit_req_zone, burst, 429 status); self-rollback |
| **OpenResty Lua System**      | `infra/openresty-lua.ts` (576 lines)  | 8 Lua scripts deployed as base64 constants      | Path detection; Lua scripts for analytics, logging, streaming, rules enforcement, geo-IP, webhooks; shared-dict zones (analytics 256MB, request_data 128MB, rules 32MB, rl_counters 16MB); management port 127.0.0.1:9145; embedded codegen via `scripts/embed-lua.ts`; self-healing `ensureLuaScripts()`                      |
| **Vercel Routing Compiler**   | `infra/vercel-routing.ts` (159 lines) | Pure function, no I/O                           | Compiles vercel.json rewrites/redirects/headers/cleanUrls/trailingSlash to OpenResty locations; security guards prevent nginx config injection                                                                                                                                                                                 |
| **CloudInfraProvider**        | `infra/cloud.ts`                      | SSH executor over remote VMs                    | Routing + SSL on cloud VMs; remote Nginx/certbot management                                                                                                                                                                                                                                                                    |
| **NoopInfraProvider**         | `infra/noop.ts`                       | Silent no-op                                    | Desktop/dev — all methods no-op                                                                                                                                                                                                                                                                                                |

#### System Layer (`src/system/`)

| Module                   | File(s)                       | Purpose                                                                                                                                                               |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SystemManager**        | `system/setup.ts` (569 lines) | Orchestrates server provisioning: checkAll/checkFeature/requireFeature/ensureFeature/setup/verify/invalidate; cached state with 24h TTL; provision lock serialization |
| **Component Checks**     | `system/checks.ts`            | Batch parallel checks: checkDocker, checkGit, checkOpenResty, checkCertbot                                                                                            |
| **Component Installers** | `system/installer.ts`         | Registered installers + uninstallers for docker, git, openresty, certbot, rsync; distro-aware (apt/dnf/yum/brew/apk); stream install → verify                         |
| **System Catalog**       | `system/catalog.ts`           | Hardcoded install recipes per component per OS/distro/package-manager                                                                                                 |
| **Edge Preflight**       | `system/edge-preflight.ts`    | Scan ports 80/443; classify occupants (free/ours/known/unknown); identify proxy kind; resolve stop targets                                                            |
| **Edge Takeover**        | `system/edge-takeover.ts`     | Stop foreign proxy → install OpenResty → re-register sites → re-use/issue certs → verify; full rollback; crash recovery via on-disk journal                           |
| **Environment**          | `system/environment.ts`       | Probe OS, arch, distro, package-manager, service-manager                                                                                                              |
| **State Store**          | `system/state.ts`             | SetupStateStore interface + FileStateStore (file-based) implementation                                                                                                |
| **Reachability**         | `system/reachability.ts`      | TCP/HTTP probes; waitForReady                                                                                                                                         |
| **Port Listen**          | `system/port-listen.ts`       | Parse `/proc/net/tcp*`; probe/wait for port listening                                                                                                                 |
| **Output Exists**        | `system/output-exists.ts`     | Check if build output directory exists                                                                                                                                |
| **Reverse Tunnel**       | `system/reverse-tunnel.ts`    | Dynamic loopback → `ssh -O forward -R` for git-credential relay                                                                                                       |
| **Remote Transfer**      | `system/remote-transfer.ts`   | Resumable rsync (`--partial --inplace --append-verify`); SFTP fallback                                                                                                |
| **Remote Journal**       | `system/remote-journal.ts`    | Exactly-once remote exec via POSIX `hx-run` wrapper; survives SSH disconnect; journals to `<baseDir>/ops/<opId>/`                                                     |
| **SSH Client**           | `system/ssh-client.ts`        | SSH connection management with pooling                                                                                                                                |
| **SSH Support**          | `system/ssh-support.ts`       | SSH key generation, known_hosts management                                                                                                                            |
| **Debug**                | `system/debug.ts`             | `systemDebug()` + `formatDuration()` — structured debug logging                                                                                                       |
| **Errors**               | `system/errors.ts`            | Typed error detection: isRemoteConnectionError, isRetryable*, isSshAuthError, isRuntimeNotFoundError, isSshDisconnectedError                                          |
| **Components**           | `system/components.ts`        | SYSTEM_COMPONENTS registry; getSystemComponentDefinition                                                                                                              |
| **System SSH**           | `system/system-ssh.ts`        | OpenSSH binary helper with ControlMaster support                                                                                                                      |
| **Elevated Executor**    | `system/elevated-executor.ts` | `sudo -n sh -c` wrapper for non-root servers; elevates only write operations                                                                                          |
| **Available Version**    | `system/available-version.ts` | Package-manager probe for newer versions without `apt-get update`                                                                                                     |

#### Executor Layer (`src/system/executor.ts` sub-modules)

| Executor              | Transport                        | Use Case                                                                                                                                                                                 |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LocalExecutor**     | `node:child_process` + `node:fs` | Same-machine operations; streamExec uses detached spawn (process group leader); cp -a transfer with include/exclude filtering                                                            |
| **SshExecutor**       | `ssh2` library                   | Remote commands with key/password auth; rawExec with byte-stream; forwardUnixSocket; forwardPort; openShell PTY; reverseForward tunnel; resumable SFTP upload; transport-drop subscriber |
| **SystemSshExecutor** | OS `ssh` binary + ControlMaster  | Agent auth; SSH jump host; ControlMaster multiplexing (`ssh -fN`); PTY shell with remote stty resize; fireAndForget commands; StreamLocal forward with auto-reestablish                  |
| **createExecutor()**  | Factory                          | If no SSH config → LocalExecutor; `useSystemSsh` flag → SystemSshExecutor over SshExecutor                                                                                               |

#### Toolchain Layer (`src/toolchain/`)

| Module                  | File(s)                              | Purpose                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Toolchain Catalog**   | `toolchain/catalog.ts` (536 lines)   | Check recipes + install plans for 16 tools: Node.js (pinned to NodeSource node_22.x), Bun (v1.2.0), Go, Rust, Python 3, pip, Ruby, Bundler, PHP, Composer, Java (openjdk-21), Maven, Gradle, .NET, Elixir, npm/cargo/javac/mix (parent-provided) |
| **Toolchain Checks**    | `toolchain/checks.ts` (187 lines)    | `checkTool()` single, `checkTools()` batch, `checkToolchain()` by language, `checkToolchainForStack()` by stack; semantic version comparison                                                                                                     |
| **Toolchain Installer** | `toolchain/installer.ts` (190 lines) | `installTool()` with environment resolution → install plan → stream install → fallback → start → verify; sequential with dependency ordering                                                                                                     |

#### Dockerfile Compiler (`src/dockerfile/`)

| Module       | File                     | Purpose                                                                                                                                            |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parser**   | `dockerfile/parser.ts`   | Parse Dockerfile AST (16 instruction keywords); preserves comments and formatting                                                                  |
| **Compiler** | `dockerfile/compiler.ts` | Compile runtime config + source into production Dockerfile; ENV injection, port mapping, build args, health checks                                 |
| **Types**    | `dockerfile/types.ts`    | Full type system: WorkspaceBuildPlan, WorkspaceStagePlan, WorkspaceCommand, WorkspaceCopyStep, WorkspaceExposedPort, WorkspacePlanDiagnostic, etc. |

#### Backup Adapters (`src/backup/`)

| Axis                     | Components                                                                                                                                                                                                             | Files                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Executors (HOW)**      | DockerExecutor (DockerRuntime), CloudExecutor (CloudRuntime), BareExecutor (BareRuntime)                                                                                                                               | `registry.ts`                                                                                                  |
| **Producers (WHAT)**     | pg-dump (libpq, gzip, AES-256-GCM, FK-ordered), mysql-dump, mongo (mongodump), redis (rdb-save), volume (tar), custom-command (user-defined), detect (auto-select)                                                     | `producers/pg-dump.ts`, `mysql-dump.ts`, `mongo.ts`, `redis.ts`, `volume.ts`, `custom-command.ts`, `detect.ts` |
| **Destinations (WHERE)** | S3-compatible (AWS SDK v3 — AWS, R2, Wasabi, B2, MinIO), SFTP (ssh2 resumable), Local                                                                                                                                  | `destinations/s3.ts`, `sftp.ts`, `local.ts`                                                                    |
| **Triggers (WHEN)**      | Manual, cron (BullMQ or in-process DB-polling), webhook, pre_deploy                                                                                                                                                    | `registry.ts`                                                                                                  |
| **Infrastructure**       | `registry.ts` (register/resolve), `volume-transfer.ts` (stream-tar), manifest builder/validator, HashingPassthrough (streaming sha256), credential abstraction, subgraph dump/restore (3 scopes: instance/org/project) | `registry.ts`, `volume-transfer.ts`                                                                            |

#### Native Module Migration Framework (`src/system/modules/`)

| Module               | File                   | Purpose                                                                                                                                     |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Types**            | `types.ts` (103 lines) | ModuleCatalog, ModuleVersion, ModuleStep (FileStep/ExecStep), VerifiedCatalog, ApplyTier (auto/consent)                                     |
| **Verify**           | `verify.ts`            | Ed25519 signature + sha256 hash verification before any write/execute                                                                       |
| **On-box manifest**  | `on-box-manifest.ts`   | Persistent ledger of applied migrations per module per server                                                                               |
| **Catalog source**   | `catalog-source.ts`    | Fetch remote from pinned GitHub ref or load embedded fallback (base64 + detached ed25519 signature)                                         |
| **Reconcile**        | `reconcile.ts`         | Apply pending migrations: ordered, run-once, tiered (auto vs consent), content-addressed file steps, verified exec steps; crash-resume safe |
| **OpenResty Module** | `catalog/openresty/`   | Signed catalog entry for OpenResty 1.1.0; embedded in binary; air-gapped compatible                                                         |

#### Proxy Import (`src/system/proxy-import/`)

| Proxy           | File              | Detection                                                          | Extraction                                         |
| --------------- | ----------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| **Nginx**       | `nginx.ts`        | `/etc/nginx/sites-enabled/`                                        | server_name, proxy_pass, root, SSL cert paths      |
| **Caddy**       | `caddy.ts`        | Caddyfile                                                          | Site blocks, hostnames, reverse proxy destinations |
| **Apache**      | `apache.ts`       | Apache vhost configs                                               | ServerName, ProxyPass, DocumentRoot                |
| **Traefik**     | (in proxy-import) | Docker labels                                                      | Route extraction from labels                       |
| **HAProxy**     | (in proxy-import) | Config                                                             | Frontend/backend configuration                     |
| **Parse Utils** | `parse-utils.ts`  | Shared regex extraction, config normalization, upstream resolution |

#### Source Archive (`src/archive.ts`)

| Feature                  | Details                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 3-tier tar precedence    | explicit includes > git truth (ls-files --cached --others --exclude-standard) > name-based exclude fallback |
| Git truth                | Honors .gitignore precisely; tracked build/ survives, gitignored dist/ drops; appends alsoInclude paths     |
| macOS metadata stripping | COPYFILE_DISABLE=1, --no-mac-metadata, --no-xattrs, --no-acls, --no-fflags                                  |
| Root-anchored excludes   | Ambiguous names anchored to archive root (`./name`)                                                         |
| Transfer verification    | Post-transfer non-empty target check                                                                        |

#### Key Design Patterns

| Pattern                  | Implementation                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Capability-based runtime | `RuntimeCapability` enum (17 caps) + `supports(cap)` — no silent stubs                     |
| Dual-path file ops       | NginxProvider uses executor (remote) or node:fs (local); atomic tmp+mv writes              |
| Self-rollback            | Config snapshotted before write; failed reload restores snapshot and re-reloads            |
| Never-throw degrade      | Lua availability gates vhost directives; geo deps non-fatal; ensureLuaScripts never throws |
| Zero-bleed imports       | Dynamic imports per platform target; Docker deps never loaded for bare/cloud mode          |
| Provision lock           | In-process keyed async-mutex + Postgres advisory lock for server-scoped serialization      |
| Exactly-once remote exec | POSIX `hx-run` wrapper with journal; survives SSH disconnect, re-harvests on reconnect     |
| Stamp-last migrations    | Version marker written AFTER all assets; crash mid-write = stale (re-applied next deploy)  |

#### 6.4d Core Package (`@repo/core`)

The `@repo/core` package is the **zero-dependency** (except `zod`) shared library used by every app and package in the monorepo. Contains types, constants, the stack/language/workspace registries, metadata parsers, app catalog templates, update logic, and utilities. No I/O, no side effects — safe to import from API, dashboard, CLI, and adapters alike.

##### Types (`src/types.ts` — 173 lines)

| Type                                            | Purpose                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DeploymentStatus`                              | `queued` \| `building` \| `deploying` \| `ready` \| `failed` \| `cancelled`                                 |
| `Environment`                                   | `production` \| `preview` \| `development`                                                                  |
| `Framework` / `LanguageId`                      | Derived from STACKS / LANGUAGES registries                                                                  |
| `BuildStrategy`                                 | `server` \| `local` (host machine)                                                                          |
| `DeployTarget`                                  | `local` \| `server` \| `cloud`                                                                              |
| `RuntimeMode`                                   | `bare` \| `docker`                                                                                          |
| `ProductionMode`                                | `host` \| `static` \| `standalone`                                                                          |
| `SleepMode`                                     | `auto_sleep` \| `always_on`                                                                                 |
| `DomainStatus`                                  | `pending` \| `active` \| `failed` \| `removing`                                                             |
| `SslStatus`                                     | `none` \| `provisioning` \| `active` \| `expired` \| `error`                                                |
| `PlanId` / `SubscriptionStatus` / `UsageMetric` | Billing types                                                                                               |
| `UserRole` / `TeamRole`                         | Auth types                                                                                                  |
| `ApiResponse<T>` / `PaginatedResponse<T>`       | API response wrappers                                                                                       |
| `PackageManager`                                | `string` — open union (npm/yarn/pnpm/bun/go/cargo/pip/poetry/uv)                                            |
| `AdapterType`                                   | `"docker"` — runtime adapter selector                                                                       |
| `ComposeHealthcheck`                            | Docker healthcheck shape (test/interval/timeout/retries/startPeriod/disable)                                |
| `ComposeAdvanced`                               | Extended compose fields as JSONB (healthcheck grows per phase — pure shape-widening, no migration)          |
| `RouteRuleSpec`                                 | Per-route edge rules (rateLimit, ban, access, hotlink, block) shared by @repo/db + @repo/adapters via JSONB |

##### Stacks Registry (`src/stacks.ts` — 1197 lines)

**The single source of truth for every supported stack.** Adding a framework = one entry here + optional detection rule in stack-detector.

| Component                    | Lines     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Types**                    |           | `LanguageDefinition` (buildImage, runtimeImage, packageManagers, requiredTools), `StackCategory` (`frontend`/`backend`/`fullstack`/`static`/`docker`/`services`/`generic`), `ProjectType` (`app`/`docker`/`services`/`monorepo`), `StackDetection` (rootMarkers, deps, contentPatterns), `StackDefinition` (name, language, category, outputDirectory, defaultPort, defaultBuildCommand, defaultStartCommand, optional: buildImage/runtimeImage, requiredToolVersions, requiredTools, productionPaths, cacheDirs, defaultBuildStrategy, detection)                                                                                    |
| `LANGUAGES`                  | 81 lines  | 12 language definitions: `javascript`, `typescript`, `go`, `rust`, `python`, `ruby`, `php`, `java`, `csharp`, `elixir`, `multi` — each with buildImage, runtimeImage, packageManagers, requiredTools                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `STACKS`                     | 694 lines | **42 stacks** across 12 languages:                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| — JS/TS Frontend & Fullstack |           | nextjs, nuxt, sveltekit, remix, astro, vite, angular, gatsby, cra (create-react-app), vue, react                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| — JS/TS Backend              |           | express, fastify, hono, nestjs, koa, adonis, elysia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| — Go                         |           | go, gin, fiber, echo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — Rust                       |           | rust, actix, axum, rocket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| — Python                     |           | python, django, flask, fastapi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| — Ruby                       |           | rails, sinatra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| — PHP                        |           | laravel, symfony                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| — Java/JVM                   |           | springboot, quarkus, kotlin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| — C#/.NET                    |           | dotnet, blazor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| — Elixir                     |           | phoenix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| — Generic                    |           | node, static, docker, docker-compose, unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| — Opinionated                |           | webmail (runs on bun, not node)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Derived constants**        |           | `STACK_IDS`, `LANGUAGE_IDS`, `ALL_PACKAGE_MANAGERS`, `BUN_ELIGIBLE_LANGUAGES` (js/ts), `TRANSFER_EXCLUDES` (17 paths), `STACK_ROOT_MARKERS` (auto-derived from all detection.rootMarkers), `OUTPUT_DIRECTORIES`, `PACKAGE_ROOT_ONLY_EXCLUDES` (`["build", "dist", "data"]`), `STACK_ICONS` (DevIcon CDN URLs for all 42 stacks)                                                                                                                                                                                                                                                                                                       |
| **Utility functions**        |           | `getBuildImage()` (resolves stack → language default, bun override), `getRuntimeImage()` (same resolution), `getStackDefaults()` (full def + resolved images), `getProjectType()` (category → app/docker/services), `isServicesFramework()` (true for docker-compose/services stacks), `isTypicallyStatic()` (static/frontend stacks with no startCommand), `packageManagerEnsureCommand()` (corepack enable for pnpm/yarn), `buildOutputTransferExcludes()` (KEEPS stack's own outputDirectory, removes cacheDirs), `isUploadIgnoredPath()` (browser-safe path predicate: unambiguous excludes at any depth, ambiguous only at root) |

Transfer excludes are 3 categories: VCS (`.git`), deps (`node_modules`/`vendor`), build/cache (`.next`, `.vite`, `.turbo`, `.cache`, `.react-router`, `.nuxt`, `.svelte-kit`, `.astro`, `.output`, `dist`, `build`, `.nx`, `data`, `.dev-secrets.json`). `PACKAGE_ROOT_ONLY_EXCLUDES` = `["build", "dist", "data"]` — ambiguous names pruned only at package root, not nested.

##### Constants (`src/constants.ts` — 303 lines)

| Export                                                       | Purpose                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_NAME`                                                   | `"HosteraX"`                                                                                                                                                                                                                                                                                                                                    |
| `DEPLOYMENT_STATUSES` / `DOMAIN_STATUSES` / `SSL_STATUSES`   | Typed arrays of status literals (`DEPLOYMENT_STATUSES` = 6, `DOMAIN_STATUSES` = 4, `SSL_STATUSES` = 5)                                                                                                                                                                                                                                          |
| `FRAMEWORKS`                                                 | Re-export of `STACK_IDS` (legacy alias)                                                                                                                                                                                                                                                                                                         |
| `PRODUCTION_MODES`                                           | `["host", "static", "standalone"]`                                                                                                                                                                                                                                                                                                              |
| `ENVIRONMENTS`                                               | `["production", "preview", "development"]`                                                                                                                                                                                                                                                                                                      |
| `ANNUAL_DISCOUNT`                                            | 0.2 (20% off annual billing)                                                                                                                                                                                                                                                                                                                    |
| `BUILD_ENV_VARS`                                             | **16 env vars** injected into every build: `CI=true`, telemetry disabled for all frameworks (NG_CLI, NEXT, NUXT, ASTRO, GATSBY, DO_NOT_TRACK), color forced, no update notifiers                                                                                                                                                                |
| `PlanTierId`                                                 | `"free"` \| `"pro"` \| `"team"` \| `"enterprise"`                                                                                                                                                                                                                                                                                               |
| `PlanDefinition` / `HosteraXLimits` / `CreditPackDefinition` | Full plan type definitions with Stripe price IDs, HosteraX workspace ceilings, credit packs                                                                                                                                                                                                                                                     |
| `PLANS`                                                      | **4-tier HosteraX cloud workspace billing registry**: Free (500k credits/mo, 1 workspace, 2 vCPU, 2GB RAM, 10GB disk), Pro (10M credits, 10 workspaces, 16 vCPU, 32GB RAM, 100GB disk), Team (60M credits, 50 workspaces, 64 vCPU, 128GB RAM, 500GB disk), Enterprise (custom contact sales). Prices in cents; stripePriceId with env fallbacks |
| `CREDIT_CONVERSION`                                          | HosteraX credit conversion rates: cpu_time_minutes=500, memory_gb_minutes=100, disk_io_gb=500, network_gb=10000, requests=1                                                                                                                                                                                                                     |
| `CREDIT_PACKS`                                               | 3 HosteraX top-up packs: 5k ($5), 25k ($20), 100k ($70)                                                                                                                                                                                                                                                                                         |
| `PLAN_IDS`                                                   | Ordered array of 4 tier IDs                                                                                                                                                                                                                                                                                                                     |
| `validatePlanPriceIds()`                                     | Boot-time check; returns missing placeholder IDs                                                                                                                                                                                                                                                                                                |
| `isPlaceholderPriceId()`                                     | Guards against reaching Stripe with bogus IDs                                                                                                                                                                                                                                                                                                   |

##### System Limits (`src/system.ts` — 111 lines)

Centralized operational constants — `SYSTEM` object with sub-groups:

| Group         | Key Limits                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECTS`    | Max 100 per user, 50 active, default port 3000, default branch `main`, default framework `unknown`, default production mode `host`, default package manager `npm` |
| `DEPLOYMENTS` | Max 1 concurrent per project, 5 pending sessions, 30min build timeout, 512-char error message, restart policy `always`                                            |
| `SSE`         | 2000 logs/session, 5 subscribers/session, 4hr session TTL, 25s heartbeat, 500 max sessions, 5min sweep                                                            |
| `DOMAINS`     | Free domain `hx.domains`, max 10 per project, verification prefix `_hosterax-challenge`, 6hr SSL renew interval, renew 14 days before expiry, batch size 50       |
| `ENV_VARS`    | Max 100 per project, 256-char key, 10k-char value                                                                                                                 |
| `VALIDATION`  | Max string 500, project name 100, hostname 253, port 1-65535, CPU 0.25-4, memory 128-8192 MB, pagination 1-100 per page                                           |

##### Language Detectors (`src/languages/`)

| Component                 | Files                      | Description                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Types**                 | `types.ts` (50 lines)      | `LanguageDetector` (id, label, manifestFiles, parseManifest, optional detectPort), `PortDetectionContext` (packageJson?, fileContents?)                                                                                                                                                             |
| `LANGUAGE_DETECTORS`      | `index.ts` (85 lines)      | **9 registered detectors**: javascript, python, go, rust, ruby, php, java, elixir, docker                                                                                                                                                                                                           |
| `javascript`              | `javascript.ts` (56 lines) | Reads `package.json` `dependencies` + `devDependencies` (merged); port detection from `scripts` block (scans `--port`/`-p` flags in start→dev→serve→preview production-first order)                                                                                                                 |
| `python`                  | `python.ts` (105 lines)    | 3 manifests: `requirements.txt` (pip `name==version` lines), `pyproject.toml` (PEP 621 `[project].dependencies` + Poetry `[tool.poetry.dependencies]` + optional-dependencies groups), `Pipfile` (`[packages]`/`[dev-packages]`); all names normalized to lowercase + underscores                   |
| `go`                      | `go.ts` (49 lines)         | `go.mod` — block form `require (...)` + single-line `require` form; `/vN`-stripped aliases so imports match without major-version suffix                                                                                                                                                            |
| `rust`                    | `rust.ts` (40 lines)       | `Cargo.toml` — `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]`; inline-table safety (terminates sections at `\n[`)                                                                                                                                       |
| `ruby`                    | `ruby.ts` (21 lines)       | `Gemfile` — extracts first quoted arg from each `gem` directive; version constraints ignored (presence-only)                                                                                                                                                                                        |
| `php`                     | `php.ts` (22 lines)        | `composer.json` — `require` + `require-dev` blocks as dep map                                                                                                                                                                                                                                       |
| `java`                    | `java.ts` (69 lines)       | No dep extraction (uses `STACKS.contentPatterns` instead); port detection from `server.port` in `application.properties` or `application.{yml,yaml}` (skips env-var templates like `${PORT:8080}`); manifestFiles includes pom.xml, build.gradle, build.gradle.kts, application.properties/yml/yaml |
| `elixir`                  | `elixir.ts` (25 lines)     | `mix.exs` — extracts `{:atom,` tuples from `deps/0` function; version constraints ignored                                                                                                                                                                                                           |
| `docker`                  | `docker.ts` (31 lines)     | `Dockerfile` — no dep extraction (opaque to text); port recovery from `EXPOSE <port>` directive                                                                                                                                                                                                     |
| `LANGUAGE_MANIFEST_FILES` | Derived                    | Union of all manifest filenames — consumed by prepare.service.ts for repo file fetch                                                                                                                                                                                                                |
| `collectDependencies()`   |                            | Merge deps from every present manifest into one map                                                                                                                                                                                                                                                 |
| `detectPort()`            |                            | Iterate detectors for port signal until one answers                                                                                                                                                                                                                                                 |

##### Workspace Detectors (`src/workspaces/`)

| Component                                   | Files                         | Description                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Types**                                   | `types.ts` (61 lines)         | `WorkspaceDetector` (id, label, manifestFiles (string or RegExp), optional packageManager, parseSubProjects), `MatchedWorkspace` (detector, patterns[])                                              |
| `WORKSPACE_DETECTORS`                       | `index.ts` (74 lines)         | **10 registered detectors**: pnpm, npm-workspaces, rush, cargo, go, uv, elixir-umbrella, maven, gradle, dotnet-solution                                                                              |
| `pnpm`                                      | `node.ts` (87 lines)          | `pnpm-workspace.yaml` `packages:` block (hand-rolled YAML, no dep; BOM-stripped; other top-level keys terminate the block); registered packageManager: pnpm                                          |
| `npm-workspaces`                            | `node.ts`                     | `package.json` `workspaces` field — both array form (`["packages/*"]`) and object form (`{ "packages": ["packages/*"] }`); BOM-stripped; registered packageManager: npm                              |
| `rush`                                      | `rush.ts`                     | Rush monorepo configuration                                                                                                                                                                          |
| `cargo`                                     | `cargo.ts` (26 lines)         | `Cargo.toml` with `[workspace]` → `members = [...]` (uses `extractStringArrayFromSection`); no packageManager (cargo resolves implicitly)                                                            |
| `go`                                        | `go.ts`                       | `go.work` file — `use` directives as sub-project paths                                                                                                                                               |
| `uv`                                        | `python-uv.ts` (23 lines)     | `pyproject.toml` with `[tool.uv.workspace]` → `members = [...]` (uses `extractStringArrayFromSection`); registered packageManager: uv                                                                |
| `elixir-umbrella`                           | `elixir.ts`                   | Elixir umbrella app structure                                                                                                                                                                        |
| `maven`                                     | `maven.ts`                    | Maven multi-module POM                                                                                                                                                                               |
| `gradle`                                    | `gradle.ts`                   | Gradle multi-project settings                                                                                                                                                                        |
| `dotnet-solution`                           | `dotnet.ts`                   | .NET `.sln` files (regex-based, name varies per repo)                                                                                                                                                |
| `extractStringArrayFromSection()`           | `toml-helpers.ts` (111 lines) | Mini TOML parser (no dep): extracts a string-array key from a named section (`[workspace]` members, `[tool.uv.workspace]`); handles nested brackets/quoting/comments; used by Cargo and uv detectors |
| `WORKSPACE_MANIFEST_FILES`                  | Derived                       | Lower-cased basename set for cheap root-file pre-scan                                                                                                                                                |
| `findMatchingDetectors(filename)`           |                               | Match manifest filename against all detectors (static + regex)                                                                                                                                       |
| `parseWorkspaceManifest(filename, content)` |                               | Parse manifest → patterns from all matching detectors                                                                                                                                                |

##### Metadata Parsers (`src/metadata/`)

| Component                               | Files                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Types**                               | `types.ts` (104 lines)  | `DeploymentMetadataSource` (`"vercel"` \| `"render"` \| `"netlify"` \| `"heroku"` \| `"nixpacks"`), `DeploymentRewrite` (source, destination), `DeploymentRedirect` (source, destination, permanent?, statusCode?), `DeploymentHeaderRule` (source, headers[]), `RoutingConfig`, `DeploymentMetadata`, `MetadataParser`                                                                                                                                         |
| `MetadataParser` interface              |                         | source, files, `parse(fileContents)` → `DeploymentMetadata` or null                                                                                                                                                                                                                                                                                                                                                                                             |
| `DeploymentMetadata`                    |                         | Normalized build/run hints: installCommand, buildCommand, outputDirectory, startCommand, framework, env, rewrites, routing (RoutingConfig), nonLocal, fillOnly                                                                                                                                                                                                                                                                                                  |
| `RoutingConfig`                         |                         | rewrites, redirects, headers, cleanUrls, trailingSlash — persisted on project, compiled to OpenResty at deploy time                                                                                                                                                                                                                                                                                                                                             |
| `METADATA_PARSERS`                      | `index.ts` (65 lines)   | **2 parsers** in precedence order: `vercelMetadataParser`, `renderMetadataParser`                                                                                                                                                                                                                                                                                                                                                                               |
| `parseDeploymentMetadata(fileContents)` |                         | Run all parsers over one directory's file map → non-empty `DeploymentMetadata[]` in precedence order                                                                                                                                                                                                                                                                                                                                                            |
| `METADATA_FILES`                        | Derived                 | Union of all parser file basenames (auto-derived)                                                                                                                                                                                                                                                                                                                                                                                                               |
| `vercelMetadataParser`                  | `vercel.ts` (201 lines) | Parses `vercel.json` — `parseVercelConfig(raw)` shared with project-root detector; `extractCdTargets(command)` for `cd`-based build commands (flags `nonLocal`); `VERCEL_FRAMEWORK_TO_STACK` map (15 slugs: nextjs/vite/astro/nuxtjs→nuxt/svelte→sveltekit/remix/gatsby/angular/create-react-app→cra/vue); conditional rule dropping (rules with `has`/`missing` fields skipped); routing: rewrites/redirects/headers/cleanUrls/trailingSlash → `RoutingConfig` |
| `renderMetadataParser`                  | `render.ts` (71 lines)  | Parses `render.yaml` — hand-rolled YAML (no dep) with `stripBom()` / `unquote()` helpers; takes FIRST `startCommand`/`buildCommand` + `envVars` entries with literal `value:` (secrets with `sync:false` skipped); `fillOnly=true` (never overrides package.json); bare install commands (`npm install`/`yarn install`) filtered out as noise                                                                                                                   |
| `missingOutputDirectoryMessage()`       |                         | User-facing message for missing build output, used by self-hosted OpenResty                                                                                                                                                                                                                                                                                                                                                                                     |

##### App Templates (`src/app-templates.ts` — 834 lines)

Curated one-click app catalog — 17 templates:

| App              | Kind     | Category   | Services                               | Config                                                              |
| ---------------- | -------- | ---------- | -------------------------------------- | ------------------------------------------------------------------- |
| **Convex**       | template | backend    | backend (3210/3211) + dashboard (6791) | INSTANCE_SECRET (auto-gen), public URLs resolved at deploy          |
| **n8n**          | template | automation | n8n (5678)                             | N8N_ENCRYPTION_KEY (auto-gen), timezone, execution pruning settings |
| **Ghost**        | template | cms        | ghost-db (MySQL) + ghost (2368)        | Shared DB password (generateGroup), public URL                      |
| **Directus**     | template | cms        | directus (8055)                        | SECRET (auto-gen), DB on SQLite volume                              |
| **NocoDB**       | template | database   | nocodb (8080)                          | First sign-up = admin                                               |
| **Metabase**     | template | analytics  | metabase (3000)                        | Embedded H2 DB on volume                                            |
| **Grafana**      | template | analytics  | grafana (3000)                         | Admin/admin first login                                             |
| **Gitea**        | template | other      | gitea (3000)                           | Setup wizard on first visit                                         |
| **code-server**  | template | other      | code-server (8080)                     | PASSWORD (auto-gen)                                                 |
| **Uptime Kuma**  | template | other      | uptime-kuma (3001)                     | SQLite on volume                                                    |
| **Vaultwarden**  | template | other      | vaultwarden (80)                       | DOMAIN resolved at deploy                                           |
| **FreshRSS**     | template | other      | freshrss (80)                          | Setup wizard on first visit                                         |
| **Stirling PDF** | template | other      | stirling-pdf (8080)                    | Config + OCR data on volumes                                        |
| **IT-Tools**     | template | other      | it-tools (80)                          | Stateless, no login                                                 |
| **Excalidraw**   | template | other      | excalidraw (80)                        | Stateless, browser-only                                             |
| **Mail**         | flow     | mail       | (defers to provider wizard)            | Management at `/emails`                                             |
| **Buzz**         | template | other      | (placeholder, coming soon)             | No services yet                                                     |

`AppTemplate` types: `AppCategory` (`backend`/`database`/`cms`/`mail`/`analytics`/`automation`/`other`), `TemplateServiceSpec` (name, image, ports, exposedPort, routes, environment, secretEnv, volumes, dependsOn, healthcheck, restart, command), `AppConfigField` (key, service, label, type, generate, generateGroup, secret). `AVAILABLE_APP_IDS` = `{"mail", "n8n", "convex"}`, others shown dimmed as "Coming soon".

##### App Settings (`src/app-settings.ts` — 120 lines)

Day-2 configuration system for installed apps:

| Type/Function                                   | Purpose                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AppManagement`                                 | `{ kind: "schema" }` (auto-form from settings) \| `{ kind: "custom"; href }` (bespoke surface)                                                                                                                                 |
| `AppSettingOption`                              | value + label for `type:"select"` fields                                                                                                                                                                                       |
| `AppSettingField`                               | key, service, label, help, type (text/password/boolean/select/number), options (`AppSettingOption[]`), min/max, integer, default, placeholder, secret, trueValue/falseValue, requiresRedeploy, advanced, installStep, required |
| `AppSettingGroup`                               | id, label, description, fields[]                                                                                                                                                                                               |
| `settingTrueValue()` / `settingFalseValue()`    | Resolve boolean env strings (default `"true"`/`"false"`)                                                                                                                                                                       |
| `envToSettingValue()`                           | Env string → UI control value (boolean → true/false, string passthrough)                                                                                                                                                       |
| `settingToEnvValue()`                           | UI value → env string                                                                                                                                                                                                          |
| `validateSetting()`                             | Per-field validation: number bounds, select options, boolean values                                                                                                                                                            |
| `flattenSettingFields()` / `findSettingField()` | Lookup helpers                                                                                                                                                                                                                 |

##### Service Status & Routing (`src/service-status.ts` + `src/service-routing.ts`)

| Export                            | Purpose                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `isServiceSuccessStatus()`        | Matches `success`/`running`/`ready`                                                                                  |
| `isServiceFailureStatus()`        | Matches `failure`/`failed`/`cancelled`                                                                               |
| `isServiceInFlightStatus()`       | Matches `indeterminate`/`deploying`/`building`/`pending`                                                             |
| `serviceStatusToContainerState()` | Maps to `running`/`failed`/`starting`/`stopped`                                                                      |
| `resolvePublicUrlPlaceholders()`  | Replace `{{publicUrl:<service>}}` / `{{publicUrl:<service>:<port>}}` tokens with assigned public URLs at deploy time |
| `normalizeServiceLabel()`         | Lowercase, strip non-alphanumeric                                                                                    |
| `defaultServiceHostnameLabel()`   | Compose: collapses `web`/`app`/`frontend` to base label; monorepo: always namespaces                                 |
| `firstServicePort()`              | Extract first container-side port from compose ports list                                                            |
| `internalServiceAddress()`        | `<service-name>:<port>` for sibling network access                                                                   |
| `resolveServiceHostnameLabel()`   | Prefers explicit subdomain, falls back to default                                                                    |

##### Connectivity (`src/connectivity.ts` — 84 lines)

One shared contract for all reachability checks (SSH servers, backup destinations, future targets):

| Type                                     | Purpose                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectivityCode`                       | 8 codes: reachable, unreachable, auth_failed, permission_denied, timeout, protocol_error, misconfigured, unknown                                         |
| `ConnectivityResult`                     | ok (boolean), code, message, latencyMs                                                                                                                   |
| `connOk()` / `connFail()`                | Factory functions                                                                                                                                        |
| `classifyConnectivityError(input, tag?)` | Classifies errors by message pattern matching (6 compiled regexes) + optional tag override; strips credential-bearing Error fields to `err.message` only |

##### Errors (`src/errors.ts` — 89 lines)

| Class                | HTTP   | Code                                                                                          |
| -------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `AppError`           | varies | base class (constructor: message, statusCode=500, code?)                                      |
| `NotFoundError`      | 404    | `NOT_FOUND`                                                                                   |
| `UnauthorizedError`  | 401    | `UNAUTHORIZED`                                                                                |
| `ForbiddenError`     | 403    | `FORBIDDEN`                                                                                   |
| `ValidationError`    | 400    | `VALIDATION_ERROR` (carries `details?: Record<string, string[]>`)                             |
| `ConflictError`      | 409    | `CONFLICT`                                                                                    |
| `DeployError`        | 500    | variable code (e.g. `PORT_IN_USE`); carries `details?: Record<string, unknown>`               |
| `safeErrorMessage()` | —      | Extracts `.message` from Error (strips credential-bearing structured fields), 2000-char bound |

##### Update & Advisory System (`src/updates/`)

| Module     | Files                       | Description                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types      | `types.ts` (93 lines)       | `AdvisorySeverity` (critical/recommended/info), `AdvisoryAction` (kind: update/open-url/update-entity), `AdvisoryTarget` (platform/app/project/mail), `Advisory`, `AdvisoryManifest`, `LatestRelease`, `UpdateState`; `GITHUB_REPO = "hosterax/hosterax"`, `RELEASES_LATEST_API`, `advisoryManifestUrl(tag)` (pinned to release tag, not main), `changelogUrl()` |
| Semver     | `semver.ts` (48 lines)      | `parseSemver()` (strip v + prerelease), `compareSemver()` (-1/0/1), `satisfiesRange()` (space-separated comparators: <=, >=, <, >, =, bare)                                                                                                                                                                                                                      |
| Identity   | `identity.ts` (89 lines)    | `UpdatableKind` (commit/release/image), `UpdatableIdentity`, `sameKind()`, `isBehind()` (semver for release, SHA for commit, digest + ref for image), `digestSha()`, `identityLabel()`                                                                                                                                                                           |
| Advisories | `advisories.ts` (126 lines) | `parseManifest(raw)` — defensive parsing of untrusted GitHub-authored manifest (drops malformed entries), `matchAdvisories()` — filter by satisfiesRange + sort by severity, `resolveUpdateState()` — fold currentVersion + latestRelease + manifest + dismissed/muted prefs into UpdateState (critical always shown)                                            |
| Resolve    | `resolve.ts` (90 lines)     | `desktopAssetName(platform, arch)` — darwin-arm64/x64 dmgs, win32-x64 zip, linux AppImage, `resolveDesktopUpdate()` — fold GitHub payload into update decision, `resolveCliUpdatePlan()`, `cliInstallCommand()`                                                                                                                                                  |

##### Runtime Config (`src/runtime-config.ts` — 146 lines)

| Export                                                    | Purpose                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PORT`                                            | web=3000, dashboard=3001, api=4000, saasDashboard=3002, saasApi=4100                                                                                                                                                                                                         |
| `LOCAL_WEB_URL` / `LOCAL_DASHBOARD_URL` / `LOCAL_API_URL` | Standalone localhost URLs (`http://localhost:<port>`)                                                                                                                                                                                                                        |
| `DASHBOARD_RUNTIME_TARGETS`                               | **3-row table**: `local` (self-hosted, cloudTargetId=`cloud-saas`), `local-saas` (dev SaaS at localhost, self-referential), `cloud-saas` (production SaaS at `app.hosterax.io`/`api.hosterax.io`); each row has dashboard/api URLs + ports + cloudTargetId + selfHosted flag |
| `DashboardRuntimeTargetId` / `DashboardRuntimeTarget`     | Derived types from the table keys/values                                                                                                                                                                                                                                     |
| `LOOPBACK_HOSTNAMES`                                      | `Set` of `{"localhost", "127.0.0.1", "[::1]"}`                                                                                                                                                                                                                               |
| `runtimeTargetId` / `runtimeTarget`                       | Resolved from `HOSTERAX_TARGET` env (default `local`), fail-loud on invalid                                                                                                                                                                                                  |
| `cloudRuntimeTargetId` / `cloudRuntimeTarget`             | Where "cloud" points — resolved from `HOSTERAX_CLOUD_TARGET` env (falls back to active target's `cloudTargetId`)                                                                                                                                                             |
| `dashboardRuntimeOrigins`                                 | Flat list of all dashboard+api origins from the table, used for CORS allowlists                                                                                                                                                                                              |
| `alignLoopbackOrigin()`                                   | Rewrites localhost↔127.0.0.1 in loopback origins to keep SameSite cookies working                                                                                                                                                                                            |

##### Project Source (`src/project-source.ts` — 68 lines)

| Export                                | Purpose                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE_PROVIDERS` / `SourceProvider` | `["github", "gitlab", "bitbucket", "local", "upload", "release"]`                                                                                                             |
| `isReleaseProvider()`                 | True for `gitProvider === "release"`                                                                                                                                          |
| `ReleaseSource`                       | mode (github/url), repo, assetTemplate (with {tag}/{version}/{os}/{arch} placeholders), os/arch, distUrl, sha256/sha256Url, versionUrl, channel, pinnedVersion, trackReleases |
| `renderAssetName()`                   | Fill GitHub asset-name template from version + os/arch                                                                                                                        |

##### Mail Server Routing (`src/mail-server/routing/`)

Two-level barrel: `mail-server/index.ts` (13 lines) re-exports `routing/*`. Pure-function module (no I/O) for computing the HTTP routing + DNS plan that fronts a self-hosted mail server (iRedMail on a VPS). The mail VPS exposes only raw SMTP/IMAP/POP3 TCP; all HTTP is proxied through HosteraX's routing layer.

| Export                    | File                          | Purpose                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MailServerRouteInput`    | `types.ts` (153 lines)        | Inputs: userDomain, mailServerIp, zeroServerOrigin, zeroClientOrigin, hosteraxApiOrigin                                                                                                                                   |
| `MailRouteId`             |                               | `"mail-client"` \| `"mail-api"` \| `"autodiscover"` — 3 public HTTP routes                                                                                                                                                |
| `MailRoute`               |                               | id, hostname, targetUrl, tls=true, description                                                                                                                                                                            |
| `MailDnsRecordId`         |                               | 8 record types: `mailservice-a`, `apex-mx`, `spf`, `dkim`, `dmarc`, `autodiscover-cname`, `mail-client-cname`, `mail-api-cname`                                                                                           |
| `MailDnsRecord`           |                               | id, type (A/MX/TXT/CNAME), name, value, priority (MX), description, required                                                                                                                                              |
| `MailServerRoutePlan`     |                               | input, routes[], dns[]                                                                                                                                                                                                    |
| `buildMailServerRoutes()` | `build-routes.ts` (202 lines) | Takes `MailServerRouteInput` → complete `MailServerRoutePlan` with 3 routes (mail-client@mail.\*, mail-api@api.mail.\*, autodiscover@autodiscover.\*) + 8 DNS records (A/MX/TXT/CNAME — SPF/DKIM/DMARC included verbatim) |
| `hostnameFromUrl()`       | (internal)                    | Extract bare hostname from URL or host:port for CNAME values                                                                                                                                                              |

##### Utilities (`src/utils.ts` — 93 lines)

| Function                       | Purpose                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `slugify(text)`                | URL-safe slug, 100 char max                                                                                        |
| `normalizeCustomHostname(raw)` | Canonical stored form: trimmed, lowercased, scheme stripped, trailing slash removed                                |
| `isValidCustomHostname(host)`  | Rejects IPv4 literals, localhost, single-label, embedded path/port/scheme; 253-char limit, multi-label requirement |
| `generateId(prefix?)`          | 12-byte crypto-random base64url ID (Web Crypto API, no node:crypto)                                                |
| `formatBytes(bytes)`           | Human-readable (B/KB/MB/GB/TB)                                                                                     |
| `formatDuration(seconds)`      | Human-readable ("5m 30s")                                                                                          |
| `sleep(ms)`                    | Promise-based delay                                                                                                |

##### Exports (`src/index.ts`)

Single barrel export file — re-exports all modules: `types`, `stacks`, `constants`, `system`, `utils`, `errors`, `service-routing`, `service-status`, `runtime-config`, `workspaces`, `connectivity`, `languages`, `metadata`, `mail-server`, `app-templates`, `app-settings`, `project-source`, `updates`.

#### 6.4e UI Component Library (`packages/ui/`)

The `@repo/ui` package is the **shared React 19 component library** consumed by the dashboard and desktop apps. Built with `tsup` (ESM + DTS output), peers on `react`/`react-dom@^19`, runtime deps: `class-variance-authority`, `clsx`, `tailwind-merge`. Exports four components and one utility.

| File              | Export                | Lines | Description                                                                                                                                                                                                                   |
| ----------------- | --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cn.ts`   | `cn()`                | 7     | Tailwind class merger — wraps `clsx` + `twMerge` to resolve conflicting Tailwind utilities                                                                                                                                    |
| `src/index.tsx`   | (barrel)              | 8     | Re-exports `Button`, `Card` (+5 sub-components), `Badge`, `StatusDot`, `cn`                                                                                                                                                   |
| `src/globals.css` | CSS custom properties | 18    | Tailwind `@tailwind base/components/utilities` + `@layer base` design tokens: `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`, `--radius` (0.5rem) |

##### Button (`src/components/button.tsx` — 44 lines)

`React.forwardRef`-based button with `class-variance-authority` variant system:

| Prop        | Value                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`   | `default` (primary bg) · `secondary` (muted bg) · `outline` (bordered, transparent) · `ghost` (hover-only) · `destructive` (red bg)                                                                                 |
| `size`      | `sm` (h-8 px-3 text-xs) · `md` (h-10 px-4) · `lg` (h-12 px-6 text-base)                                                                                                                                             |
| Base styles | `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50` |
| Defaults    | variant=`default`, size=`md`                                                                                                                                                                                        |

##### Card (`src/components/card.tsx` — 26 lines)

Six composable sub-components sharing a consistent `cn()` pattern:

| Component         | Tag   | Styles                                 |
| ----------------- | ----- | -------------------------------------- |
| `Card`            | `div` | `rounded-lg border bg-white shadow-sm` |
| `CardHeader`      | `div` | `flex flex-col space-y-1.5 p-6`        |
| `CardTitle`       | `h3`  | `text-lg font-semibold`                |
| `CardDescription` | `p`   | `text-sm text-muted-foreground`        |
| `CardContent`     | `div` | `p-6 pt-0`                             |
| `CardFooter`      | `div` | `flex items-center p-6 pt-0`           |

All accept `className` via `cn()` for consumer overrides.

##### Badge (`src/components/badge.tsx` — 29 lines)

`class-variance-authority`-based pill badge spanning semantic colors:

| Variant    | Style                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `default`  | `bg-primary/10 text-primary`                                              |
| `success`  | `bg-green-100 text-green-800`                                             |
| `warning`  | `bg-yellow-100 text-yellow-800`                                           |
| `error`    | `bg-red-100 text-red-800`                                                 |
| `muted`    | `bg-muted text-muted-foreground`                                          |
| Base shape | `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium` |

##### StatusDot (`src/components/status-dot.tsx` — 25 lines)

Small colored dot (h-2.5 w-2.5 rounded-full) that maps `DeploymentStatus` (imported from `@repo/core`) to a semantic color:

| Status      | Style                         |
| ----------- | ----------------------------- |
| `queued`    | `bg-gray-400`                 |
| `building`  | `bg-yellow-400 animate-pulse` |
| `deploying` | `bg-blue-400 animate-pulse`   |
| `ready`     | `bg-green-500`                |
| `failed`    | `bg-red-500`                  |
| `cancelled` | `bg-gray-400`                 |

Accepts `className` override and renders a `title={status}` tooltip attribute.

#### 6.4f Onboarding Package (`packages/onboarding/`)

The `@repo/onboarding` package is the **multi-step setup wizard** that guides users through first-time initialization of a HosteraX instance. Zero runtime dependencies. Built with `tsup` (ESM + CJS output). Implements a 6-step state machine covering cloud auth, self-hosted SSH provisioning, tunnel configuration, and build preferences.

##### Types (`src/types.ts` — 95 lines)

| Type                 | Purpose                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SystemSettings`     | Normalized server connection config — `serverName`, `sshHost/Port/User/AuthMethod/Password/KeyPath/KeyPassphrase/JumpHost/sshArgs`                                                                                                |
| `TunnelConfig`       | Tunnel provider selection: `provider` (`"edge"` \| `"cloudflare"` \| `"ngrok"`) + optional `token`                                                                                                                                |
| `SshPayload`         | Raw SSH input before normalization — `host`, `user`, `method` (`password` \| `key` \| `agent`), optional `serverName`/`password`/`keyPath`/`passphrase`/`port`/`jumpHost`/`sshArgs`                                               |
| `BuildMode`          | `"auto"` \| `"server"` \| `"local"`                                                                                                                                                                                               |
| `OnboardingPath`     | `"cloud"` \| `"selfhost"`                                                                                                                                                                                                         |
| `HostingMode`        | `"remote"` \| `"local"`                                                                                                                                                                                                           |
| `OnboardingStep`     | 6-step FSM: `choose` → `selfhost-choice` → `ssh` → `tunnel` → `preferences` → `loading`                                                                                                                                           |
| `OnboardingState`    | Collected state across flow — `path?`, `hostingMode?`, `ssh?`, `tunnel?`, `buildMode`, `apiUrl`, `dashboardUrl`                                                                                                                   |
| `SetupPayload`       | Sent to `POST /api/system/setup` — `defaultBuildMode`, `authMode`, all SSH fields (`serverName`, `sshHost/Port/User/AuthMethod/Password/KeyPath/KeyPassphrase/JumpHost/sshArgs`), tunnel fields (`tunnelProvider`, `tunnelToken`) |
| `OnboardingPlatform` | Platform adapter interface — `openExternal(url)`, optional `browseFile()` (returns path or null), optional `fetch` override                                                                                                       |

##### FSM & Navigation (`src/flow.ts` — 129 lines)

| Export       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StepDef`    | Metadata per step: `id`, `title`, `subtitle`                                                                                                                                                                                                                                                                                                                                                                                             |
| `STEPS`      | Record of all 6 step definitions with user-facing labels for each step                                                                                                                                                                                                                                                                                                                                                                   |
| `STEP_ORDER` | Canonical ordered array: `["choose", "selfhost-choice", "ssh", "tunnel", "preferences", "loading"]`                                                                                                                                                                                                                                                                                                                                      |
| `nextStep()` | FSM transition — given current step + collected state, returns next step or `null` (done):<br>• `choose` → cloud → `loading`; selfhost → `selfhost-choice`<br>• `selfhost-choice` → local → `tunnel`; remote → `ssh`<br>• `ssh` → private IP → `tunnel`; public IP → `preferences`<br>• `tunnel` → edge → `loading`; non-edge + SSH → `preferences`; local + non-edge → `loading`<br>• `preferences` → `loading`<br>• `loading` → `null` |
| `prevStep()` | Back navigation — reverses `nextStep()` logic with same branching for `tunnel` origin disambiguation (local vs SSH)                                                                                                                                                                                                                                                                                                                      |

##### SSH Normalization (`src/ssh.ts` — 21 lines)

| Function                    | Purpose                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildSshSettings(payload)` | Converts raw `SshPayload` → normalized `SystemSettings`: defaults `port=22`, `user="root"`, conditionally copies password/keyPath/passphrase/jumpHost/sshArgs |

##### Validation (`src/validation.ts` — 48 lines)

| Function                      | Purpose                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateServerAddress(ip)`   | Regex-based IP/hostname validation — returns `null` if valid or error message string                                                            |
| `validateSshPayload(payload)` | Full SSH input validation — requires host for all methods, password for `method=password`, keyPath for `method=key`                             |
| `isPrivateIp(ip)`             | Private/LAN IP detection — `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `localhost`, `fc`/`fd` IPv6, `::1` — strips port suffix before matching |

##### API Client (`src/api-client.ts` — 110 lines)

| Export                        | Purpose                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SetupClientOptions`          | Config — `apiUrl`, optional `internalToken` (sent as `X-Internal-Token` header), optional `fetch` override                        |
| `buildSetupPayload(settings)` | Assembles `SystemSettings` + `TunnelConfig` + `buildMode`/`authMode` into a single `SetupPayload` for the API                     |
| `pushInstanceSettings()`      | `POST /api/system/setup` with 10s timeout — returns `true` on `res.ok`, `false` on any error (no throw)                           |
| `waitForApi()`                | Polls `GET /api/health` up to 30× at 1s intervals with 2s per-attempt timeout — returns `true` when ready, `false` if never ready |

##### Exports (`src/index.ts`)

Single barrel — re-exports all 5 modules: `types`, `validation`, `ssh`, `flow`, `api-client`.

#### 6.4g Database Layer (`packages/db/`)

The `@repo/db` package is the **Drizzle ORM-based PostgreSQL database layer** that powers every app in the monorepo. Built with `tsup` (ESM), depends on `drizzle-orm`, `pg`, `@electric-sql/pglite`, `@repo/core`. Exposes three entry points: `.` (full index), `./schema` (table definitions), `./repos` (CRUD repositories). 57 migration files under `drizzle/`. Tests via vitest.

##### Database Client (`src/client.ts` — 278 lines)

| Feature                     | Description                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Dual driver**             | `postgres://...` → `pg` (node-postgres Pool, 20 max, 30s idle, 5s connect timeout); empty/absent → PGlite embedded WASM (zero-config dev) |
| **Unified `Database` type** | `NodePgDatabase<typeof schema> \| PgliteDatabase<typeof schema>` — repos never know which driver runs beneath                             |
| **`getDriver()`**           | Returns `"pg"` \| `"pglite"` for conditional adapter logic                                                                                |
| **`getPgPool()`**           | Exposes raw Pool for session-level advisory locks (throws when driver is pglite)                                                          |
| **`closeDb()`**             | Graceful shutdown — closes PGlite WASM + frees lock, drains pg pool. Safe to call multiple times                                          |
| **URL resolution**          | `DATABASE_URL` wins; otherwise composes from `POSTGRES_*` / `PG*` env vars (compatible with docker-compose convention). Empty → PGlite    |
| **PGlite data dir**         | `PGLITE_DATA_DIR` env var (with `~` expansion), else `~/.hosterax/data`                                                                   |
| **PGlite assets**           | `HOSTERAX_PGLITE_ASSETS_DIR` for `bun build --compile` binaries (provides `pglite.wasm` + `pglite.data` from shipped assets)              |
| **Migrations**              | Auto-run at startup from `packages/db/drizzle/`. `drizzle-orm/node-postgres/migrator` for pg, `drizzle-orm/pglite/migrator` for PGlite    |
| **Test isolation**          | Under `VITEST`/`NODE_ENV=test`, PGlite uses `memory://` (ephemeral, no lock, no disk writes)                                              |
| **Stale control file**      | `clearStalePgliteControlFile()` removes leftover `postmaster.pid` after `acquirePgliteLock()` grants exclusive access                     |
| **Singleton**               | `export const db = await createDb()` — eagerly initialized at module import                                                               |

##### Single-Instance PGlite Lock (`src/pglite-lock.ts` — 340 lines)

File-based exclusive-access lock for PGlite data directories. PGlite has no built-in cross-process lock and corruption is unrecoverable (`RuntimeError: Aborted()`).

| Feature                                 | Description                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Atomic acquisition**                  | `open(..., "wx")` / O_EXCL — exactly one process wins under concurrent race                                                                |
| **Lock file location**                  | Sibling of data dir (`<dir>.lock`) — never touches cluster data                                                                            |
| **Lock record**                         | JSON with `pid`, `startedAt`, `host`, `machineId` (stable machine UUID)                                                                    |
| **Machine identity**                    | macOS: `ioreg IOPlatformUUID`; Windows: `HKLM\...\MachineGuid`; Linux: `/etc/machine-id`. Falls back to `os.hostname()` with unstable flag |
| **Cross-machine guard**                 | Throws actionable error when a different machine's live lock is detected (PGlite dirs cannot be shared across machines)                    |
| **Stale PID reclamation**               | `process.kill(pid, 0)` liveness probe — dead pid → auto-reclaim                                                                            |
| **Legacy hostname migration**           | Detects pre-fix locks written with volatile hostname; treats them as same-machine to avoid false "different machine" errors                |
| **Dev hot-reload takeover**             | Under `--watch` or `HOSTERAX_DEV_LOCK_TAKEOVER=true`, terminates the stale holder (SIGTERM → 3s grace → SIGKILL) instead of waiting        |
| **Wait + retry**                        | Configurable `waitMs` (default 5s) and `pollMs` (default 100ms) for restart handoff                                                        |
| **Exit hook**                           | `process.once("exit")` → `releasePgliteLock()` — best-effort cleanup on normal exit                                                        |
| **Owner-guarded release**               | `releasePgliteLock()` verifies own PID + machineId before deleting lock                                                                    |
| **`acquirePgliteLock(dataDir, opts?)`** | Main acquisition function returns promise                                                                                                  |
| **`releasePgliteLock()`**               | Module-level function callable from `closeDb()`                                                                                            |

##### Advisory Lock (`src/advisory-lock.ts` — 95 lines)

Postgres `pg_advisory_lock` / `pg_try_advisory_lock` wrappers for cross-process serialization across every replica sharing the database.

| Export                             | Description                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hashStringToInt(input)`           | FNV-1a 32-bit → masked to 31-bit signed int for Postgres advisory lock keys                                |
| `withAdvisoryLock(scopeKey, fn)`   | Holds session-level lock on dedicated pooled connection for duration of `fn`; passthrough on PGlite driver |
| `tryAcquireAdvisoryLock(scopeKey)` | Non-blocking variant; returns `AdvisoryLockHandle \| null` — handle owns its connection until `release()`  |
| `AdvisoryLockHandle`               | `{ release(): Promise<void> }`                                                                             |

##### Dump / Restore Subsystem (`src/dump.ts` — 790 lines)

Complete subgraph-aware data export/import that replaces `pg_dump` for cross-instance moves. See §6.23 for the full description.

| Export                             | Description                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DUMP_FORMAT_VERSION`              | `1`                                                                                                                                                                       |
| `SubgraphScope`                    | `{ kind: "instance" }` \| `{ kind: "organization"; organizationId }` \| `{ kind: "project"; projectId }`                                                                  |
| `DatabaseDump`                     | formatVersion, exportedAt, sourceDriver, scope, tables (`Record<string, Array<Record<string, unknown>>>`), strippedEncryptedFields                                        |
| `DumpOptions`                      | `stripEncrypted?: boolean`                                                                                                                                                |
| `RestoreOptions`                   | mode (`"wipe"` \| `"merge"`), `remapOrgId?`, `mergeConflictSkip?`                                                                                                         |
| `PkCollisionError`                 | Thrown on unique_violation (23505) during restore — typed for 409 responses                                                                                               |
| `ENCRYPTED_COLUMNS`                | 17 encrypted-column specs across 9 tables with optional `secretPaths` for JSONB partial redaction                                                                         |
| `dumpSubgraph(scope, opts)`        | FK-closed slice export — walks 37 tables via `TABLES` catalogue with 4 resolver strategies (all-rows, root-project-id, fk, from-root-project)                             |
| `restoreSubgraph(dump, opts)`      | Transactional restore with FK deferral, orgId remapping, encrypted-column redaction (mandatory — security), date-string revival, `mergeConflictSkip`                      |
| `deleteProjectSubgraph(projectId)` | Child→parent FK-order deletion inside one transaction for bring-home teardown                                                                                             |
| `stripEncryptedInPlace(tables)`    | Redacts encrypted columns in-place using NOT-NULL-safe rules (null for nullable, delete for defaulted, `""` sentinel for NOT NULL no-default, deep-clone for secretPaths) |
| `dumpDatabase(opts)`               | Legacy shim → `dumpSubgraph({ kind: "instance" })`                                                                                                                        |
| `restoreDatabase(dump, opts)`      | Legacy shim → `restoreSubgraph(dump, { mode })`                                                                                                                           |

37 tables catalogued in `TABLES` array with per-table scope resolvers. 17 encrypted columns across 9 tables. `resolvePgError()` walks Drizzle's cause chain to find the driver error code.

##### Schema Catalog (`src/schema/` — 38 files)

All tables use `text` primary keys (prefixed IDs like `proj_`, `dep_`, `svc_`) unless noted. Soft-delete via `deletedAt` timestamp where applicable.

| File                                                         | Tables                                                                                                                                                                      | Key Columns & Constraints                                                                                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`                                                    | `user`, `session`, `account`, `verification`                                                                                                                                | Better Auth core — `user.email` unique, `session.token` unique, `session.userId`→user CASCADE, `account.userId`→user CASCADE                                                          |
| `organization.ts`                                            | `organization`, `member`, `invitation`                                                                                                                                      | Better Auth organization plugin — `organization.slug` unique, `member (orgId, userId)` unique index, `invitation.email` index                                                         |
| `project.ts`                                                 | `projectGroup` (`project_app`), `project`, `envVar`                                                                                                                         | `project (groupId, environmentSlug)` unique where active; `project.cloudWorkspaceId` unique where non-null; `envVar (projectId, environment, serviceId)` index                        |
| `service.ts`                                                 | `service`, `serviceDeployment`                                                                                                                                              | `service.kind` discriminator (`"compose"` \| `"monorepo"`); `serviceDeployment (deploymentId, serviceId)` unique; `ComposeServiceSpec`, `ServicePublicEndpoint` types                 |
| `deployment.ts`                                              | `deployment`, `buildSession`                                                                                                                                                | `deployment (projectId)` partial unique where status in-flight; `deployment.version` monotonic per-project; `changedPaths` JSONB for smart per-service deploy; `cloudArchiveStrategy` |
| `domain.ts`                                                  | `domain`, `verification`                                                                                                                                                    | `domain.hostname` unique where non-null and deleted; `domain.projectId` index; SSL status tracking                                                                                    |
| `servers.ts`                                                 | `servers`                                                                                                                                                                   | SSH config — host, port, user, auth method, password, key path, jump host; `organizationId` FK nullable                                                                               |
| `settings.ts`                                                | `instanceSettings`, `userSettings`                                                                                                                                          | Single-row instance config: tunnel, auth mode, build mode, team mode, SMTP transport; per-user: build mode, deploy target, clone strategy, transfer mode                              |
| `backup.ts`                                                  | `backupDestination`, `backupPolicy`, `backupRun`, `backupRestore`                                                                                                           | Destination (org, name) unique where active; policy (projectId, serviceId) unique where active; run/restore FSM with stale-sweep indexes                                              |
| `billing.ts`                                                 | `billingCustomer`, `billingSubscription`, `creditPack`, `stripeWebhookEvent`, `hosteraxWebhookEvent`, `stripeTopupGrant`, `billingAnniversaryGrant`, `billingUsageSnapshot` | Customer org+stripe unique; subscription org+stripe unique; webhook idempotency tables; topup grant by checkout session; anniversary grant by (org, period)                           |
| `notification.ts`                                            | `notificationChannel`, `notificationSubscription`, `notificationDefault`, `notificationDelivery`                                                                            | Channel per user; subscription (user, org, category, channel) unique; default (org, category); delivery queue indexes                                                                 |
| `audit-event.ts`                                             | `auditEvent`                                                                                                                                                                | Append-only log — org+created, org+type, org+actor, resource indexes; `before`/`after` JSONB snapshots                                                                                |
| `analytics.ts`                                               | `serverAnalytics`, `serverAnalyticsGeo`                                                                                                                                     | Per-domain per-minute counters (serverId, domain, minute) unique; daily geo aggregates (serverId, domain, day) unique                                                                 |
| `auth-oauth.ts`                                              | `oauth`, `oauthAccount`                                                                                                                                                     | GitHub OAuth state management                                                                                                                                                         |
| `terminal-sessions.ts`                                       | `terminalSessions`                                                                                                                                                          | Interactive terminal sessions                                                                                                                                                         |
| `service-terminal-sessions.ts`                               | `serviceTerminalSessions`                                                                                                                                                   | Per-service terminal sessions                                                                                                                                                         |
| `github.ts`                                                  | `gitInstallation`, `githubDeployKey`                                                                                                                                        | GitHub App installation IDs; deploy key pairs                                                                                                                                         |
| `github-webhook-event.ts`                                    | `githubWebhookEvent`                                                                                                                                                        | Inbound webhook idempotency                                                                                                                                                           |
| `github-install-state.ts`                                    | `githubInstallState`                                                                                                                                                        | GitHub App install flow state tracking                                                                                                                                                |
| `server-github.ts`                                           | `serverGithubOauth`                                                                                                                                                         | Server-scoped GitHub OAuth credentials                                                                                                                                                |
| `server-module-status.ts`                                    | `serverModuleStatus`                                                                                                                                                        | Per-server module (nginx, docker, certbot) install status                                                                                                                             |
| `server-tunnel.ts`                                           | `serverTunnels`                                                                                                                                                             | Per-server tunnel configuration                                                                                                                                                       |
| `mail.ts`                                                    | `mailServers`                                                                                                                                                               | Self-hosted mail server records                                                                                                                                                       |
| `cloud-webhook-binding.ts`                                   | `cloudWebhookBinding`                                                                                                                                                       | Routes GitHub pushes to cloud projects; (gitOwner, gitRepo, gitBranch) unique                                                                                                         |
| `cloud-handoff-code.ts`                                      | `cloudHandoffCode`                                                                                                                                                          | One-time auth handoff codes; code PK, expiresAt index                                                                                                                                 |
| `docker-migration.ts`                                        | `dockerMigration`                                                                                                                                                           | Docker compose migration tracking                                                                                                                                                     |
| `job.ts`                                                     | `job`                                                                                                                                                                       | Scheduled task definitions — key unique, kind (system/custom), cronExpression, actionConfig, dependsOn, triggerEvents                                                                 |
| `job-run.ts`                                                 | `jobRun`                                                                                                                                                                    | Execution history — (jobId, startedAt) index; status, summary, output                                                                                                                 |
| `personal-access-token.ts`, `personal-access-token-grant.ts` | `personalAccessToken`, `personalAccessTokenGrant`                                                                                                                           | User PATs with scoped resource grants                                                                                                                                                 |
| `resource-grant.ts`                                          | `resourceGrant`                                                                                                                                                             | Cross-resource permission grants                                                                                                                                                      |
| `route-rule.ts`                                              | `routeRule`                                                                                                                                                                 | Per-route edge rules (rate limit, ban, access, hotlink, block)                                                                                                                        |
| `orphaned-resource.ts`                                       | `orphanedResource`                                                                                                                                                          | GC-detected orphan tracking                                                                                                                                                           |
| `invitation-pending-grant.ts`                                | `invitationPendingGrant`                                                                                                                                                    | Pending invitation resource grants                                                                                                                                                    |
| `system-notice.ts`                                           | `systemNotice`                                                                                                                                                              | Instance-wide system announcements                                                                                                                                                    |
| `update-status.ts`                                           | `updateStatus`                                                                                                                                                              | Software update tracking per entity                                                                                                                                                   |
| `deployment-check-run.ts`                                    | `deploymentCheckRun`                                                                                                                                                        | GitHub Checks check run records                                                                                                                                                       |
| `schema/index.ts`                                            | (barrel)                                                                                                                                                                    | Re-exports all 38 tables                                                                                                                                                              |

##### Repositories (`src/repos/` — 49 files)

Every DB access goes through typed repositories. Key repos:

| File                                                                                      | Functions                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.repo.ts`                                                                            | `findByEmail`, `findById`, `list`, `create`, `update`, `delete`                                                                                                                  |
| `session.repo.ts`                                                                         | `findById`, `findByToken`, `listByUser`, `create`, `delete`, `deleteExpired`                                                                                                     |
| `account.repo.ts`                                                                         | `listByUser`, `findByProvider`, `hasPassword`, `countProviders`, `unlinkProvider`, `findWithUser`, `findByProviderAccountId`                                                     |
| `project.repo.ts`                                                                         | `findById`, `findByGroup`, `listByOrganization`, `findByGitRepo`, `create`, `update`, `softDelete`, `findActive`, `setActiveDeployment`                                          |
| `project-group.repo.ts`                                                                   | `findById`, `findBySlug`, `listByOrganization`, `create`, `update`, `softDelete`                                                                                                 |
| `deployment.repo.ts`                                                                      | `findById`, `listByProject`, `listByStatus`, `create`, `updateStatus`, `rollback`, `getLatestForProject`                                                                         |
| `service.repo.ts`                                                                         | `listByProject`, `findById`, `create`, `update`, `upsert` (for compose re-import), `softDelete`                                                                                  |
| `service-deployment.repo.ts`                                                              | `listByDeployment`, `upsert`, `updateStatus`, `batchUpdate`                                                                                                                      |
| `domain.repo.ts`                                                                          | `findByHostname`, `listByProject`, `create`, `update`, `softDelete`, `listExpiringSsl`                                                                                           |
| `server.repo.ts`                                                                          | `list`, `findById`, `create`, `update`, `delete`                                                                                                                                 |
| `settings.repo.ts`                                                                        | `getInstanceSettings`, `updateInstanceSettings`, `getUserSettings`, `updateUserSettings`                                                                                         |
| `backup.repo.ts`                                                                          | 4 sub-repos: `createBackupDestinationRepo`, `createBackupPolicyRepo`, `createBackupRunRepo`, `createBackupRestoreRepo` — each with full CRUD + FSM transitions + stale-run sweep |
| `notification.repo.ts`                                                                    | 4 sub-repos: `createNotificationChannelRepo`, `createNotificationSubscriptionRepo`, `createNotificationDefaultRepo`, `createNotificationDeliveryRepo`                            |
| `analytics.repo.ts`                                                                       | `upsertBuckets`, `queryBuckets`, `recentBuckets`, `getLastScrapedMinute`, `upsertGeo`, `queryGeo`, `recentGeoDays`                                                               |
| `audit-event.repo.ts`                                                                     | `create`, `listByOrganization` (cursor + offset pagination), `pruneOlderThan`                                                                                                    |
| `billing-anniversary-grant.repo.ts`                                                       | `claim` (insert-or-no-op for idempotency), `findByPeriod`                                                                                                                        |
| `billing-usage-snapshot.repo.ts`                                                          | `upsert`, `findByOrg`                                                                                                                                                            |
| `git-installation.repo.ts`                                                                | `findByInstallationId`, `list`, `create`, `delete`                                                                                                                               |
| `github-install-state.repo.ts`                                                            | OAuth state FSM management                                                                                                                                                       |
| `github-webhook-event.repo.ts`                                                            | Webhook idempotency insert                                                                                                                                                       |
| `cloud-webhook-binding.repo.ts`                                                           | `findByRepo`, `upsert`, `deleteByCloudProject`                                                                                                                                   |
| `cloud-handoff-code.repo.ts`                                                              | `create`, `consume` (DELETE RETURNING), `purgeExpired`                                                                                                                           |
| `server-tunnel.repo.ts`                                                                   | Per-server tunnel CRUD                                                                                                                                                           |
| `server-module-status.repo.ts`                                                            | Module install state tracking                                                                                                                                                    |
| `personal-access-token.repo.ts`                                                           | PAT lifecycle + grant scoping                                                                                                                                                    |
| `personal-access-token-grant.repo.ts`                                                     | Per-PAT resource grants                                                                                                                                                          |
| `resource-grant.repo.ts`                                                                  | Cross-resource permission grants                                                                                                                                                 |
| `route-rule.repo.ts`                                                                      | Route rule CRUD                                                                                                                                                                  |
| `job.repo.ts`                                                                             | Job definition CRUD, `listEnabled`, `updateCron`                                                                                                                                 |
| `job-run.repo.ts`                                                                         | Run history, `listByJob`, `create`, `finish`                                                                                                                                     |
| `terminal-session.repo.ts`                                                                | Terminal session lifecycle                                                                                                                                                       |
| `service-terminal-session.repo.ts`                                                        | Per-service terminal sessions                                                                                                                                                    |
| `invitation.repo.ts`                                                                      | Invitation CRUD, `findByEmail`                                                                                                                                                   |
| `invitation-pending-grant.repo.ts`                                                        | Pending grant management                                                                                                                                                         |
| `member.repo.ts`                                                                          | Team membership CRUD                                                                                                                                                             |
| `organization.repo.ts`                                                                    | Org CRUD, settings                                                                                                                                                               |
| `oauth.repo.ts`                                                                           | OAuth state management                                                                                                                                                           |
| `docker-migration.repo.ts`                                                                | Compose migration tracking                                                                                                                                                       |
| `stripe-topup-grant.repo.ts`                                                              | Stripe topup grant idempotency                                                                                                                                                   |
| `update-status.repo.ts`                                                                   | Software update check tracking                                                                                                                                                   |
| `system-notice.repo.ts`                                                                   | System notice CRUD                                                                                                                                                               |
| `orphaned-resource.repo.ts`                                                               | Orphan GC tracking                                                                                                                                                               |
| `instance-settings.repo.ts`                                                               | Instance settings helpers                                                                                                                                                        |
| `server-github-auth.repo.ts`                                                              | Server GitHub OAuth                                                                                                                                                              |
| `github-deploy-key.repo.ts`                                                               | Deploy key management                                                                                                                                                            |
| `account.repo.ts`                                                                         | OAuth account linking                                                                                                                                                            |
| `session.repo.ts`                                                                         | Auth session management                                                                                                                                                          |
| `normalizeRoutingFields()`, `toComposeSpec()`, `composeSpecsEqual()`, `composeSpecDiff()` | Shared helpers in `deployment.repo.ts`                                                                                                                                           |
| `repos/index.ts`                                                                          | Barrel — instantiates all repos with the shared `db` singleton                                                                                                                   |

##### Migrations (`drizzle/`)

57 sequential SQL migrations generated by `drizzle-kit` covering the full schema evolution. Automatically applied at startup by the database client.

##### Scripts (`scripts/`)

| Script                    | Purpose                        |
| ------------------------- | ------------------------------ |
| `dump.ts`                 | CLI dump command               |
| `restore.ts`              | CLI restore command            |
| `heal-pglite.ts`          | Heal corrupted PGlite database |
| `heal-pglite-resetwal.ts` | Reset PGlite WAL after crash   |
| `heal-orphan-tables.ts`   | Clean orphaned tables          |

##### Exports (`src/index.ts`)

Exports: `db`, `getDriver`, `getPgPool`, `closeDb`, `Database`, `Driver`, `schema` (all tables), `withAdvisoryLock`, `tryAcquireAdvisoryLock`, `hashStringToInt`, `AdvisoryLockHandle`, dump/restore primitives, all repository types, Drizzle SQL operators (eq, and, or, etc.).

#### 6.4h Email Database Layer (`packages/db-email/`)

The `@repo/db-email` package is the **Drizzle ORM schema + client for the email server's own Postgres instance**, separate from HosteraX's main database (`DATABASE_URL`). Connected via `EMAIL_DATABASE_URL`. Depends on `drizzle-orm` and `pg`. Exposes three entry points: `.` (full index), `./schema`, and per-schema subpaths (`./schema/vmail`, `./schema/mail-app`).

Two Postgres schemas live in the same database, independently managed via `schemaFilter: ["vmail", "mail_app"]`:

| Schema     | Purpose                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vmail`    | Byte-faithful port of iRedMail's PostgreSQL schema (20 tables). Postfix and Dovecot SQL maps query these exact table/column names — **do not reshape** |
| `mail_app` | Zero email-client app state (6 tables). FK'd to `vmail.mailbox.username`                                                                               |

##### Client (`src/client.ts` — 53 lines)

Simple lazy singleton pattern — no driver-swapping, no PGlite:

| Export                | Description                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `getEmailDb(config?)` | Returns singleton `NodePgDatabase` bound to `EMAIL_DATABASE_URL` (or passed `config.url`). Lazily creates `pg.Pool` on first call |
| `closeEmailDb()`      | Tears down the pool. For tests and graceful shutdown                                                                              |
| `EmailDatabase`       | `NodePgDatabase<typeof schema>`                                                                                                   |
| `EmailDbConfig`       | `{ url?: string; pool?: Omit<PoolConfig, "connectionString"> }`                                                                   |

##### `vmail` Schema (`src/schema/vmail.ts` — 587 lines, 20 tables)

All tables created under `pgSchema("vmail")`. Column factories: `tsNow()` (TIMESTAMP DEFAULT NOW), `tsNeverExpires()` (TIMESTAMP DEFAULT `'9999-12-31 01:01:01'` — iRedMail sentinel), `activeFlag()` (INT2 DEFAULT 1 — iRedMail boolean pattern).

| Table                  | PK                             | Purpose                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`                | `username` (varchar)           | Admin panel users — password, language, settings, expiry, active flag                                                                                                                                                                                                                                                                                         |
| `alias`                | `address` (varchar)            | Email aliases — domain, access policy, expiry                                                                                                                                                                                                                                                                                                                 |
| `moderators`           | `id` (serial)                  | Mailing list moderators — (address, moderator) unique                                                                                                                                                                                                                                                                                                         |
| `maillist_owners`      | `id` (serial)                  | Mailing list owners — (address, owner) unique                                                                                                                                                                                                                                                                                                                 |
| `forwardings`          | `id` (serial)                  | Unified: alias members, per-account aliases, per-user forwards — (address, forwarding) unique; discriminated by `is_maillist`/`is_list`/`is_forwarding`/`is_alias` flags                                                                                                                                                                                      |
| `domain`               | `domain` (varchar)             | Mail domains — aliases/mailboxes/maillists counts, maxquota, quota, transport (default `dovecot`), backupmx flag                                                                                                                                                                                                                                              |
| `alias_domain`         | `alias_domain` (varchar)       | Domain aliases — maps alias_domain → target_domain                                                                                                                                                                                                                                                                                                            |
| `domain_admins`        | (username, domain) composite   | Per-domain admin assignments — username + domain PK                                                                                                                                                                                                                                                                                                           |
| `mailbox`              | `username` (varchar)           | **Core table (50+ columns)** — full mailbox config: password, name, language, names, mobile, quota, transport, department, rank, employeeid; 30+ protocol enable flags; **3 hyphenated columns** preserved verbatim (`enablelib-storage`, `enablequota-status`, `enableindexer-worker`) for Dovecot compatibility; SOGo toggles as `varchar(1)` (`'y'`/`'n'`) |
| `maillists`            | `id` (serial)                  | Mailing lists — address unique, transport, access policy, max message size, MLID unique, newsletter flag                                                                                                                                                                                                                                                      |
| `sender_bcc_domain`    | `domain` (varchar)             | Domain-level sender BCC — domain → bcc_address                                                                                                                                                                                                                                                                                                                |
| `sender_bcc_user`      | `username` (varchar)           | User-level sender BCC — username → bcc_address                                                                                                                                                                                                                                                                                                                |
| `recipient_bcc_domain` | `domain` (varchar)             | Domain-level recipient BCC                                                                                                                                                                                                                                                                                                                                    |
| `recipient_bcc_user`   | `username` (varchar)           | User-level recipient BCC                                                                                                                                                                                                                                                                                                                                      |
| `sender_relayhost`     | `id` (serial)                  | Per-account relay host override — account unique                                                                                                                                                                                                                                                                                                              |
| `deleted_mailboxes`    | `id` (serial)                  | Tombstone log — username, domain, maildir, byte/message count, admin who deleted, delete_date                                                                                                                                                                                                                                                                 |
| `share_folder`         | (from_user, to_user) composite | IMAP shared folder permissions                                                                                                                                                                                                                                                                                                                                |
| `anyone_shares`        | `from_user` (varchar)          | IMAP public shares                                                                                                                                                                                                                                                                                                                                            |
| `last_login`           | (username, domain) composite   | Dovecot-written login timestamps — imap, pop3, lda timestamps                                                                                                                                                                                                                                                                                                 |
| `used_quota`           | `username` (varchar)           | Dovecot-written quota — bytes, messages, domain (DO NOT mutate from app code)                                                                                                                                                                                                                                                                                 |

Note: 3 columns in `mailbox` use hyphenated SQL names (`enablelib-storage`, `enablequota-status`, `enableindexer-worker`) — Dovecot's `dovecot-sql.conf` references them verbatim. Drizzle preserves the literal name in DDL.

##### `mail_app` Schema (`src/schema/mail_app.ts` — 192 lines, 6 tables)

All tables created under `pgSchema("mail_app")`. Every table FKs `username` → `vmail.mailbox.username` (CASCADE).

| Table                  | PK                   | Purpose                                                                                                         |
| ---------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `user_settings`        | `username` (varchar) | Per-user UI preferences as JSONB (replaces upstream Zero's `mail0_user_settings`)                               |
| `user_hotkeys`         | `username` (varchar) | Per-user keyboard shortcut customizations as JSONB                                                              |
| `summary`              | `message_id` (text)  | AI-generated message summaries — content, saved flag, tags, suggested reply; indexed by (username, saved)       |
| `note`                 | `id` (text)          | Notes attached to email threads — thread_id, content, color, is_pinned, order; indexed by (username, thread_id) |
| `writing_style_matrix` | `username` (varchar) | AI compose-helper style profile — num_messages, style (JSONB)                                                   |
| `email_template`       | `id` (text)          | Saved email templates — name, subject, body, to (JSONB), cc (JSONB); indexed by username                        |

##### Exports (`src/index.ts`)

Re-exports all vmail + mail_app schemas + `getEmailDb`, `closeEmailDb`, `EmailDatabase`, `EmailDbConfig`.

### 6.23 Database Dump & Restore Subsystem

A standalone 790-line module (`packages/db/src/dump.ts`) providing:

| Feature                 | Details                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Dump flavors**        | 3 scope types: `data_only` (no schema), `schema_only` (no data), `full` (schema + data)                            |
| **Catalogue ordering**  | FK-ordered table list ensures referential integrity on restore — tables with no FK dependencies are restored first |
| **Encrypted redaction** | AES-256-GCM encryption for sensitive data in dumps, with configurable redaction rules                              |
| **Compression**         | gzip compression for dump output                                                                                   |
| **Restore modes**       | 3 restore scopes matching dump flavors, with pre-restore validation                                                |
| **Scope validation**    | Validates dump scope against requested restore scope                                                               |

### 6.23a DB Maintenance Scripts (`packages/db/scripts/`)

| Script                    | Purpose                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `dump.ts`                 | Standalone DB dump tool — 3 scope types (instance/org/project), optional encrypted-strip, FK-ordered tables   |
| `restore.ts`              | Standalone DB restore — wipe mode (drop+recreate) or merge mode; optional org remapping                       |
| `heal-orphan-tables.ts`   | Drops orphaned cloud tables (`cloud_edge_proxy`, `cloud_page`) left by prior schema versions                  |
| `heal-pglite.ts`          | PGlite crash recovery: backup data dir, remove stale `.lock` file, truncate WAL, restart instance             |
| `heal-pglite-resetwal.ts` | Deep PGlite recovery: copy data dir, run `pg_resetwal`, verify via temporary PGlite instance, swap on success |

### 6.24 Build & Release Scripts (`scripts/`)

| Script             | Lines | Purpose                                                                              |
| ------------------ | ----- | ------------------------------------------------------------------------------------ |
| `install.sh`       | 113   | **Unix shell installer** — `curl -fsSL https://get.hosterax.io \| sh`                |
| `install.ps1`      | 40    | **Windows PowerShell installer** — `irm ...install.ps1 \| iex`                       |
| `release.ts`       | 411   | **Release automation** — `bun scripts/release.ts patch\|minor\|major\|rc\|<version>` |
| `update-geoip.mjs` | 39    | **GeoIP database refresh** — `bun run update:geoip`                                  |

#### `install.sh` (113 lines)

One-liner installer for macOS/Linux. Autodetects and installs Bun runtime if missing (no Node/npm needed), then globally installs the `hosterax` CLI via `bun add -g`.

| Feature                   | Description                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun runtime**           | Installs via `curl -fsSL https://bun.sh/install \| bash` if `bun` not on PATH                                                                         |
| **`unzip` auto-install**  | Checks for `unzip` before running Bun's installer; installs via apt-get/dnf/yum/apk/pacman/zypper with sudo detection                                 |
| **Version pinning**       | `HOSTERAX_VERSION=0.1.9` env var pins a specific CLI version                                                                                          |
| **Heal broken installs**  | Detects pre-fix installer clobber (issue #21) by checking first line of `dist/index.js` for `#!/bin/sh` shebang — force-clean + reinstall             |
| **Bun-only fallback**     | When `node` is absent, rewrites the global bin symlink to a shell wrapper that execs under Bun directly; unlinks first to avoid self-referential loop |
| **Post-install guidance** | Prints next steps: `hosterax up`, `hosterax --help`, PATH setup                                                                                       |

#### `install.ps1` (40 lines)

Windows counterpart to `install.sh` — PowerShell one-liner installer.

| Feature                   | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| **Bun runtime**           | Installs via `Invoke-RestMethod https://bun.sh/install.ps1 \| Invoke-Expression` |
| **PATH update**           | Adds `$env:USERPROFILE\.bun\bin` to current session's PATH                       |
| **Version pinning**       | `$env:HOSTERAX_VERSION = "0.1.9"` for a specific version                         |
| **Post-install guidance** | Prints next steps: `hosterax up`, `hosterax install`, `hosterax --help`          |

#### `release.ts` (411 lines)

Full release automation script run via `bun scripts/release.ts`. Orchestrates version bumping, git operations, tag creation, and CI monitoring.

| Step                             | Description                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bump kinds**                   | `patch` (0.1.0→0.1.1), `minor` (0.1.0→0.2.0), `major` (0.1.0→1.0.0), `rc` (0.1.0→0.1.1-rc.1, rc→rc bump, rc→stable promotion), `current` (tag as-is, no bump), `<literal>` (explicit semver) |
| **Pre-flight checks**            | Dirty working tree guard, non-main branch guard (override with `--force-branch`), behind-origin guard, tag-already-exists check (local + remote)                                             |
| **Version sync**                 | Updates 6 `package.json` files: root, `apps/api`, `apps/desktop`, `apps/web`, `apps/email`, `apps/cli`                                                                                       |
| **Version drift detection**      | Warns if root and API versions differ; bumps from API's operative value                                                                                                                      |
| **Surgical version replacement** | Regex-based in-place update preserves formatting + trailing newline (no full re-serialization / noisy diffs)                                                                                 |
| **Git automation**               | `git add` → `git commit` (skip on no-op) → `git push` → `git tag` → `git push --tags`                                                                                                        |
| **CI monitoring**                | Polls `gh run list` for the tag-triggered workflow run; streams live build status via `gh run watch`; degrades gracefully if `gh` CLI missing                                                |
| **Prerelease detection**         | Tags containing `-` (rc.N, beta.N) trigger GitHub prerelease semantics                                                                                                                       |
| **Dry-run mode**                 | `--dry-run` prints plan without touching files or git                                                                                                                                        |
| **`tagExists()`**                | Checks local tag list + remote `ls-remote` to prevent duplicate tags                                                                                                                         |

#### `update-geoip.mjs` (39 marks)

Vendored GeoLite2-Country database refresh script. Committed file at `apps/api/assets/geoip/GeoLite2-Country.mmdb` is the production source of truth.

| Feature               | Description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Source**            | Default: P3TERX/GeoLite.mmdb GitHub mirror. Override via `GEOIP_UPSTREAM_URL` env var |
| **Size guard**        | Refuses to write file under 1MB (corruption detection)                                |
| **Output**            | Writes to `apps/api/assets/geoip/GeoLite2-Country.mmdb`                               |
| **Creates directory** | `mkdir -p` the geoip asset directory if absent                                        |
| **Companion script**  | Runs at maintainer/CI time, never on customer servers                                 |

### 6.25 Deploy Fixtures (`fixtures/deploy/`)

**Purpose:** Minimal "hello world on `$PORT`" apps — one per stack family — used to validate that stack detection produces the correct recipe (toolchain, package manager, install/build/start commands, output/production paths, port). Each app binds the `PORT` env var, responds `200` on `/`, and is intentionally tiny — just enough to exercise detection and real build+deploy+probe smoke tests across docker / bare / cloud runtimes. Recipe assertions live in `apps/api/test/lib/language-detectors.test.ts`. Wrappers (`mvnw`/`gradlew`) are omitted to stay source-only.

| #   | Stack                  | Files                                                                                                        | Key Characteristics                                                                                        |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | **Node.js**            | `node/package.json`, `node/server.js`                                                                        | `cjs` entry (`"main": "server.js"`), `"start": "node server.js"`, default port 3000, plain `http` module   |
| 2   | **Go**                 | `go/go.mod`, `go/main.go`                                                                                    | `go 1.22`, `net/http` stdlib, default port 8080, `os.Getenv("PORT")`                                       |
| 3   | **Python (FastAPI)**   | `python-fastapi/main.py`, `python-fastapi/requirements.txt`                                                  | FastAPI `0.111.0`, uvicorn `0.30.1`, `@app.get("/")`, dict response                                        |
| 4   | **Rust (Axum)**        | `rust-axum/Cargo.toml`, `rust-axum/src/main.rs`                                                              | Edition 2021, axum `0.7`, tokio `1` with full features, `TcpListener::bind`                                |
| 5   | **Laravel (PHP)**      | `laravel/composer.json`, `laravel/artisan`, `laravel/public/index.php`                                       | PHP `^8.2`, Laravel `^11.0`, artisan CLI entrypoint, `public/` docroot w/ inline echo                      |
| 6   | **Spring Boot (Java)** | `springboot/pom.xml`, `springboot/src/.../DemoApplication.java`, `springboot/src/.../application.properties` | Spring Boot `3.3.1`, Java 21, `spring-boot-starter-web`, `server.port=\${PORT:8080}`                       |
| 7   | **Kotlin (JVM)**       | `kotlin/build.gradle.kts`, `kotlin/settings.gradle.kts`, `kotlin/src/.../Main.kt`                            | Kotlin `2.0.0`, Gradle application plugin, fat-jar `build/libs/*.jar`, `com.sun.net.httpserver.HttpServer` |
| 8   | **.NET**               | `dotnet/Program.cs`, `dotnet/HelloApi.csproj`                                                                | .NET 8, minimal API (`WebApplication.CreateBuilder`), port via `ASPNETCORE_URLS`                           |

---

### 6.26 Marketing Website & Docs (`apps/web/`)

**Purpose:** The public-facing Next.js application serving as the marketing site, documentation portal, changelog, resources blog, and download center for HosteraX. Built with Next.js 16 (React 19), Tailwind CSS v4, Fumadocs MDX documentation system, and GSAP scroll-driven animations. Contains ~120 source files organized into landing components, marketing pages, product landing pages (Mail), hook utilities, library modules, style sheets, docs infrastructure, and API routes.

#### 6.26.1 Landing Page Components (`src/components/landing/`) — 13 Components

| #   | Component          | Description                                                                                                                                                                                                                                      |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Navbar`           | Fixed top navigation bar with logo, nav links (Features, How It Works, Deployment Models, Open Source, Pricing, Docs, Download), CTA buttons (Get Started / Sign In), gradient accent line                                                       |
| 2   | `Hero`             | Full-viewport hero section with animated headline ("Ship apps. Not config files."), subheading, CTA buttons (Start Deploying / View on GitHub), stats bar (3K+ GitHub stars, 42+ Stacks, 100% Open Source), and animated terminal preview mockup |
| 3   | `Features`         | 3-column feature grid (6 feature cards): Zero-Config Deploys, Auto SSL & Domains, Database & Services, Built-in CDN, Team Collaboration, Monitoring & Logs. Each card has an icon, title, description, and gradient accent border                |
| 4   | `HowItWorks`       | 4-step vertical timeline: Connect Server, Import Project, Deploy with One Click, Manage & Scale. Each step has a numbered badge, icon, title, description, and optional screenshot mockup                                                        |
| 5   | `Dashboard`        | Full-width dashboard preview section showing a styled browser frame with tab bar, sidebar, and content area. Animated with GSAP scroll-triggered entry                                                                                           |
| 6   | `DeploymentModels` | 2-column comparison: Desktop App (local control plane, SSH-driven, Electron) vs Self-Hosted Server (always-on team deployment, Docker Compose, auth). Each card has an icon, feature list, and styled background                                 |
| 7   | `CompletePlatform` | 6-column icon grid showing all managed services: Postgres, MySQL, MongoDB, Redis, Cron Jobs, Workers, WebSockets, Object Storage, Mail Server, SSL, CDN, Logs. Gradient card with grid dots background                                           |
| 8   | `MailServer`       | Dedicated Mail Server product card with envelope icon, feature list (Custom Domains, DKIM/SPF/DMARC, Catch-All, Webmail, SMTP/API), and "Learn More" link pointing to `/mail`                                                                    |
| 9   | `Comparison`       | 3-column comparison table: Traditional Hosting vs Cloud Platforms vs HosteraX. Rows for Setup Time, Config Files, SSL, Database, Scaling, Cost Control, Data Ownership, Open Source                                                              |
| 10  | `OpenSource`       | Open-source pitch section with stats (3K+ stars on GitHub, Apache 2.0 License, 100+ contributors), GitHub star button, and feature badges                                                                                                        |
| 11  | `FinalCta`         | Bottom call-to-action banner with gradient background, headline, subheading, and dual CTA buttons                                                                                                                                                |
| 12  | `DarkSection`      | Utility component — full-width dark section wrapper with shared layout and accent styling                                                                                                                                                        |
| 13  | `Footer`           | Multi-column site footer with logo/description, product links, resources, company info, and social links. Bottom bar with copyright, terms, privacy, status                                                                                      |

#### 6.26.2 Style System (`src/styles/`) — 4 Files

| File          | Purpose                                                                                                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts.css`   | Custom font stack: **Gellix** (variable wght 400–700, wdth 75–100, via CDN `cdn.jsdelivr.net`) for headings/body; **SF Arabic** (via Apple CDN) for Arabic locale support; system font fallbacks                                                                                                         |
| `theme.css`   | Design token system via CSS custom properties (`--th-*`): color tokens (bg, fg, muted, accent, brand, border, card, success/warning/error/danger), radius scale (--radius-xs through --radius-full), font sizes (--text-xs through --text-7xl), spacing/container variables, backdrop blur, shadows      |
| `landing.css` | Landing page animations and decorative effects: aurora gradient animation, grid background pattern, gradient card accent overlay, feature card hover glow, nav blur backdrop, animated scroll indicators, fade-in-up keyframes                                                                           |
| `globals.css` | Global app sheet: imports `theme.css`, `fonts.css`, `landing.css`; Tailwind v4 `@import "tailwindcss"`; `@layer base` with `--th-*` on `:root`; `@layer components` with window controls, scrollbar, selection, focus ring, gradient text, prose styles for docs; print and reduced-motion media queries |

#### 6.26.3 Custom Hooks (`src/hooks/`) — 2 Hooks

| Hook              | Purpose                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-platform`    | Platform detection hook for the download page: returns `platform` (win32, darwin, linux, linux-arm64), `isSupported`, and `isMobile`. Uses `navigator.userAgent` parsing; defaults to `win32` on server-side                      |
| `use-gsap-scroll` | GSAP scroll-driven animation hook: accepts `GSAPAnimationOptions` (from, to, scrollTrigger config), returns a `ref` to attach to the target element. Abstracts `gsap.fromTo()` + `ScrollTrigger.create()` with cleanup on unmount |

#### 6.26.4 Library Modules (`src/lib/`) — 4 Files

| File                 | Purpose                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `og-image.tsx`       | OG image generator for Next.js `@vercel/og` ImageResponse: renders product name, tagline, gradient background, and "hosteraX" branding. Used by root layout metadata                                                                                 |
| `source.ts`          | Fumadocs content loaders: `docs` (from `content/docs/`), `resources` (from `content/resources/`), `changelog` (from `content/changelog/`). Re-exports `loader` from `fumadocs-core/source`                                                           |
| `sitemap-builder.ts` | Static sitemap XML builder: generates `<url>` entries for all marketing pages (/, /pricing, /about, /contact, /privacy, /terms, /trust, /roadmap, /download, /docs, /changelog, /resources, /mail) with weekly changefreq and appropriate priorities |
| `llms.ts`            | LLM catalog for AI crawlers: builds `llms.txt` and `llms-full.txt` content arrays with title, description, and URL path for every page. Exports `llmsTxt`, `llmsFullTxt`, and `getDocsRawPaths()`                                                    |

#### 6.26.5 Mail Product Landing Page (`src/app/(site)/(marketing)/mail/`) — 7 Components

| Component     | File                           | Description                                                                                                                                                                                                                                              |
| ------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HomeContent` | `page.tsx`                     | Main mail landing page — dark-themed hero with animated grid/particle background, headline ("Mail Server. Take control of your email."), feature cards (Custom Domains, DKIM/SPF/DMARC, Catch-All, Webmail, SMTP/API), CTA "Start Deploying", and footer |
| `Button`      | `_components/button.tsx`       | Dark-theme button component with `variant` (primary, secondary, destructive, ghost) and `size` (sm, md, lg, icon)                                                                                                                                        |
| `Tabs`        | `_components/tabs.tsx`         | Tabs component with `TabsList`, `TabsTrigger`, `TabsContent` sub-components; active indicator underline animation                                                                                                                                        |
| `Icons`       | `_components/icons.tsx`        | SVG icon components for Mail Server page: `EnvelopeIcon`, `ShieldIcon`, `ServerIcon`, `GlobeIcon`, `CodeIcon`, `InboxIcon`, `HosteraXIcon`                                                                                                               |
| `cn`          | `_components/cn.ts`            | Tailwind class merge utility (clsx + tailwind-merge)                                                                                                                                                                                                     |
| `PixelatedBg` | `_components/pixelated-bg.tsx` | Canvas-based animated pixel/grid background effect for the mail hero section                                                                                                                                                                             |
| `Footer`      | `_components/footer.tsx`       | Dark-theme footer for mail page: logo, description, product/resources/company link columns, copyright with privacy/terms                                                                                                                                 |

#### 6.26.6 Marketing Pages (`src/app/(site)/(marketing)/`) — 11 Pages + 1 Mail Page

| Page           | Route        | Description                                                                                                                                                                                                                                |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing (Home) | `/`          | Main landing page with all 13 landing sections                                                                                                                                                                                             |
| Pricing        | `/pricing`   | Pricing page: Self-hosted plan (Free, "currently unavailable" badge), Cloud plan ("Coming soon"), FAQ accordion section                                                                                                                    |
| About          | `/about`     | About page with company story, mission, and team values                                                                                                                                                                                    |
| Contact        | `/contact`   | Contact form/page with email and social links                                                                                                                                                                                              |
| Privacy        | `/privacy`   | Privacy policy page (static content)                                                                                                                                                                                                       |
| Terms          | `/terms`     | Terms of service page (static content)                                                                                                                                                                                                     |
| Trust          | `/trust`     | Trust/security page with compliance and security practices                                                                                                                                                                                 |
| Roadmap        | `/roadmap`   | Product roadmap and upcoming features                                                                                                                                                                                                      |
| Download       | `/download`  | Download center: platform detection via `use-platform`, OS-specific download buttons (macOS Apple Silicon/Intel, Windows x64, Linux x64/ARM64), CLI install tabs via `InstallTabs` component, desktop app feature highlights, version info |
| Login          | `/login`     | Simple login redirect page — links to dashboard `/auth/login` with "Sign in to your HosteraX dashboard" message                                                                                                                            |
| Mail           | `/mail`      | Mail Server product landing page (see §6.26.5)                                                                                                                                                                                             |
| Changelog      | `/changelog` | Fumadocs-powered changelog from `content/changelog/` MDX files                                                                                                                                                                             |
| Resources      | `/resources` | Fumadocs-powered resources blog from `content/resources/` MDX files                                                                                                                                                                        |

#### 6.26.7 Documentation System (Fumadocs) — 3 Layout Files + MDX Content

| File                                          | Purpose                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/app/(site)/docs/[[...slug]]/page.tsx`    | Fumadocs doc page renderer: loads MDX content from `content/docs/`, renders with `mdx-components`                     |
| `src/app/(site)/docs/layout.tsx`              | Docs layout with sidebar, table of contents, and Fumadocs `DocsLayout` wrapper                                        |
| `src/app/(site)/resources/[...slug]/page.tsx` | Resources blog post renderer                                                                                          |
| `src/app/(site)/resources/layout.tsx`         | Resources layout                                                                                                      |
| `src/app/(site)/changelog/[...slug]/page.tsx` | Changelog entry renderer                                                                                              |
| `src/app/(site)/changelog/layout.tsx`         | Changelog layout                                                                                                      |
| `src/mdx-components.tsx`                      | Global MDX component registration: `Tabs`, `Tab` (Fumadocs), `InstallTabs` (custom one-line installer tabs component) |

#### 6.26.8 API Routes (`src/app/api/`) — 6 Routes

| Route                 | Method   | Purpose                                                                                                                    |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/api/search`         | POST     | Fumadocs full-text search endpoint: accepts `{ query }`, returns structured search results from indexed docs               |
| `/llms.txt`           | GET      | LLM-friendly site index: returns plain text listing of all pages with title and brief description for AI crawler context   |
| `/llms-full.txt`      | GET      | Full LLM content dump: returns comprehensive plain text version of all documentation pages for AI training/crawling        |
| `/sitemap.xml`        | GET      | Dynamic sitemap XML: lists all marketing pages, docs, changelog, and resources with lastmod and priority values            |
| `/docs-raw/[...slug]` | GET      | Raw markdown endpoint: serves MDX source files as plain text for each documentation page, used by the LLM content pipeline |
| `robots.txt`          | (static) | Static robots.txt at `src/app/robots.txt`: allows all crawlers, points to sitemap                                          |

#### 6.26.9 Root Layout & Utility Pages — 5 Files

| File                    | Purpose                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`    | Root layout: imports `globals.css`, sets metadata (title "HosteraX — Ship apps. Not config files.", OG image), wraps children in `<html>` with lang="en" |
| `src/app/not-found.tsx` | Custom 404 page with animated illustration and "Back to Home" link                                                                                       |
| `src/app/page.tsx`      | Root landing page (alias, renders the `(site)/(marketing)/` home page)                                                                                   |
| `src/app/robots.ts`     | Robots.txt generator                                                                                                                                     |
| `src/app/sitemap.ts`    | Sitemap.xml generator (delegates to `sitemap-builder.ts`)                                                                                                |

#### 6.26.10 Content Directories — 3 Directories

| Directory            | Contents                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `content/docs/`      | Fumadocs MDX documentation files — product docs, installation guides, configuration reference |
| `content/resources/` | Fumadocs MDX resource/blog post files                                                         |
| `content/changelog/` | Fumadocs MDX changelog entry files                                                            |

---

### 6.27 Self-hosted Email Application (`apps/email/`)

**Purpose:** A fully self-hosted email solution combining a modern webmail client (Zero) with the battle-tested iRedMail engine (Postfix + Dovecot + Amavisd + ClamAV + SpamAssassin + fail2ban). The client is a React Router 7 SPA with tRPC backend (Express), Drizzle ORM (Postgres), TipTap rich text editor, virtual-scrolled mailbox, keyboard shortcuts, i18n (21 locales), and AI-powered features. The engine provides the underlying SMTP/IMAP/POP3 mail server infrastructure. ~420 source files organized across client, server, engine, and scripts.

#### 6.27.1 Client UI Components (`client/components/ui/`) — 61 Components

| Component                   | Description                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accordion.tsx`             | Collapsible accordion with Radix primitives                                                                                                                              |
| `ai-sidebar.tsx`            | AI assistant sidebar with full-screen toggle, prompt selection, and context-aware thread analysis                                                                        |
| `alert.tsx`                 | Alert dialog with variant styles (default, destructive)                                                                                                                  |
| `animated-number.tsx`       | Animated counting number display (eased transitions)                                                                                                                     |
| `app-sidebar.tsx`           | Main application sidebar: nav sections, compose button, user avatar, dynamic badge counts from stats, collapsible to icon-only mode                                      |
| `avatar.tsx`                | User avatar with fallback initials, image loading states                                                                                                                 |
| `badge.tsx`                 | Badge with variants: default, secondary, important, promotions, personal, updates, forums, success, warning, error                                                       |
| `bimi-avatar.tsx`           | BIMI (Brand Indicators for Message Identification) avatar — displays verified brand logo for DMARC-authenticated senders                                                 |
| `button.tsx`                | Button with variants (primary, secondary, outline, ghost, destructive, link) and sizes (xs, sm, md, lg, icon)                                                            |
| `calendar.tsx`              | Date picker calendar (React DayPicker based)                                                                                                                             |
| `card.tsx`                  | Generic card wrapper with header, content, footer sub-components                                                                                                         |
| `chart.tsx`                 | Data visualization chart component                                                                                                                                       |
| `checkbox.tsx`              | Checkbox input with Radix primitive                                                                                                                                      |
| `collapsible.tsx`           | Collapsible panel with Radix primitive                                                                                                                                   |
| `command.tsx`               | Command palette / search dialog (⌘K) — full keyboard navigable search interface with sections, filters, and actions                                                      |
| `context-menu.tsx`          | Right-click context menu with Radix primitive                                                                                                                            |
| `dialog.tsx`                | Modal dialog with overlay, header, content, footer, title, description — used for compose, settings, labels                                                              |
| `drawer.tsx`                | Bottom drawer component (mobile-friendly alternative to dialog)                                                                                                          |
| `dropdown-menu.tsx`         | Dropdown menu with Radix primitives (checkbox items, separators)                                                                                                         |
| `envelop.tsx`               | Envelope visualization component                                                                                                                                         |
| `form.tsx`                  | Form wrapper with validation integration                                                                                                                                 |
| `gauge.tsx`                 | Circular gauge/progress indicator                                                                                                                                        |
| `input.tsx`                 | Text input field with icon support                                                                                                                                       |
| `input-otp.tsx`             | One-time password input (split digits)                                                                                                                                   |
| `label.tsx`                 | Form label component                                                                                                                                                     |
| `navigation-menu.tsx`       | Navigation menu component                                                                                                                                                |
| `nav-main.tsx`              | Main sidebar navigation — renders nav items with icons, badges, shortcut hints, active state highlighting, collapsible sections                                          |
| `nav-user.tsx`              | User avatar + dropdown in sidebar — session info, theme toggle, sign out                                                                                                 |
| `page-header.tsx`           | Page header with title, description, actions                                                                                                                             |
| `popover.tsx`               | Dismissible popover with Radix primitive                                                                                                                                 |
| `pricing-dialog.tsx`        | Pricing plan upsell dialog — triggered for premium features behind paywall                                                                                               |
| `pricing-switch.tsx`        | Monthly/yearly billing toggle switch                                                                                                                                     |
| `progress.tsx`              | Progress bar component                                                                                                                                                   |
| `prompts-dialog.tsx`        | AI prompt management dialog — browse, select, and configure system prompts for AI assistant                                                                              |
| `radio-group.tsx`           | Radio button group with Radix primitive                                                                                                                                  |
| `recipient-autosuggest.tsx` | Email recipient input with autocomplete — to/cc/bcc fields with contact suggestions                                                                                      |
| `recursive-folder.tsx`      | Nested folder tree for IMAP labels — recursive label hierarchy with expand/collapse, count badges                                                                        |
| `resizable.tsx`             | Resizable split panels (horizontal) with auto-save layout to localStorage                                                                                                |
| `responsive-modal.tsx`      | Responsive dialog/drawer — renders as dialog on desktop, drawer on mobile                                                                                                |
| `scroll-area.tsx`           | Custom scrollable area with styled scrollbar                                                                                                                             |
| `select.tsx`                | Select dropdown with Radix primitive                                                                                                                                     |
| `separator.tsx`             | Horizontal/vertical separator line                                                                                                                                       |
| `settings-content.tsx`      | Settings page content wrapper with sections                                                                                                                              |
| `sheet.tsx`                 | Slide-in sheet panel from side                                                                                                                                           |
| `sidebar.tsx`               | Sidebar framework component — collapsible sidebar with header, content, footer slots, keyboard shortcut toggle                                                           |
| `sidebar-labels.tsx`        | Label tree in sidebar — renders IMAP labels as nested folders, groups labels by hierarchy, shows unread counts per label, handles Microsoft account bracket-style labels |
| `sidebar-toggle.tsx`        | Sidebar collapse/expand toggle button                                                                                                                                    |
| `skeleton.tsx`              | Loading skeleton placeholder                                                                                                                                             |
| `spinner.tsx`               | Loading spinner animation                                                                                                                                                |
| `switch.tsx`                | Toggle switch with Radix primitive                                                                                                                                       |
| `tabs.tsx`                  | Tab strip with Radix primitive                                                                                                                                           |
| `textarea.tsx`              | Multi-line text input                                                                                                                                                    |
| `text-shimmer.tsx`          | Animated shimmer text effect                                                                                                                                             |
| `toast.tsx`                 | Toast notification system (sonner-based)                                                                                                                                 |
| `toggle.tsx`                | Toggle button with Radix primitive                                                                                                                                       |
| `toggle-group.tsx`          | Group of toggle buttons                                                                                                                                                  |
| `tooltip.tsx`               | Tooltip with Radix primitive                                                                                                                                             |

#### 6.27.2 Mail Components (`client/components/mail/`) — 19 Components

| Component                     | Description                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail.tsx`                    | Main mail layout — resizable split panel (mail list + thread display), search bar, category dropdown, command palette trigger, bulk selection mode, keyboard scope management (mail-list vs thread-display), mailto protocol handler registration                                                                                                 |
| `mail-list.tsx`               | Virtual-scrolled mail list (virtua VList) — infinite scroll with pagination, keyboard navigation (arrow keys), multi-select (Ctrl/Shift/Alt+Shift), thread rows with star/important hover actions, draft rows with delete, BIMI avatars, reply count badges, optimistic UI for star/important/read, search highlighting, category label filtering |
| `mail-display.tsx`            | Individual email display — render sender, recipients, subject, date, body (sanitized HTML), attachment list, unsubscribe link detection, print support                                                                                                                                                                                            |
| `mail-content.tsx`            | Email content body renderer                                                                                                                                                                                                                                                                                                                       |
| `thread-display.tsx`          | Full thread view — chronological message list with expand/collapse, reply/forward/reply-all composers, snooze button, archive/delete/spam actions, print, mark unread, note panel, attachment dialog, unsubscribe detection, keyboard shortcuts                                                                                                   |
| `thread-subject.tsx`          | Thread subject line with label badges                                                                                                                                                                                                                                                                                                             |
| `reply-composer.tsx`          | Inline reply composer — to/cc/bcc fields, rich text editor (TipTap), send/ discard, schedule send option                                                                                                                                                                                                                                          |
| `note-panel.tsx`              | Per-thread notes panel — add, edit, delete notes attached to email threads                                                                                                                                                                                                                                                                        |
| `attachment-dialog.tsx`       | Attachment viewer dialog — image preview, file download, inline display                                                                                                                                                                                                                                                                           |
| `attachments-accordion.tsx`   | Collapsible attachment list in email display                                                                                                                                                                                                                                                                                                      |
| `snooze-dialog.tsx`           | Snooze picker — schedule email to reappear later (later today, tonight, tomorrow, this weekend, next week, custom date)                                                                                                                                                                                                                           |
| `render-labels.tsx`           | Label badge renderer — colored badges for IMAP labels (inbox, starred, important, spam, trash, sent, draft)                                                                                                                                                                                                                                       |
| `select-all-checkbox.tsx`     | Select all / none checkbox for bulk operations                                                                                                                                                                                                                                                                                                    |
| `data.tsx`                    | Mail data utilities and constants                                                                                                                                                                                                                                                                                                                 |
| `optimistic-thread-state.tsx` | Optimistic state management for threads — tracks starred, important, read/unread, hidden, label changes with instant UI feedback before server confirms                                                                                                                                                                                           |
| `navbar.tsx`                  | Mail section navigation bar                                                                                                                                                                                                                                                                                                                       |
| `mail-skeleton.tsx`           | Loading skeleton for mail display                                                                                                                                                                                                                                                                                                                 |
| `use-do-state.ts`             | State management utility for parallel optimistic + confirmed state                                                                                                                                                                                                                                                                                |
| `use-mail.ts`                 | Jotai atom-based mail state — selected thread, bulk selected IDs, composer open states (reply, reply-all, forward), image display toggle                                                                                                                                                                                                          |

#### 6.27.3 Compose & Editor (`client/components/create/`) — 19 Components

| Component                        | Description                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email-composer.tsx`             | Full email composer dialog — to/cc/bcc with autocomplete, subject, rich text body (TipTap), attachments, AI compose, schedule send, save draft, discard, toolbar                         |
| `editor.tsx`                     | TipTap rich text editor — bold, italic, underline, strikethrough, headings, bullet list, ordered list, blockquote, code block, link, image, horizontal rule, undo/redo, placeholder text |
| `create-email.tsx`               | Create email entry point — manages draft loading/saving, AI compose integration, template selection, sends via SMTP                                                                      |
| `ai-textarea.tsx`                | AI-powered textarea — sends partial content to LLM for smart compose suggestions                                                                                                         |
| `toolbar.tsx`                    | Editor toolbar — formatting buttons, link insert, image upload, clear formatting                                                                                                         |
| `editor-buttons.tsx`             | Individual editor toolbar buttons (bold, italic, link, etc.)                                                                                                                             |
| `editor.colors.tsx`              | Editor color palette selection                                                                                                                                                           |
| `editor.text-buttons.tsx`        | Text style selector buttons                                                                                                                                                              |
| `editor-menu.tsx`                | Editor slash-command menu                                                                                                                                                                |
| `editor-autocomplete.ts`         | Editor autocomplete plugin                                                                                                                                                               |
| `extensions.ts`                  | TipTap extension configuration — link, image, placeholder, code-block lowlight, text-align, color, highlight, subscript, superscript, task-list, table, horizontal-rule                  |
| `email-phrases.ts`               | Common email phrase suggestions                                                                                                                                                          |
| `template-button.tsx`            | Email template selector — load pre-defined email templates                                                                                                                               |
| `schedule-send-picker.tsx`       | Date/time picker for scheduled send — calendar + time slot selection                                                                                                                     |
| `slash-command.tsx`              | Slash (/) command menu in editor — insert blocks (heading, list, quote, code, divider, image)                                                                                            |
| `image-compression-settings.tsx` | Image compression configuration before upload                                                                                                                                            |
| `uploaded-file-icon.tsx`         | File type icon for attachments (PDF, image, archive, document)                                                                                                                           |
| `ghost-text.css`                 | Ghost/placeholder text styling for editor                                                                                                                                                |
| `prosemirror.css`                | ProseMirror editor core styles                                                                                                                                                           |

#### 6.27.4 Icons & Visual Components — 5 Files

| File                            | Description                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icons/icons.tsx`               | 30+ custom SVG icon components for mail UI: Inbox, Archive, Bin, Star2, ExclamationCircle, Folder, Plane2, Clock, Lightning, Mail, Tag, User, ScanEye, Bell, Search, PencilCompose, Reply, ThreeDots, X, Check, GroupPeople, Stars, Tabs, SettingsGear, ArrowLeft, Sheet, LockIcon, Archive2, ArchiveX, Folders, Printer, Trash, RefreshCcw, and more |
| `icons/animated/moon.tsx`       | Animated moon icon (theme toggle)                                                                                                                                                                                                                                                                                                                     |
| `icons/animated/sun.tsx`        | Animated sun icon (theme toggle)                                                                                                                                                                                                                                                                                                                      |
| `icons/animated/square-pen.tsx` | Animated compose icon                                                                                                                                                                                                                                                                                                                                 |
| `icons/empty-state-svg.tsx`     | Empty mailbox illustration SVG                                                                                                                                                                                                                                                                                                                        |

#### 6.27.5 Context Providers (`client/components/context/`) — 5 Contexts

| Context                       | Description                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `command-palette-context.tsx` | Command palette state — search query, active filters, filter management (add/remove/clear), search mode toggling        |
| `label-sidebar-context.tsx`   | Label sidebar visibility and management                                                                                 |
| `loading-context.tsx`         | Global loading state management                                                                                         |
| `sidebar-context.tsx`         | Sidebar collapse state, toggle, and responsive behavior                                                                 |
| `thread-context.tsx`          | Thread right-click context menu — archive, delete, mark spam, mark read/unread, star, important, snooze, move to folder |

#### 6.27.6 Additional Components — 4 Files

| File                                    | Description                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `party.tsx`                             | Canvas-confetti celebration effect (triggered on send/action complete)  |
| `responsive-modal.tsx`                  | Reusable responsive dialog/drawer wrapper                               |
| `keyboard-layout-indicator.tsx`         | Visual keyboard layout helper (shows active shortcuts on screen)        |
| `labels/label-dialog.tsx`               | Label creation/editing dialog — name, color picker, visibility settings |
| `connection/add.tsx`                    | Add email connection dialog                                             |
| `cookies/cookie-trigger.tsx`            | Cookie consent banner trigger                                           |
| `settings/settings-card.tsx`            | Settings page card component with icon, title, description, action      |
| `theme/theme-switcher.tsx`              | Theme switcher (light/dark/system)                                      |
| `theme/sidebar-theme-switcher.tsx`      | Theme switcher in sidebar                                               |
| `theme/theme-toggle.tsx`                | Quick theme toggle button                                               |
| `providers/editor-provider.tsx`         | TipTap editor provider wrapping editor context                          |
| `providers/hotkey-provider-wrapper.tsx` | Keyboard shortcut provider wrapper                                      |
| `magicui/file-tree.tsx`                 | File tree component for label hierarchy                                 |
| `motion-primitives/text-effect.tsx`     | Motion animation text effect                                            |

#### 6.27.7 Client Application Pages (`client/app/`) — 27 Files

| Route                            | File                                                      | Description                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                              | `page.tsx`                                                | Root redirect to `/mail/inbox`                                                                                                                                        |
| `/login`                         | `(auth)/login/page.tsx`                                   | Login page — email/password form, session handling, auth verification                                                                                                 |
|                                  | `(auth)/login/login-client.tsx`                           | Login client logic — credential submission, error display, redirect on success                                                                                        |
|                                  | `(auth)/login/error-message.tsx`                          | Login error message display                                                                                                                                           |
| `/mail`                          | `(routes)/mail/layout.tsx`                                | Mail layout — HotkeyProvider + AppSidebar + Outlet                                                                                                                    |
| `/mail`                          | `(routes)/mail/page.tsx`                                  | Redirects to `/mail/inbox`                                                                                                                                            |
| `/mail/inbox`                    | `(routes)/mail/[folder]/page.tsx`                         | Dynamic folder page — renders MailLayout with folder param (inbox, sent, draft, spam, bin, starred, important, snoozed, archive)                                      |
| `/mail/compose`                  | `(routes)/mail/compose/page.tsx`                          | Compose page — full-screen email composer                                                                                                                             |
| `/mail/create`                   | `(routes)/mail/create/page.tsx`                           | Create email page                                                                                                                                                     |
| `/mail/under-construction/:path` | `(routes)/mail/under-construction/[path]/page.tsx`        | Placeholder for unfinished features                                                                                                                                   |
|                                  | `(routes)/mail/under-construction/[path]/back-button.tsx` | Back button for under-construction pages                                                                                                                              |
| `/settings`                      | `(routes)/settings/layout.tsx`                            | Settings layout — sidebar navigation between settings sections                                                                                                        |
| `/settings`                      | `(routes)/settings/page.tsx`                              | Settings overview/redirect                                                                                                                                            |
| `/settings/general`              | `(routes)/settings/general/page.tsx`                      | General settings — display name, email signature, auto-read, language, timezone                                                                                       |
| `/settings/appearance`           | `(routes)/settings/appearance/page.tsx`                   | Appearance settings — theme (light/dark/system), sidebar density, font size, avatar style                                                                             |
| `/settings/labels`               | `(routes)/settings/labels/page.tsx`                       | Label management — create/edit/delete labels, assign colors, manage visibility                                                                                        |
|                                  | `(routes)/settings/labels/colors.ts`                      | Label color definitions                                                                                                                                               |
| `/settings/notifications`        | `(routes)/settings/notifications/page.tsx`                | Notification preferences                                                                                                                                              |
| `/settings/privacy`              | `(routes)/settings/privacy/page.tsx`                      | Privacy settings — remote content blocking, read receipts, tracking protection                                                                                        |
| `/settings/security`             | `(routes)/settings/security/page.tsx`                     | Security settings — change password, session management, 2FA                                                                                                          |
| `/settings/shortcuts`            | `(routes)/settings/shortcuts/page.tsx`                    | Keyboard shortcut configuration — customize key bindings for all mail actions                                                                                         |
|                                  | `(routes)/settings/shortcuts/hotkey-recorder.tsx`         | Hotkey recording input component                                                                                                                                      |
| `/settings/*`                    | `(routes)/settings/[...settings]/page.tsx`                | Catch-all settings page                                                                                                                                               |
| `/developer`                     | `(routes)/developer/page.tsx`                             | Developer tools / API playground                                                                                                                                      |
| —                                | `root.tsx`                                                | App root — HTML shell, meta tags, favicon, manifest, theme-color, error boundary (404, error states), session handling, tRPC client setup, Toaster, ScrollRestoration |
| —                                | `entry.client.tsx`                                        | Client entry point — React Router hydration                                                                                                                           |
| —                                | `entry.server.tsx`                                        | Server entry point — React Router SSR                                                                                                                                 |
| —                                | `routes.ts`                                               | Route config — defines all routes with layouts and prefixes                                                                                                           |
| —                                | `globals.css`                                             | Global styles — Tailwind v4, CSS variables, dark/light theme tokens, scrollbar styling, ProseMirror editor styles                                                     |
| —                                | `instrument.ts`                                           | Client instrumentation / monitoring                                                                                                                                   |
| —                                | `mailto-handler.ts`                                       | Mailto protocol handler — registers `mailto:` handler, parses URL params, creates draft, redirects to compose                                                         |
| —                                | `meta-files/not-found.ts`                                 | 404 catch-all handler                                                                                                                                                 |

#### 6.27.8 Client Hooks (`client/hooks/`) — 32 Hooks

| Hook                         | Purpose                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `use-threads.ts`             | Thread data fetching with infinite scroll — folder-scoped queries, pagination, background refresh                                       |
| `use-compose-editor.ts`      | Compose editor state — draft management, editor instance, sending state                                                                 |
| `use-drafts.ts`              | Draft CRUD — save, update, delete drafts with auto-save                                                                                 |
| `use-optimistic-actions.ts`  | Optimistic UI updates — star, important, mark read, archive, delete, move, snooze, delete draft; instant feedback before server confirm |
| `use-labels.ts`              | Label data — fetch, create, update, delete labels with thread label assignments                                                         |
| `use-labels-search.ts`       | Label-based search filtering                                                                                                            |
| `use-settings.ts`            | User settings — fetch and update all settings categories                                                                                |
| `use-hot-key.ts`             | Keyboard key pressed state tracking                                                                                                     |
| `use-mail-navigation.ts`     | Keyboard mail list navigation — arrow key movement, focused index tracking, hover state management                                      |
| `use-media-query.ts`         | Responsive media query hook                                                                                                             |
| `use-mobile.tsx`             | Mobile device detection                                                                                                                 |
| `ui/use-background-queue.ts` | Background task queue UI state                                                                                                          |
| `driver/use-delete.ts`       | Delete operation with undo support                                                                                                      |
| `driver/use-move-to.ts`      | Move-to-folder operation with undo                                                                                                      |
| `use-summary.ts`             | AI email summary generation                                                                                                             |
| `use-notes.tsx`              | Thread notes CRUD                                                                                                                       |
| `use-billing.ts`             | Billing/subscription state                                                                                                              |
| `use-stats.ts`               | Mailbox statistics — unread counts per folder, total counts                                                                             |
| `use-attachments.ts`         | Attachment management — download, preview, inline display                                                                               |
| `use-categories.ts`          | Category/label settings — default category, category configuration                                                                      |
| `use-connections.ts`         | Active email connection state                                                                                                           |
| `use-copy-to-clipboard.ts`   | Clipboard copy utility                                                                                                                  |
| `use-debounce.ts`            | Debounced value hook                                                                                                                    |
| `use-email-aliases.ts`       | Email alias management                                                                                                                  |
| `use-geo-location.ts`        | Geographic location detection                                                                                                           |
| `use-image-loading.ts`       | Image lazy loading state                                                                                                                |
| `use-open-compose-modal.ts`  | Compose modal open state                                                                                                                |
| `use-previous.ts`            | Previous value tracker                                                                                                                  |
| `use-search-value.ts`        | Search query state with highlighting                                                                                                    |
| `use-templates.ts`           | Email template management                                                                                                               |
| `use-undo-send.ts`           | Send undo countdown (configurable delay)                                                                                                |
| `use-animations.ts`          | Animation state management for UI transitions                                                                                           |

#### 6.27.9 Client Store (`client/store/`) — 3 Stores

| Store                   | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `draftStates.ts`        | Draft state management — tracks drafts being composed, auto-save timers, sync status |
| `optimistic-updates.ts` | Optimistic update queue — pending operations with rollback support                   |
| `backgroundQueue.ts`    | Background task queue — non-blocking operations with progress tracking               |

#### 6.27.10 Client Library (`client/lib/`) — 30 Modules

| Module                               | Purpose                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-client.ts`                     | Better Auth client configuration — session management, sign in/out, cookie handling                                                     |
| `auth-proxy.ts`                      | Auth proxy utilities                                                                                                                    |
| `backend-url.ts`                     | Backend URL configuration — tRPC endpoint resolution                                                                                    |
| `constants.tsx`                      | Application constants — max URL length, timeouts, limits                                                                                |
| `countries.ts`                       | Country list for locale/timezone settings                                                                                               |
| `email-utils.ts`                     | Email processing utilities — HTML sanitization, header parsing, MIME handling                                                           |
| `email-utils.client.tsx`             | Client-side email utilities — text highlighting, unsubscribe link detection                                                             |
| `hotkeys/compose-hotkeys.tsx`        | Compose-mode keyboard shortcuts                                                                                                         |
| `hotkeys/global-hotkeys.tsx`         | Global keyboard shortcuts                                                                                                               |
| `hotkeys/mail-list-hotkeys.tsx`      | Mail list keyboard shortcuts                                                                                                            |
| `hotkeys/navigation-hotkeys.tsx`     | Navigation keyboard shortcuts                                                                                                           |
| `hotkeys/thread-display-hotkeys.tsx` | Thread display keyboard shortcuts                                                                                                       |
| `hotkeys/use-hotkey-utils.ts`        | Hotkey utility functions                                                                                                                |
| `image-compression.ts`               | Client-side image compression before upload (canvas-based)                                                                              |
| `label-colors.ts`                    | Label color definitions and palette                                                                                                     |
| `notes-utils.ts`                     | Notes utility functions                                                                                                                 |
| `optimistic-actions-manager.ts`      | Optimistic action queue management                                                                                                      |
| `platform.ts`                        | Platform detection (macOS vs other for keyboard modifiers)                                                                              |
| `posthog-provider.tsx`               | PostHog analytics provider                                                                                                              |
| `prompts.ts`                         | AI prompt templates                                                                                                                     |
| `react-tweet-stub.ts`                | Tweet embed stub component                                                                                                              |
| `sanitize-tip-tap-html.tsx`          | TipTap HTML sanitizer                                                                                                                   |
| `schemas.ts`                         | Zod validation schemas for forms and API                                                                                                |
| `server-tool.ts`                     | Server-side utility functions                                                                                                           |
| `site-config.ts`                     | Site metadata configuration — title, description, OG image, keywords, branding                                                          |
| `thread-actions.ts`                  | Thread action definitions — archive, delete, spam, snooze, move, mark-read, star, important                                             |
| `timezones.ts`                       | Timezone utilities — browser detection, formatting, offset calculation                                                                  |
| `trpc.ts`                            | tRPC client configuration — links, transformer (superjson), batch settings                                                              |
| `trpc.server.ts`                     | Server-side tRPC client                                                                                                                 |
| `utils.ts`                           | Shared utilities — cn() class merge, date formatting (today/this-month/older), FOLDER/LABEL constants, text compression, cookie helpers |

#### 6.27.11 Client Configuration & Types — 6 Files

| File                            | Purpose                                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/navigation.ts`          | Navigation configuration — sidebar sections (Core: inbox, drafts, sent; Filters: starred, important; Management: archive, snoozed, spam, trash), settings nav items (general, privacy, appearance, labels, signatures, shortcuts), bottom nav (settings button), shortcut keys per item |
| `config/shortcuts.ts`           | Default keyboard shortcut bindings                                                                                                                                                                                                                                                      |
| `types/index.ts`                | TypeScript type definitions — ParsedMessage, ThreadProps, Label, Attachment, Sender, MailSelectMode, settings shapes, thread actions                                                                                                                                                    |
| `types/tools.ts`                | AI tool type definitions                                                                                                                                                                                                                                                                |
| `types/speech-recognition.d.ts` | Web Speech API type declarations                                                                                                                                                                                                                                                        |
| `types/ambient-stubs.d.ts`      | Ambient module declarations for packages                                                                                                                                                                                                                                                |
| `utils/keyboard-layout-map.ts`  | Keyboard layout mapping for shortcut display                                                                                                                                                                                                                                            |
| `utils/keyboard-utils.ts`       | Keyboard event utility functions                                                                                                                                                                                                                                                        |

#### 6.27.12 Localization (`client/messages/`) — 20 Locales

| Locale     | File      |
| ---------- | --------- |
| English    | `en.json` |
| Arabic     | `ar.json` |
| Catalan    | `ca.json` |
| Czech      | `cs.json` |
| German     | `de.json` |
| Spanish    | `es.json` |
| Persian    | `fa.json` |
| French     | `fr.json` |
| Hindi      | `hi.json` |
| Hungarian  | `hu.json` |
| Japanese   | `ja.json` |
| Korean     | `ko.json` |
| Latvian    | `lv.json` |
| Dutch      | `nl.json` |
| Polish     | `pl.json` |
| Portuguese | `pt.json` |
| Russian    | `ru.json` |
| Turkish    | `tr.json` |
| Vietnamese | `vi.json` |

#### 6.27.13 Server Backend (`server/src/`) — 35 Files

| File                            | Purpose                                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`                       | Express server entry — HTTP server, middleware, route registration, WebSocket support                                                                                                                       |
| `env.ts`                        | Environment variable configuration and validation                                                                                                                                                           |
| `ctx.ts`                        | Request context — session, database connection, rate limiter state                                                                                                                                          |
| `db/schema.ts`                  | Drizzle ORM schema — vmail (mailbox, domain, alias, forwarding) and mail_app (user_settings, notes, summaries) tables                                                                                       |
| `db/index.ts`                   | Drizzle database client initialization                                                                                                                                                                      |
| `db/bootstrap.ts`               | Database bootstrap and migration runner                                                                                                                                                                     |
| `trpc/trpc.ts`                  | tRPC router factory — procedure builders with auth middleware, rate limiting, session injection                                                                                                             |
| `trpc/index.ts`                 | tRPC app router — merges all route modules                                                                                                                                                                  |
| `trpc/routes/mail.ts`           | Mail tRPC routes — listThreads, getThread, getMessage, send, saveDraft, updateDraft, deleteDraft, moveThread, starThread, markRead, markImportant, snooze, unsnooze, search, listAttachments, getAttachment |
| `trpc/routes/labels.ts`         | Label tRPC routes — list, create, update, delete, assignToThread, removeFromThread                                                                                                                          |
| `trpc/routes/drafts.ts`         | Draft tRPC routes — list, get, save, delete                                                                                                                                                                 |
| `trpc/routes/settings.ts`       | Settings tRPC routes — get, update (general, appearance, notifications, privacy, security, labels, shortcuts)                                                                                               |
| `trpc/routes/user.ts`           | User tRPC routes — profile, change password, sessions                                                                                                                                                       |
| `trpc/routes/shortcut.ts`       | Shortcut tRPC routes — get, update custom key bindings                                                                                                                                                      |
| `trpc/routes/templates.ts`      | Template tRPC routes — list, create, update, delete email templates                                                                                                                                         |
| `trpc/routes/cookies.ts`        | Cookie consent tRPC routes                                                                                                                                                                                  |
| `trpc/routes/branding.ts`       | Branding tRPC routes — get, update (logo, colors, site name)                                                                                                                                                |
| `trpc/routes/stubs.ts`          | Stub/placeholder routes for feature gating                                                                                                                                                                  |
| `routes/auth.ts`                | Auth routes — login, logout, session check, password reset (Express routes)                                                                                                                                 |
| `routes/branding-admin.ts`      | Branding admin routes — server-side branding configuration                                                                                                                                                  |
| `routes/idle.ts`                | Idle/health check route                                                                                                                                                                                     |
| `lib/imap.ts`                   | IMAP connection manager — connect, authenticate (LOGIN), list mailboxes, search, fetch messages, manage flags                                                                                               |
| `lib/imap-driver.ts`            | IMAP driver abstraction — wraps IMAP operations into application-friendly API: fetchThreads, fetchMessage, sendMessage, moveMessage, starMessage, markRead, manageLabels                                    |
| `lib/smtp.ts`                   | SMTP client — send mail via outbound SMTP (Postfix relay)                                                                                                                                                   |
| `lib/session.ts`                | Session management — create, validate, refresh sessions; session cookie handling                                                                                                                            |
| `lib/crypto.ts`                 | Cryptographic utilities — password hashing (bcrypt/argon2), token generation, encryption                                                                                                                    |
| `lib/sanitize.ts`               | HTML sanitization — strip dangerous tags, allow safe rich content                                                                                                                                           |
| `lib/schemas.ts`                | Zod validation schemas for server-side input validation                                                                                                                                                     |
| `lib/rate-limit.ts`             | Rate limiting — per-user/IP request throttling                                                                                                                                                              |
| `lib/audit-log.ts`              | Audit logging — track admin actions on mail accounts                                                                                                                                                        |
| `lib/branding.ts`               | Branding configuration — logo, colors, site name resolution                                                                                                                                                 |
| `lib/cookies.ts`                | Cookie utilities — parse, serialize, sign/verify cookie values                                                                                                                                              |
| `lib/client-ip.ts`              | Client IP address extraction from request headers                                                                                                                                                           |
| `lib/timezones.ts`              | Timezone utilities — list, conversion, display formatting                                                                                                                                                   |
| `lib/shortcuts.ts`              | Shortcut configuration — default key bindings, validation                                                                                                                                                   |
| `scripts/fetch-thread-debug.ts` | Debug script for thread fetching                                                                                                                                                                            |

#### 6.27.14 Engine — iRedMail (`engine/`) — 185 Files

| Directory     | Files | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `iRedMail.sh` | 1     | Main installer script — drives daemon installation and configuration generation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `conf/`       | 11    | Configuration flags for amavisd, clamav, dovecot, fail2ban, global, iredapd, logwatch, postfix, postgresql, spamassassin — env vars controlling which components are installed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dialog/`     | 4     | Interactive configuration dialogs — config_via_dialog.sh, optional_components.sh, pgsql_config.sh, virtual_domain_config.sh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `functions/`  | 15    | Installation functions — amavisd.sh, backend.sh, clamav.sh, cleanup.sh, dovecot.sh, fail2ban.sh, iredapd.sh, optional_components.sh, packages.sh, packages_freebsd.sh, postfix.sh, postgresql.sh, spamassassin.sh, system_accounts.sh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pkgs/`       | 4     | Package checksums — get_all.sh, pkgs.freebsd.sha256, pkgs.openbsd.sha256, pkgs.sha256                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `samples/`    | 100+  | Configuration templates for all daemons: **postfix** (main.cf variants, master.cf, SQL/LDAP map files for MySQL/PGSQL: catchall, alias, relay, transport, mailbox maps), **dovecot** (dovecot.conf, dovecot-sql.conf, sieve, quota, share-folder, last-login, LDAP configs), **amavisd** (conf, schema, MySQL/PGSQL), **fail2ban** (jail configs, filter definitions, SQL schema, ban tracking), **iredmail** (DB schema, quota triggers), **firewall** (iptables, nftables, firewalld rules), **spamassassin** (local.cf, razor.conf), **systemd** (service overrides), **logrotate** (dovecot, iredapd, mlmmjadmin, php-fpm, openldap), **rsyslog** (mail logging), **yum** (repo configs), **openbsd** (pf.conf, ldapd.conf), **freebsd** (newsyslog, syslog configs) |
| `tools/`      | 18    | Admin utility scripts — backup/restore (mysql, pgsql, openldap, sogo), mail user creation (SQL, LDAP), SSL key generation, fail2ban unban, SASL login IP finder, postscreen enable, LDAP group management, SOGo CPU killer, alias migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `update/`     | 35+   | Database migration scripts across iRedMail versions (0.9.8 through 1.7.3) for MySQL, PGSQL, LDAP — schema changes for amavisd, iredmail, vmail, sogo, fail2ban, iredadmin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

#### 6.27.15 Build & Utility Scripts (`scripts/`) — 3 Files

| File                      | Purpose                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `build-release.ts`        | Release build pipeline — compiles server, bundles client (Vite), generates distribution package                                           |
| `resolve-catalog-refs.ts` | Dependency resolution — resolves iRedMail catalog references and configuration file paths                                                 |
| `slim-engine.ts`          | Engine slimming script — removes unused components from iRedMail (iRedAdmin, SOGo, Roundcube, nginx, PHP, MySQL, OpenLDAP) for deployment |

---

### 6.28 Desktop App (`apps/desktop/`)

**Purpose:** Electron desktop wrapper for the HosteraX dashboard — provides a native OS experience (frameless macOS window, Dock icon, system tray awareness) with self-contained local services (API binary + dashboard server), auto-update via GitHub releases, and an optional first-run onboarding wizard. Cross-platform: macOS (Apple Silicon + Intel), Windows (x64), Linux (AppImage). Architecture: Electron 40 main process (TypeScript) + preload bridge (contextBridge) + bundled API binary (`bun build --compile`) + bundled Next.js dashboard standalone.

#### 6.28.1 Main Process (`src/main/`) — 5 Files

| File                 | Lines | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`           | 851   | **Main entry** — Electron app lifecycle, BrowserWindow management, persistent ConfigStore (JSON in userData), internal token (ephemeral per-session), routing (loading splash → onboarding → dashboard), IPC handlers: config get/set/getAll/reset, app version/cloud-urls/local-urls, navigate, onboarding complete/cloud-auth/cloud-auth-poll/browse-file, system get-settings/update-settings/browse-folder, cloud connect/connect-poll, update start/open/dismiss/progress/done/error, reset to re-onboard                                                                                   |
| `services.ts`        | 425   | **Local service supervisor** — starts/stops bundled API binary (`hosterax-api`) and dashboard Next.js server in packaged mode; dynamic free port selection (never fixed ports, persisted to ports.json for session stability across restarts); API spawn with env (PGlite data dir, migrations, trusted origins, auth secret, internal token); dashboard via `utilityProcess.fork` (preferred, no Dock tile) with `ELECTRON_RUN_AS_NODE` fallback; readiness polling with timeout; graceful shutdown (SIGTERM → SIGKILL) with await for auto-update handoff                                      |
| `updater.ts`         | 310   | **In-app updater** — `checkForUpdate` fetches GitHub latest release via API, resolves platform-specific installer via `@repo/core.resolveDesktopUpdate`; `downloadUpdate` streams asset with SHA256 integrity verification (sidecar `.sha256` file, fail-open on missing); `installUpdate` dispatches per-platform: **macOS** (mount dmg → ditto new .app → detached shell script waits for exit → atomic rename with rollback), **Windows** (Expand-Archive zip → detached cmd script → robocopy /MIR → relaunch), **Linux** (cp + chmod AppImage → atomic rename via detached bash → relaunch) |
| `update-window.ts`   | 127   | **Update notification window** — self-contained frameless BrowserWindow with inline HTML (no external assets), dark/light theme via CSS prefers-color-scheme, version + release notes display, "Later" / "Update now" buttons, progress lives in dashboard's header bar after download begins                                                                                                                                                                                                                                                                                                    |
| `types/desktop.d.ts` | 33    | TypeScript declarations for `window.desktop` bridge interface (`DesktopBridge` with isDesktop, config, app, navigate, onboarding, system, reset)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

#### 6.28.2 Preload Bridge (`src/preload/`) — 1 File

| File       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | Electron contextBridge — exposes `window.desktop` API to renderer: **config** (get/set/getAll), **app** (version, platform, cloudUrls, localUrls), **navigate** (loadURL), **onboarding** (complete, openExternal, cloudAuth, cloudAuthPoll, browseFile, utils), **system** (browseFolder, getSettings, updateSettings), **cloud** (connect, connectPoll), **reset**, **updates** (start, open, dismiss, onProgress, onDone, onError), **utils** (isPrivateIp, validateServerAddress, validateSshPayload, buildSshSettings) |

#### 6.28.3 Build & Packaging (`build/`) — 2 Files

| File       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage.ts` | **Build staging** (178 lines) — invoked by electron-forge `generateAssets` hook or standalone via `bun run build/stage.ts`. Steps: 1) Compile API binary via `bun build --compile` with `--target=bun-{os}-{arch}` (cross-compile support via FORGE_ARCH), `--external cpu-features`; 2) Build dashboard (`bun run build` with `CLOUD_MODE=false`) then copy Next.js standalone output to `resources/dashboard/` with `.next/static` + `public/`; 3) Copy Drizzle SQL migrations to `resources/migrations/`; 4) Copy PGlite WASM + data files to `resources/pglite/` |
| —          | Output: `resources/bin/hosterax-api[.exe]`, `resources/dashboard/`, `resources/migrations/`, `resources/pglite/`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

#### 6.28.4 Configuration & Packaging — 3 Files

| File                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forge.config.js`    | Electron Forge v7 configuration: **packagerConfig** (name: HosteraX, appBundleId: com.hosterax.hosterax, icon, asar, extraResource for bin/dashboard/migrations/pglite, macOS signing with hardened runtime + entitlements); **hooks** (generateAssets → stage.ts, postPackage for Linux chmod, postMake for macOS hdiutil dmg creation with retry logic and stale mount cleanup); **makers** (Linux: @reforged/maker-appimage, all platforms: @electron-forge/maker-zip for Windows/macOS) |
| `entitlements.plist` | macOS hardened runtime entitlements (allow-jit, disable-library-validation for spawned API binary)                                                                                                                                                                                                                                                                                                                                                                                          |
| `assets/`            | App icons: `icon.icns` (macOS), `icon.ico` (Windows), `icon.png` (Linux)                                                                                                                                                                                                                                                                                                                                                                                                                    |

#### 6.28.5 Development Utilities — 2 Files

| File              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/dev.mjs` | Dev mode script — runs `tsc --watch` for main/preload compilation + `electronmon .` for auto-restart on file changes (2s delay for initial tsc settle) |
| `tsconfig.json`   | TypeScript config for Electron main + preload (Node target, CommonJS/ESM output)                                                                       |

#### 6.28.6 Desktop Architecture & Data Flow

| Component             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Window Management** | Native frameless window on macOS (`titleBarStyle: hiddenInset` with traffic lights at x:22/y:22), standard on Windows/Linux; min size 800×560; defaults to maximized; remembers position/bounds across restarts; shows loading splash (inline HTML spinner) while local services boot; `backgroundColor` matches OS theme to prevent flash                                                                                                                                            |
| **Config Store**      | Persistent JSON file in `app.getPath("userData")/config.json`; stores apiUrl, dashboardUrl, onboardingComplete, windowBounds, windowMaximized, system settings (SSH creds), tunnel config, autoUpdate flag, updateNotifications, lastSeenVersion, dismissedAdvisoryIds                                                                                                                                                                                                                |
| **Local Services**    | Packaged mode only: spawns compiled API binary (embedded PGlite, in-process job runner, loopback-only listener) + dashboard Next.js server via `utilityProcess.fork`; dynamic free ports persisted to `ports.json` for session cookie stability across restarts; readiness polling + 3-attempt retry with port fallback                                                                                                                                                               |
| **Internal Token**    | Ephemeral 32-byte random token per session (never persisted); passed to API via `INTERNAL_TOKEN` env var at spawn; authenticates all Electron → API internal calls (setting push, system queries); API only listens on 127.0.0.1 in desktop mode                                                                                                                                                                                                                                      |
| **Onboarding Flow**   | Optional (opt-in via `HOSTERAX_ENABLE_ONBOARDING=1`); disabled by default so desktop goes straight to dashboard; routes to `{dashboardUrl}/onboarding` when enabled + not complete; on completion: saves SSH settings locally → pushes to API → navigates to `/api/auth/desktop-login` which creates session cookie and redirects to dashboard                                                                                                                                        |
| **Cloud Auth Flow**   | PKCE-based OAuth from desktop: generate nonce + state + code verifier/challenge → register with API → open system browser to cloud authorize URL → poll API for resolution → on resolved: navigate to claim endpoint (cookie set) → mark onboarding complete; re-focuses desktop app after browser sign-in                                                                                                                                                                            |
| **Auto-Update**       | GitHub releases API → `resolveDesktopUpdate` from `@repo/core` for platform asset selection; SHA256 sidecar integrity check (fail-open on missing); per-platform install: macOS (dmg mount → ditto → detach → atomic rename with rollback), Windows (Expand-Archive → robocopy /MIR), Linux (cp + atomic rename); detached scripts handle swap after app exit; progress streamed to dashboard header bar; configurable auto-install vs notify-only; critical advisory always surfaces |

---

## 7. All UI Components Inventory

### 7.1 Shared UI Package (`@repo/ui`) — 4 Components + 1 utility

| Component     | Props/Variants                                                        | Lines |
| ------------- | --------------------------------------------------------------------- | ----- |
| **Button**    | `variant`: default, secondary, outline, ghost, destructive            | 44    |
|               | `size`: sm (h-8), md (h-10), lg (h-12)                                |       |
| **Card**      | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter | 26    |
| **Badge**     | `variant`: default, success, warning, error, muted                    | 29    |
| **StatusDot** | `status`: queued, building, deploying, ready, failed, cancelled       | 25    |
| **cn()**      | Tailwind class merge utility                                          | 7     |

### 7.2 Dashboard UI Primitives (`apps/dashboard/src/components/ui/`) — 20 Components

| Component             | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `button.tsx`          | Shadcn-style Button (CVA variants: default, secondary, outline, ghost, destructive) |
| `card.tsx`            | Generic card wrapper                                                                |
| `Checkbox.tsx`        | Checkbox input                                                                      |
| `CustomCursor.tsx`    | Custom cursor component                                                             |
| `CustomSelect.tsx`    | Custom select dropdown                                                              |
| `DropdownMenu.tsx`    | Dropdown menu                                                                       |
| `FileIcon.jsx`        | File type icon                                                                      |
| `IconPickerModal.tsx` | Icon search/selection modal                                                         |
| `InfoBanner.jsx`      | Info banner                                                                         |
| `input.tsx`           | Text input                                                                          |
| `label.tsx`           | Form label                                                                          |
| `Logo.tsx`            | UI logo                                                                             |
| `Modal.tsx`           | Portal-based modal with backdrop blur                                               |
| `PageContainer.tsx`   | Max-width page wrapper (1600px)                                                     |
| `Popover.tsx`         | Dismissible popover                                                                 |
| `select.tsx`          | Native/beautified select                                                            |
| `SlidingToggle.tsx`   | Animated toggle switch                                                              |
| `Switch.tsx`          | Toggle switch                                                                       |
| `Tabs.tsx`            | Underline tab strip                                                                 |
| `textarea.tsx`        | Textarea input                                                                      |

### 7.3 Dashboard Shared Components (`apps/dashboard/src/components/shared/`) — 15 Components

| Component                  | Description               |
| -------------------------- | ------------------------- |
| `AlertBox.tsx`             | Alert box                 |
| `CTASection.tsx`           | Call-to-action section    |
| `DnsRecordsView.tsx`       | DNS records table display |
| `ErrorState.tsx`           | Error display state       |
| `FeatureCard.tsx`          | Feature card              |
| `MachineSettingsModal.tsx` | Machine settings modal    |
| `Modal.tsx`                | Shared modal              |
| `OTPInput.tsx`             | One-time password input   |
| `PageHero.tsx`             | Page hero section         |
| `PlatformFeatureCard.tsx`  | Platform feature card     |
| `ServerSelector.tsx`       | Server selection dropdown |
| `StatCard.tsx`             | Statistics card           |
| `ValueCard.tsx`            | Value display card        |
| `WarningCallout.tsx`       | Warning callout           |

### 7.4 Dashboard Root Components — 18 Components

| Component                   | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `account-switcher.tsx`      | Org switcher popover (Better Auth org plugin)          |
| `api-unavailable.tsx`       | SSR fallback when API unreachable                      |
| `AppLogo.tsx`               | Per-app logo with SimpleIcons/favicon resolution       |
| `auth-shell.tsx`            | Centered auth page shell with theme toggle             |
| `desktop-chrome.tsx`        | Electron frameless title bar                           |
| `i18n-provider.tsx`         | I18n context + dictionary loading                      |
| `language-switcher.tsx`     | Cycle-through-locales button                           |
| `logo.tsx`                  | HosteraX circle "O" logo                               |
| `migrated-launcher.tsx`     | Post-migration launcher screen                         |
| `migration-in-progress.tsx` | Mid-migration polling screen                           |
| `network-error-handler.tsx` | Global API error -> toast bridge                       |
| `not-found-content.tsx`     | Localized 404 content                                  |
| `not-found-view.tsx`        | 404 illustration + actions                             |
| `oauth-buttons.tsx`         | GitHub/Google OAuth buttons                            |
| `page-header.tsx`           | Shared page header (i18n-driven)                       |
| `resource-not-found.tsx`    | Detail-page not-found state (with copy ID)             |
| `sidebar.tsx`               | Full sidebar nav (org switch, theme, collapse, logout) |
| `theme-provider.tsx`        | Light/dim/dark theme with system detection             |
| `toast.tsx`                 | Glassy toast provider (bottom-right)                   |

### 7.5 Dashboard Feature Components — 130+ Components

| Directory                         | Components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Count |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `app-settings/`                   | `AppSettingsForm.tsx`, `useAppSettings.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2     |
| `backup/`                         | `BackupRunCard.tsx`, `destinationDisplay.tsx`, `PolicyEditor.tsx`, `RestoreWizard.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 4     |
| `backups/_components/`            | `CreateDestinationModal.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1     |
| `billing/`                        | `BillingOverview.tsx`, `BillingTopups.tsx`, `BillingUsage.tsx`, `PricingCards.tsx`, `UsageChart.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 5     |
| `billing/_components/`            | _(removed — HosteraX does not provide cloud/billing services)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —     |
| `cloud/`                          | _(removed — HosteraX does not provide cloud services)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —     |
| `deploy/`                         | `AppDestinationPicker.tsx`, `CleanDeployProgress.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2     |
| `deployments/`                    | `DeployCredentialModal.tsx`, `types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 2     |
| `deployments/components/`         | `DeploymentCard.tsx`, `DeploymentsContent.tsx`, `DeploymentsFilters.tsx`, `DeploymentsList.tsx`, `DeploymentHeader.tsx`, `DeploymentMenu.tsx`, `ProjectFilter.tsx`, `EmptyState.tsx`, `LoadingSkeleton.tsx`, `CommitDetailsModal.tsx`, `index.ts`                                                                                                                                                                                                                                                                                                                | 11    |
| `emails/_components/`             | `step-icon.tsx`, `dns-record-card.tsx`, `dns-hold-banner.tsx`, `ptr-hold-banner.tsx`, `adopt-mail-modal.tsx`, `mail-sidebar.tsx`, `mail-setup-form.tsx`, `mail-server-list.tsx`, `mail-progress.tsx` + 19 admin components                                                                                                                                                                                                                                                                                                                                       | 28    |
| `github/`                         | `ServerGitHubConnect.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 1     |
| `icons/`                          | `DockerMark.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 1     |
| `import-project/`                 | `BuildSettings.tsx`, `BuildTerminal.tsx`, `ComposeServices.tsx`, `DockerSettings.tsx`, `EnvironmentVariables.tsx`, `Frameworks.tsx`, `MonorepoApps.tsx`, `PortAdvisoryModal.tsx`, `ProjectSettings.tsx`, `RoutingSection.tsx`, `TerminalSurface.tsx`, `types.ts` + 3 compose sub-components                                                                                                                                                                                                                                                                      | 15    |
| `integrations/`                   | `GithubPermissionModal.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1     |
| `jobs/`                           | `JobForm.tsx`, `jobFormat.ts`, `JobRunLogs.tsx`, `JobsEmptyState.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 4     |
| `library/components/`             | `TemplateGrid.tsx`, `RepositoryList.tsx`, `LocalProjects.tsx`, `UrlImport.tsx`, `FolderUpload.tsx`, `ConnectPrompt.tsx`, `LibrarySidebar.tsx`, `LoadingSkeleton.tsx`                                                                                                                                                                                                                                                                                                                                                                                             | 8     |
| `migration/`                      | `ServerMigrationWizard.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1     |
| `onboarding/_components/`         | `choose-step.tsx`, `selfhost-choice-step.tsx`, `ssh-step.tsx`, `tunnel-step.tsx`, `preferences-step.tsx`, `loading-step.tsx`, `step-props.ts`                                                                                                                                                                                                                                                                                                                                                                                                                    | 7     |
| `overview/`                       | 20 files (Dashboard home widgets with analytics numbers, charts, deployment stats)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 20    |
| `permissions/`                    | `ResourcePicker.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 1     |
| `project-settings/`               | `ServerSideSwitch.jsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1     |
| `projects/components/`            | `ProjectCard.tsx`, `DeploymentCard.tsx`, `ProjectFilters.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 3     |
| `routing/`                        | `DomainSwitcher.tsx`, `PublicEndpointsCard.tsx`, `RoutingConfigEditor.tsx`, `RoutingSettingsCard.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 4     |
| `servers/_components/`            | `server-form.tsx`, `coming-soon-panel.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2     |
| `servers/new/_components/`        | `types.ts`, `setup-header.tsx`, `choose-mode.tsx`, `checking-state.tsx`, `error-banner.tsx`, `results-panel.tsx`, `installing-panel.tsx`, `component-row.tsx`, `auto-setup-flow.tsx`                                                                                                                                                                                                                                                                                                                                                                             | 9     |
| `servers/[serverId]/_components/` | `overview-tab.tsx`, `components-tab.tsx`, `module-updates.tsx`, `terminal-tab.tsx`, `connection-banner.tsx`, `rate-limit-settings.tsx`, `port-forwarding-card.tsx`                                                                                                                                                                                                                                                                                                                                                                                               | 7     |
| `settings/_components/`           | `BuildPreferences.tsx`, `DeployDefaults.tsx`, `CloudConnection.tsx`, `GitHubConnection.tsx`, `CloneCredentials.tsx`, `PersonalAccessTokens.tsx`, `McpConnection.tsx`, `InstanceInfo.tsx`, `LanguageSetting.tsx`, `UpdatesTab.tsx`, `TeamTab.tsx`, `NotificationsTab.tsx`, `EmailSettings.tsx`, `AuditTab.tsx`, `DataTransferTab.tsx`, `SettingsSidebar.tsx`, `SettingsSection.tsx`, `InviteMemberModal.tsx`, `MigrateModal.tsx`, `TeamWorkspaceCard.tsx`, `TeamReachabilityCard.tsx`, `WorkspaceManageModal.tsx`, `UpgradeAuthModal.tsx`, `GrantPickerModal.tsx` | 24    |
| `terminal/`                       | `ServerTerminal.tsx`, `ServerTerminalTabs.tsx`, `ServiceTerminal.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 3     |
| `updates/`                        | `UpdateCenter.tsx`, `useUpdates.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 2     |
| `global-deployments/`             | `index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 1     |
| `shared/`                         | (see 7.3 Dashboard Shared Components)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 15    |
| `ui/`                             | (see 7.2 Dashboard UI Primitives)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 20    |

### 7.6 Dashboard Context Providers — 15 Contexts

| Context                              | Description                                                         |
| ------------------------------------ | ------------------------------------------------------------------- |
| `AuthContext.tsx`                    | Better Auth session wrapper (user, isLoading, logout)               |
| `CloudContext.tsx`                   | _(removed — HosteraX does not provide cloud services)_              |
| `DeploymentContext.tsx`              | Full deploy lifecycle (config + build state)                        |
| `GitHubContext.tsx`                  | Dual-source GitHub connection (App + CLI)                           |
| `ModalContext.tsx`                   | Stackable modal system (z-index layering)                           |
| `NetworkContext.tsx`                 | Docker network context (networkId/name)                             |
| `PlatformContext.tsx`                | SSR-deployed platform info (selfHosted, deployMode, authMode)       |
| `ProjectSettingsContext.tsx`         | Full project state (data, domains, env, git, build, services, logs) |
| `ToastContext.tsx`                   | Legacy showToast adapter → glassy toast                             |
| `deployment/index.ts`                | Re-exports + types                                                  |
| `deployment/types.ts`                | DeploymentConfig, DeploymentState, DeploymentContextType            |
| `deployment/mode-config.ts`          | Deployment mode config                                              |
| `deployment/MonorepoAppProvider.tsx` | Monorepo sub-app context                                            |
| `deployment/useDeploymentBuild.tsx`  | Build lifecycle (start, connect, stop, redeploy, SSE)               |
| `deployment/useDeploymentConfig.ts`  | Config state (initialize from repo/local/upload/project)            |

### 7.7 Dashboard Hooks — 13 Hooks

| Hook                     | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `useSetupStream.ts`      | SSE stream for system component installs (servers)           |
| `useMonitorStream.ts`    | SSE stream for live server stats (CPU/memory/disk)           |
| `useSSEConnection.ts`    | High-level SSE connection for logs, build, generic streams   |
| `useSSEStream.ts`        | Core SSE stream processor with chunk parsing                 |
| `useBuildConnection.ts`  | Legacy build connection with reconnect                       |
| `useBackupRunStream.ts`  | SSE stream for backup run progress                           |
| `useRestoreRunStream.ts` | SSE stream for restore progress                              |
| `useDeploymentInfo.ts`   | Client-side deployment info (cached module-level)            |
| `useDashboardHome.ts`    | Dashboard home data (projects, numbers, other orgs)          |
| `useProjectEndpoints.ts` | Per-endpoint hooks (projectInfo, analytics) with dedup cache |
| `useProjectData.ts`      | Mock project data hook                                       |
| `usePtyConnection.ts`    | WebSocket PTY transport (server/service terminal)            |
| `useSessions.ts`         | AI session list hook                                         |

### 7.8 Dashboard Utility Files — 13 Files

| File                         | Purpose                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `authWindow.ts`              | OAuth popup window management (browser popup + Electron desktop bridge)                                                                        |
| `date.ts`                    | Date formatting (parseDate, formatDate with relative time)                                                                                     |
| `deployment.ts`              | Deployment helpers (formatDistanceToNow, formatBuildTime, getStatusConfig, sortDeploymentsByDate, filterDeployments, calculateDeploymentStats) |
| `deploymentPhaseDetector.ts` | Build phase detection (detectPhase, parseLogEntry, aggregatePhaseInfo)                                                                         |
| `extToLang.js`               | File extension → language mapping (100+ mappings for syntax highlighting)                                                                      |
| `icons.js`                   | Icon utility (generateIcon with mask-image rendering from CDN)                                                                                 |
| `project-status.ts`          | Project status helpers (ProjectStatus type, PROJECT_STATUS_META, projectStatusLabel, getProjectStatus)                                         |
| `repoSlug.ts`                | Repo slug encoding/decoding (base64url for repo/local/upload/project slugs, GitHub URL parsing)                                                |
| `subdomain.ts`               | Subdomain normalization (normalizeSubdomain, normalizeSubdomainInput)                                                                          |
| `tarGz.ts`                   | Browser-side tar.gz builder (folder upload deploy, PAX headers for long paths, CompressionStream gzip)                                         |
| `theme.js`                   | Theme icon definitions (Monokai Pro icon font mappings)                                                                                        |
| `ui-helpers.tsx`             | UI helpers (getStatusIcon with lucide-react, getFrameworkColor)                                                                                |
| `upload.js`                  | Easter egg — ASCII "HosteraX" banner logged to console                                                                                         |

### 7.9 Dashboard Shared Library Files — 16 Files

| File                      | Purpose                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-labels.ts`         | EventType-to-human-readable label catalog (444 lines); maps every server-emitted eventType for the AuditTab; includes secureRouter auto-emitter tags  |
| `auth-client.ts`          | Better Auth client config (org plugin, email OTP, base URL from API origin)                                                                           |
| `cloud-auth.ts`           | _(removed — HosteraX does not provide cloud services)_                                                                                                |
| `country.ts`              | Country flag URL builder via flagcdn.com CDN (ISO 3166-1 alpha-2 codes, configurable size)                                                            |
| `deploy-nav.ts`           | Shared post-trigger navigation for deploys (extract deployment id from trigger response, navigate to build screen or deployments list)                |
| `dotenv.ts`               | Minimal .env parser for paste/upload flow (skips blanks+comments, splits on `=`, unwraps quotes, strips inline comments, validates shell identifiers) |
| `formatBytes.ts`          | Human-readable byte formatting (B/KB/MB/GB/TB, binary units)                                                                                          |
| `github-connect-error.ts` | Cross-window GitHub OAuth error channel via localStorage (stashes error code from popup, read+cleared by opener after close)                          |
| `mail-providers.ts`       | Mail provider presets (host/port templates for IMAP + SMTP + send-only transactional relays); includes logo resolution via simpleicons/favicon        |
| `persisted-value.ts`      | Typed localStorage wrapper for soft per-browser memory (SSR-safe, JSON parse failure safe, quota errors swallowed, validation required)               |
| `random-uuid.ts`          | `crypto.randomUUID` with non-cryptographic fallback for plain HTTP origins (self-hosted LAN/VPN)                                                      |
| `sseClient.ts`            | SSE client utility (connect to live logs, auto-reconnect, `NoRetryError` for terminal failures)                                                       |
| `sseMessageProcessors.ts` | SSE message type processors for build events (ServiceStatusEvent with pending/building/built/deploying/running/failed states)                         |
| `utils.ts`                | `cn()` classname merger (clsx + tailwind-merge)                                                                                                       |
| `server/api.ts`           | Server-side API fetch helper                                                                                                                          |
| `server/session.ts`       | Server-side session data access                                                                                                                       |

### 7.10 Dashboard Types

| File                | Exports                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/research.ts` | Tavily Research API integration types (`SearchRequest`, `ExtractRequest`, `SearchResult`, `ExtractResult`, `SearchResponse`, `ExtractResponse`) |

### 7.11 Dashboard API Layer — 35 Service Files

| File                  | Exports                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client.ts`           | `api()`, `ApiError`, `getApiErrorMessage`, `isAbortError`, `isNetworkError`, `setNetworkErrorHandler`, `getApiBaseUrl`                                                                                                                                                                                                                                                                           |
| `endpoints.ts`        | `endpoints` object                                                                                                                                                                                                                                                                                                                                                                               |
| `projects.ts`         | `projectsApi`, `RouteRuleRow`, `RouteRuleInput`                                                                                                                                                                                                                                                                                                                                                  |
| `apps.ts`             | `appsApi`, `AppCatalogEntry`, `AppCatalogField`, `InstallAppResult`                                                                                                                                                                                                                                                                                                                              |
| `deploy.ts`           | `deployApi`                                                                                                                                                                                                                                                                                                                                                                                      |
| `domains.ts`          | `domainsApi`                                                                                                                                                                                                                                                                                                                                                                                     |
| `jobs.ts`             | `jobsApi`, `JobView`, `JobRunSummary`, `JobInput`, `JobTriggerEvent`, `JobActionConfig`, `JobNotifyConfig`, `JobRetryConfig`, `JobRunState`, `BackupScheduleView`                                                                                                                                                                                                                                |
| `tokens.ts`           | `tokensApi`, `AccessToken`, `CreatedAccessToken`, `McpClient`                                                                                                                                                                                                                                                                                                                                    |
| `github.ts`           | `githubApi`                                                                                                                                                                                                                                                                                                                                                                                      |
| `icons.ts`            | `iconsApi`                                                                                                                                                                                                                                                                                                                                                                                       |
| `images.ts`           | `imagesApi`, `ImageCatalogEntry`, `ListImagesResponse`                                                                                                                                                                                                                                                                                                                                           |
| `ai.ts`               | `aiApi`                                                                                                                                                                                                                                                                                                                                                                                          |
| `sandbox.ts`          | `sandboxApi`                                                                                                                                                                                                                                                                                                                                                                                     |
| `system.ts`           | `systemApi`                                                                                                                                                                                                                                                                                                                                                                                      |
| `migration.ts`        | `migrationApi`, `DomainChoice`, `PreflightResult`, `StartServerResult`, `StartTunnelResult`, `SwitchBackResult`                                                                                                                                                                                                                                                                                  |
| `server-migration.ts` | `dockerMigrationApi`, `DiscoveredStack`, `DiscoveredGroup`, `DiscoveredService`, `DiscoveredVolumeMount`, `AdoptResult`, `MigrationPreview`, `MigrationPreviewService`, `MigrationRun`, `MigrationStatus`                                                                                                                                                                                        |
| `data-transfer.ts`    | `dataTransferApi`, `DataTransferFile`, `ImportMode`, `ImportResult`                                                                                                                                                                                                                                                                                                                              |
| `permissions.ts`      | `permissionsApi`, `RESOURCE_TYPE_LABELS`, `resourceTypeLabel`, `Permission`, `ResourceType`, `PickerGrant`, `ResourceGrant`, `CatalogEntry`                                                                                                                                                                                                                                                      |
| `settings.ts`         | `settingsApi`, `BuildMode`, `UserSettingsResponse`, `DefaultDeployTarget`, `DeployDefaultsResponse`, `CloneCredentialsState`, `CloneStrategyPreference`                                                                                                                                                                                                                                          |
| `cloud.ts`            | _(removed — HosteraX does not provide cloud services)_                                                                                                                                                                                                                                                                                                                                           |
| `services.ts`         | `servicesApi`, `serviceKind`, `Service`, `ServiceContainer`, `ServiceEnvVar`, `ServiceInput`                                                                                                                                                                                                                                                                                                     |
| `mail.ts`             | `mailApi`, `MailSetupStep`, `MailStepStatus`, `MailSetupStatus`, `MailCredentials`, `MailWebmailSummary`, `DnsRecord`, `DnsRecords`, `MailSSEEvent`, `PortConflict`, `PortResolution`, `PortUsage`, `MailComponentHealth`, `MailComponentStatus`, `MailComponentDef`, `MailHealthResponse`, `WebmailTargetOption`                                                                                |
| `mail-admin.ts`       | `mailAdminApi`, `AdminDomain`, `AdminMailbox`, `CreateDomainPayload`, `UpdateDomainPayload`, `CreateMailboxPayload`, `UpdateMailboxPayload`, `DomainDependents`, `AdditionalDomainDnsState`, `MailServerStats`, `DnsCheck`, `DnsCheckStatus`, `DnsScanResult`, `ComponentAction`, `ComponentActionResult`, `ComponentLogs`, `BulkRestartResult`, `MailBackupPolicy`, `SaveMailBackupPolicyInput` |
| `terminal.ts`         | `requestTerminalTicket`, `buildTerminalWsUrl`, `TERMINAL_SUBPROTOCOL_PREFIX`, `TERMINAL_RESUME_SUBPROTOCOL_PREFIX`, `ServerControlMsg`, `ClientControlMsg`, `ReadyMsg`, `ExitMsg`, `ErrorMsg`, `PongMsg`, `ResizeMsg`, `PingMsg`, `TerminalErrorCode`, `TerminalTicketResponse`                                                                                                                  |
| `service-terminal.ts` | `requestServiceTerminalTicket`, `buildServiceTerminalWsUrl`                                                                                                                                                                                                                                                                                                                                      |
| `notifications.ts`    | `notificationsApi`, `NotificationCategory`, `NotificationChannel`, `NotificationSubscription`, `NotificationDefault`, `NotificationDelivery`, `ChannelKind`, `DeliveryStatus`                                                                                                                                                                                                                    |
| `billing.ts`          | `billingApi`, `BillingState`, `CreditPack`, `UsageGroupBy`, `UsageQuery`, `UsageUnits`, `UsageResponse`, `SubscriptionPlanTierId`, `SubscriptionInterval`                                                                                                                                                                                                                                        |
| `backups.ts`          | `backupDestinationsApi`, `backupsApi`, `BackupDestinationSummary`, `CreateDestinationInput`, `UpdateDestinationInput`, `BackupPolicy`, `BackupRun`, `BackupRestore`, `DestinationUsage`, `DestinationUsagePolicy`                                                                                                                                                                                |
| `serverGithub.ts`     | `serverGithubApi`, `ServerGithubStatus`, `ServerGithubMode`, `ServerGithubDeviceFlow`                                                                                                                                                                                                                                                                                                            |
| `auth.ts`             | `getAuthToken`                                                                                                                                                                                                                                                                                                                                                                                   |
| `folder.ts`           | Folder scan API                                                                                                                                                                                                                                                                                                                                                                                  |
| `updates.ts`          | Updates API                                                                                                                                                                                                                                                                                                                                                                                      |
| `urls.ts`             | URL helper functions                                                                                                                                                                                                                                                                                                                                                                             |

### 7.12 Marketing Site Components — 50+ Components

| Component               | File                    | Description                                                                                                                    |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Navbar`                | `navbar.tsx`            | Fixed pill nav, scroll-aware dark/light toggle, links (Features, Emails, Docs, Roadmap, Changelog, Pricing, GitHub star count) |
| `Hero`                  | `hero.tsx`              | Full-screen hero with aurora glow, grid grain, animated tech stack icons, copy-to-clipboard deploy command                     |
| `HowItWorks`            | `how-it-works.tsx`      | 5-step flow: Connect → Build → Ship → Route → Operate                                                                          |
| `Features`              | `features/index.tsx`    | 9 feature cards with SVG decorative marks, GSAP scroll animations                                                              |
| `Dashboard`             | `dashboard.tsx`         | Hero screenshot with flanking companion images                                                                                 |
| `DeploymentModels`      | `deployment-models.tsx` | 2 panels (Self-hosted, Hybrid) with pricing tags                                                                               |
| `Comparison`            | `comparison.tsx`        | Clean table: HosteraX vs managed vs self-hosted (8 dimensions)                                                                 |
| `CompletePlatform`      | `complete-platform.tsx` | 6 capability groups with Lucide icons                                                                                          |
| `OpenSource`            | `open-source.tsx`       | Editorial spread, Apache 2.0, GitHub star/read links                                                                           |
| `MailServer`            | `mail-server.tsx`       | Built-in mail server spotlight with status indicators                                                                          |
| `FinalCta`              | `final-cta.tsx`         | CTA section (Get started, View on GitHub)                                                                                      |
| `Footer`                | `footer.tsx`            | 4-column footer with social links                                                                                              |
| `DarkSection`           | `dark-section.tsx`      | GSAP scroll-linked scale/opacity animation wrapper                                                                             |
| `DownloadButton`        | `download-button.tsx`   | Platform-aware download button with SVG icons                                                                                  |
| `ResourceWriterSidebar` | `writer-sidebar.tsx`    | Author card: avatar, name, role, bio, social links                                                                             |
| `ResourceShareSidebar`  | `share-sidebar.tsx`     | Share buttons (X, LinkedIn, copy link)                                                                                         |
| `InstallTabs`           | `install-tabs.tsx`      | Platform-aware one-line installers, copy-to-clipboard                                                                          |

### 7.13 Mail Landing Page Components — 10 Components

| Component                                                            | Description                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HomeContent`                                                        | Full mail landing page (1767 lines): hero, preview tabs, reply compose demo, inbox sidebar cards, search demo, unlimited domains panel, client access panel, setup guide cards |
| `MailFooter`                                                         | Mail page footer: gradient bg, CTA "Install HosteraX"                                                                                                                          |
| `PixelatedBackground`                                                | 3 SVG components (pixelated noise overlay)                                                                                                                                     |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                     | Custom React context-based tabs                                                                                                                                                |
| `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle` | Slide-out panel (right/left/top/bottom) with backdrop                                                                                                                          |
| `Separator`                                                          | Horizontal/vertical divider                                                                                                                                                    |
| `Button`                                                             | ForwardedRef button with `default`/`ghost`/`outline` variants                                                                                                                  |
| `AnimatedNumber`                                                     | Animated counter (ease-out cubic)                                                                                                                                              |
| `cn`                                                                 | clsx + tailwind-merge utility                                                                                                                                                  |
| 35+ Icons                                                            | Vercel, Gmail, Outlook, Discord, Google, GitHub, Twitter/X, YouTube, etc.                                                                                                      |

### 7.14 Dashboard Styles

| File        | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `theme.css` | 479 lines: light/dim/dark theme tokens + shadcn CSS variable bridge |
| `fonts.css` | Gellix + SF Arabic @font-face declarations                          |

### 7.15 Marketing Styles

| File            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `theme.css`     | CSS custom property token system (227 lines)         |
| `fonts.css`     | Gellix (100–900) + SF Arabic RTL fallback (84 lines) |
| `landing.css`   | ~2414 lines: full landing page styling               |
| `changelog.css` | Changelog-specific styles                            |
| `resources.css` | Resource listing + post page styles (651 lines)      |
| `roadmap.css`   | Roadmap page styles                                  |
| `download.css`  | Download page styles                                 |

---

## 8. All Pages & Routes

### 8.1 Dashboard Pages (`apps/dashboard`) — 46 Page Files

#### Auth Pages (6)

| Route                  | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `/login`               | Email/password login + OAuth (GitHub/Google) with Better Auth |
| `/register`            | Registration with email verification + OTP flow               |
| `/forgot-password`     | Password reset request form                                   |
| `/reset-password`      | Token-based password reset                                    |
| `/verify-email`        | Email OTP verification screen                                 |
| `/select-organization` | Multi-org picker (redirected when 2+ orgs)                    |

#### Dashboard Pages (27)

| Route                             | Description                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/`                               | Home/dashboard with projects overview, analytics numbers, deployment stats                                       |
| `/projects`                       | Project listing with filters, cards, skeleton loading                                                            |
| `/projects/[id]`                  | Project detail (9-tab layout: overview, services, domains, deployments, source, runtime, logs, backup, advanced) |
| `/apps`                           | App catalog listing with installed/managed apps                                                                  |
| `/apps/new`                       | New app with tabbed create (repo/local/upload/catalog)                                                           |
| `/apps/new/[appId]`               | App install from catalog (schema-based setup)                                                                    |
| `/apps/new/mail`                  | Self-hosted mail stack deploy flow                                                                               |
| `/audit`                          | Audit log feed (admin-only)                                                                                      |
| `/backups`                        | Backup policies list with create/modify/run                                                                      |
| `/backups/[id]`                   | Single backup detail + restore wizard                                                                            |
| `/billing`                        | Billing overview (redirects to active tab)                                                                       |
| `/billing/[tab]`                  | Tabbed billing (plans, usage, topups, subscription)                                                              |
| `/deploy/[slug]`                  | Full deploy wizard (repo/local/upload)                                                                           |
| `/deploy/mail`                    | Mail stack deploy (simplified)                                                                                   |
| `/build/[id]`                     | Live build session (SSE streaming logs)                                                                          |
| `/deployments`                    | Global deployments list with filters, sorting                                                                    |
| `/domains`                        | Domain management overview                                                                                       |
| `/emails`                         | Self-hosted mail setup wizard + admin panel                                                                      |
| `/jobs`                           | Scheduled jobs list                                                                                              |
| `/jobs/new`                       | Job creation form (CRON/event/webhook triggers)                                                                  |
| `/jobs/[key]`                     | Job detail with run history                                                                                      |
| `/jobs/[key]/edit`                | Edit job form                                                                                                    |
| `/library`                        | Project library (templates, local projects, repos)                                                               |
| `/members`                        | Team members list                                                                                                |
| `/monitoring`                     | Empty placeholder (`<div />`)                                                                                    |
| `/servers`                        | Server list with reachability probes, cluster/networking tabs                                                    |
| `/servers/new`                    | Add server wizard (credentials → health check → component install)                                               |
| `/servers/[serverId]`             | Server detail (6 tabs: overview, components, github, security, ports, terminal)                                  |
| `/settings`                       | Settings (9 tabs: general, tokens, mcp, team, notifications, email, audit, instance)                             |
| `/settings/migration/switch-back` | Reverse migration wizard (team → single-user)                                                                    |

#### Onboarding Pages (1)

| Route         | Description                                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| `/onboarding` | Desktop onboarding wizard (7 steps: choose, selfhost/ssh/tunnel, preferences, loading) |

#### Standalone Pages (8)

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `/accept-invite/[id]`     | Org invitation acceptance                              |
| `/api/proxy/[...path]`    | SSR API proxy route handler                            |
| `/auth/callback/close`    | OAuth callback closer (window.close)                   |
| `/auth/callback/install`  | GitHub App install callback page                       |
| `/authorize`              | OAuth authorization page                               |
| `/cloud-authorize`        | _(removed — HosteraX does not provide cloud services)_ |
| `/cloud-connect-callback` | _(removed — HosteraX does not provide cloud services)_ |
| `/mcp/authorize`          | MCP token authorization page                           |

### 8.2 Marketing Site Pages (`apps/web`) — ~30 Public URLs

| Route                          | Description                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                            | Home page (Navbar, Hero, Dashboard, Features, HowItWorks, DeploymentModels, CompletePlatform, MailServer, Comparison, OpenSource, FinalCta, Footer) |
| `/pricing`                     | Pricing page with FAQ, plan matrix                                                                                                                  |
| `/trust`                       | Trust & Security page (8 pillars)                                                                                                                   |
| `/terms`                       | Terms of Service                                                                                                                                    |
| `/privacy`                     | Privacy Policy                                                                                                                                      |
| `/about`                       | About page (team)                                                                                                                                   |
| `/contact`                     | Contact page (5 channels)                                                                                                                           |
| `/roadmap`                     | Product roadmap (5 phases)                                                                                                                          |
| `/download`                    | Download page (platform-aware cards, CLI install tabs)                                                                                              |
| `/login`                       | Login redirect to app.hosteraX.io                                                                                                                   |
| `/resources`                   | Resources/blog listing with category filters                                                                                                        |
| `/resources/[slug]`            | Individual resource article                                                                                                                         |
| `/changelog`                   | Changelog listing                                                                                                                                   |
| `/changelog/[slug]`            | Individual changelog entry                                                                                                                          |
| `/mail`                        | Mail landing page                                                                                                                                   |
| `/mail/setup-guide/ios`        | iOS & macOS Mail setup                                                                                                                              |
| `/mail/setup-guide/android`    | Android Gmail app setup                                                                                                                             |
| `/mail/setup-guide/desktop`    | Desktop client setup (Thunderbird, Outlook, K-9)                                                                                                    |
| `/mail/setup-guide/nodemailer` | Send mail via code (Node/Python/Go SMTP examples)                                                                                                   |
| `/docs`                        | Documentation home                                                                                                                                  |
| `/docs/[...slug]`              | Full documentation (54 files across 7 categories)                                                                                                   |
| `/docs/[...slug].md`           | Raw markdown variant (for LLMs)                                                                                                                     |
| `/llms.txt`                    | LLM catalog (llmstxt.org convention)                                                                                                                |
| `/llms-full.txt`               | All docs concatenated as markdown                                                                                                                   |
| `/api/search`                  | Full-text search API (⌘K dialog)                                                                                                                    |
| `/sitemap.xml`                 | Sitemap index                                                                                                                                       |
| `/sitemaps/pages.xml`          | Pages sitemap                                                                                                                                       |
| `/sitemaps/docs.xml`           | Docs sitemap                                                                                                                                        |
| `/sitemaps/resources.xml`      | Resources sitemap                                                                                                                                   |
| `/robots.txt`                  | Robots file                                                                                                                                         |

### 8.3 Docs Content — 54 Files

| Category        | Files | Topics                                                                                                                                                                              |
| --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Getting Started | 4     | Quickstart, Installation, First Deployment, Core Concepts                                                                                                                           |
| Architecture    | 5     | Overview, Runtime Model, Modules, Data Ownership                                                                                                                                    |
| Guides          | 21    | GitHub deploy, Local folder, Template/URL, Env vars, Compose, Custom domains, Servers, Backups, Auto-deploy, Email, Jobs, Logs, Preview envs, Rollback, Sleep mode, Teams, Updating |
| CLI             | 6     | Overview, Access, Deploy, Projects, Run, Self-host                                                                                                                                  |
| Security        | 4     | Auth, Isolation, Permissions                                                                                                                                                        |
| Troubleshooting | 7     | Overview, Common errors, Deployments, Desktop data, Domains/SSL, GitHub, Servers/SSH                                                                                                |
| Dashboard       | 9     | Overview, Backups, Billing, Deploy wizard, Emails, Library, Projects, Servers, Settings                                                                                             |
| API             | 26    | All API endpoints documentation                                                                                                                                                     |

### 8.4 Changelog — 4 Entries

- `v0-2-2.mdx`, `v0-2-0.mdx`, `v0-1-1.mdx`, `v0-1-0.mdx`

### 8.5 Resources/Blog — 3 Articles

- `introducing-hosteraX.mdx` — Product announcement
- `self-hosting-cost-breakdown.mdx` — TCO comparison vs Vercel/Railway/Fly
- `how-ai-builds-work.mdx` — AI agent build pipeline

---

## 9. All API Endpoints

### 9.1 Route Groups (34 Modules)

| Module              | Route Prefix                     | Description                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| health              | `GET /api/health`                | Health check                                                                                                                                                                                                                                                                                                        |
| auth                | `/api/auth/*`                    | Better Auth (sign-in, sign-up, sessions, OAuth, MCP) + bootstrap, OAuth token                                                                                                                                                                                                                                       |
| projects            | `/api/projects`                  | Full CRUD, env vars, resources, cleanup, transfer, folder upload                                                                                                                                                                                                                                                    |
| services            | `/api/projects/:id/services`     | Service CRUD, container management, env vars                                                                                                                                                                                                                                                                        |
| apps                | `/api/apps`                      | App catalog listing, template install, settings                                                                                                                                                                                                                                                                     |
| app-settings        | `/api/projects/:id/app-settings` | Day-2 settings for installed apps                                                                                                                                                                                                                                                                                   |
| deployments         | `/api/deployments`               | Full CRUD, build pipeline, SSL, smart route, rollback, logs (SSE)                                                                                                                                                                                                                                                   |
| domains             | `/api/domains`                   | CRUD, verify, primary, records, renew, SSL cert management                                                                                                                                                                                                                                                          |
| webhooks            | `/api/webhooks`                  | Unified signed webhook entry: GitHub only (Stripe uses own SDK route); WebhookProvider interface (verify+handle); 5MB body limit; webhook-ingress rate-limit policy                                                                                                                                                 |
| github              | `/api/github`                    | GitHub App webhooks (push, installation, check-run, changed-files) + OAuth                                                                                                                                                                                                                                          |
| analytics           | `/api/analytics`                 | Request analytics, usage stats, deployment stats, geo analytics, real-time SSE usage stream, container info, server analytics with on-demand scrape                                                                                                                                                                 |
| tokens              | `/api/tokens`                    | PAT CRUD (create/list/revoke), scoped grants (8 resource types: project/server/mail_server/backup_destination/billing/audit/github_installation/github_repository), read-only tokens, expiry (1-365 days), "projects it creates" scope, MCP OAuth client authorize/list/disconnect                                  |
| health              | `/api/health`                    | GET /health/env — authMode (none/local), teamMode (single_user/migrated), deployMode, version, machine name, host domain                                                                                                                                                                                            |
| billing             | `/api/billing`                   | _(removed — HosteraX does not provide cloud services)_                                                                                                                                                                                                                                                              |
| cloud               | `/api/cloud`                     | _(removed — HosteraX does not provide cloud services)_                                                                                                                                                                                                                                                              |
| backups             | `/api/backups`                   | Full CRUD, 3 trigger types, SSE, restore, retention                                                                                                                                                                                                                                                                 |
| backup-destinations | `/api/backup-destinations`       | CRUD + test connection                                                                                                                                                                                                                                                                                              |
| images              | `/api/images`                    | Image catalog listing                                                                                                                                                                                                                                                                                               |
| jobs                | `/api/jobs`                      | CRUD + run + SSE for system + custom jobs                                                                                                                                                                                                                                                                           |
| notifications       | `/api/notifications`             | Channels, subscriptions, deliveries                                                                                                                                                                                                                                                                                 |
| permissions         | `/api/permissions`               | Grants, invitations, pending-grant prune                                                                                                                                                                                                                                                                            |
| settings            | `/api/settings`                  | Platform settings: build mode (auto/server/local), deploy defaults (local/server), clone credentials (encrypted at rest, never returned), clone strategy (prompt/local/remote-with-token), transfer prefs (mode: auto/stream/direct/rsync; compression: auto/zstd/gzip/none)                                        |
| notices             | `/api/notices`                   | Platform status notices/banners: public read, internalAuth write; 3 severities (critical/recommended/info); 4 targets (platform/app/project/mail); scheduleable start/end; action URL validation (http/s only)                                                                                                      |
| jobs                | `/api/jobs`                      | System + custom scheduled jobs; self-hosted only; SSE live output stream; cron/once/manual schedule; retry with backoff; multi-server fan-out; env/secrets (encrypted at rest); dependencies; 7 event triggers (deploy/backup/restore/SSL/domain); per-job notification overrides                                   |
| system              | `/api/system`                    | Onboarding, servers CRUD, tunnels, filesystem, migration                                                                                                                                                                                                                                                            |
| terminal            | `/api/terminal`                  | SSH WebSocket terminal (ticket-based auth)                                                                                                                                                                                                                                                                          |
| service-terminal    | `/api/services/terminal`         | Container exec terminal (Docker)                                                                                                                                                                                                                                                                                    |
| mail                | `/api/mail`                      | Mail server: setup wizard (install/adopt/scan/cancel/DNS-ack/PTR-ack/reset), domain CRUD + DNS, mailbox CRUD, postmaster password, outbound relay (split delivery), backup policy, DNS scan, test email, component actions (restart-all, per-component logs), webmail deploy (as project or external BYO IMAP/SMTP) |
| service-terminal    | `/api/services/terminal`         | WebSocket-based interactive terminal into service containers (Docker exec); self-hosted only; single-use ticket auth with session-cookie fallback; boot-time orphan sweep                                                                                                                                           |
| terminal            | `/api/terminal`                  | Self-hosted only WebSocket SSH terminal into servers; single-use ticket auth + session-cookie fallback; boot-time orphan session sweep                                                                                                                                                                              |
| mail-server         | `/api/mail-server`               | DNS routing setup                                                                                                                                                                                                                                                                                                   |
| mcp                 | `/api/mcp`                       | Streamable-HTTP JSON-RPC endpoint (PAT-based)                                                                                                                                                                                                                                                                       |
| migration           | `/api/migration`                 | Docker migration (scan, adopt, preflight, reconcile, inspect)                                                                                                                                                                                                                                                       |
| notices             | `/api/notices`                   | Platform status notices (public + admin)                                                                                                                                                                                                                                                                            |
| audit               | `/api/audit`                     | Audit log listing, prune, prune-schedule                                                                                                                                                                                                                                                                            |
| updates             | `/api/updates`                   | Update scanning, one-click apply                                                                                                                                                                                                                                                                                    |
| tunneling           | (internal)                       | Tunnel provision/teardown/agent lifecycle (2 providers: ngrok, Cloudflare)                                                                                                                                                                                                                                          |
| route-rules         | `/api/route-rules`               | Custom routing rules (redirect, rewrite, header, ACL)                                                                                                                                                                                                                                                               |

### 9.2 Well-Known Endpoints

- `GET /.well-known/oauth-authorization-server` — OAuth 2.1 discovery
- `GET /.well-known/oauth-protected-resource` — OAuth protected resource

---

## 10. Database Schema

### 10.1 Main Schema — 38 Tables (`@repo/db`)

#### Auth (Better Auth)

- `user` — id, name, email, emailVerified, image, role, autoProvisioned, createdAt, updatedAt
- `session` — id, expiresAt, token, userId, ipAddress, userAgent, activeOrganizationId, createdAt, updatedAt
- `account` — id, accountId, providerId, userId, accessToken, refreshToken, idToken, scope, password, createdAt, updatedAt
- `verification` — id, identifier, value, expiresAt, createdAt, updatedAt

#### Organization

- `organization` — id, name, slug, logo, createdAt, updatedAt
- `member` — id, organizationId, userId, role (owner/admin/member), createdAt, updatedAt
- `invitation` — id, organizationId, email, role, status, expiresAt, createdAt, updatedAt

#### Project System

- `project_app` (projectGroup) — id, organizationId, name, slug, gitProvider, gitOwner, gitRepo, gitUrl, githubInstallationId, logo, createdAt, updatedAt
- `project` — id, organizationId, groupId, name, slug, environmentName, environmentSlug, environmentType, isApp, appTemplateId, gitProvider, gitOwner, gitRepo, gitBranch, gitUrl, installationId, commitSha, framework, packageManager, buildCommand, installCommand, startCommand, port, hasServer, hasBuild, outputDirectory, productionMode, resources, buildResources, sleepMode, runtimeMode, autoDeploy, activeDeploymentId, routingConfig, createdAt, updatedAt
- `envVar` — id, projectId, serviceId, key, value (encrypted), environment, isSecret, createdAt, updatedAt

#### Deployments

- `deployment` — id, projectId, organizationId, branch, commitSha, commitShaBefore, trigger, environment, framework, status, imageRef, buildDurationMs, version, releaseVersion, containerId, url, meta, envVars, errorMessage, changedPaths, forceAll, rollbackStrategy, artifactRetainedAt, pinned, createdAt, updatedAt
- `build_session` — id, deploymentId, projectId, status, logs (JSON), durationMs, createdAt, updatedAt
- `deployment_check_run` — id, deploymentId, checkRunId, checkRunUrl, createdAt

#### Services

- `service` — id, projectId, kind (compose/monorepo), name, image, build, ports, dependsOn, environment, volumes, command, restart, exposed, exposedPort, domain, customDomain, domainType, publicEndpoints, rootDirectory, installCommand, buildCommand, startCommand, framework, packageManager, alwaysRebuildGlobs, importedSpec, driftSpec, enabled, createdAt, updatedAt
- `service_deployment` — id, deploymentId, serviceId, serviceName, containerId, status, reason, imageRef, imageDigest, hostPort, ip, url, startedAt, finishedAt, durationMs, errorMessage, checkRunId, checkRunUrl, artifactRetainedAt

#### Domains

- `domain` — id, projectId, serviceId, hostname, targetPort, targetPath, domainType, isPrimary, externalIngress, manualSsl, status, verificationToken, verified, verifyAttempts, sslStatus, sslIssuer, sslExpiresAt, createdAt, updatedAt

#### Routing

- `route_rule` — id, domainId, projectId, serviceId, priority, description, action (redirect/rewrite/header/acl/rate_limit/ban), config (JSON), enabled, createdAt, updatedAt

#### Infrastructure

- `servers` — id, organizationId, label, hostname, port, username, authType (key/password/agent), status, reachable, version, createdAt, updatedAt
- `server_github_auth` — id, serverId, installationId, authToken, expiresAt, createdAt, updatedAt
- `github_deploy_key` — id, serverId, githubRepoId, publicKey, createdAt
- `server_tunnel` — id, serverId, provider (ngrok/cloudflare), tunnelId, tunnelUrl, status, expiresAt, createdAt, updatedAt
- `server_analytics` — id, serverId, type, periodStart, metrics (JSON), createdAt
- `server_analytics_geo` — id, serverId, periodStart, countryCode, requests, bandwidth, createdAt
- `server_module_status` — id, serverId, module, version, status, checkedAt, createdAt, updatedAt
- `docker_migration_run` — id, serverId, status, discovered (JSON), adopted (JSON), logs (JSON), createdAt, updatedAt

#### Backup

- `backup_destination` — id, organizationId, name, type (s3/local), config (JSON, encrypted), createdAt, updatedAt
- `backup_policy` — id, organizationId, projectId, name, cron, retention, destinations (JSON), enabled, createdAt, updatedAt
- `backup_run` — id, policyId, projectId, organizationId, trigger, status, steps (JSON), startedAt, finishedAt, durationMs, sizeBytes, artifactPath, verified, errorMessage, createdAt
- `backup_restore` — id, backupRunId, projectId, organizationId, status, startedAt, finishedAt, errorMessage, createdAt

#### Billing

- `billing_customer` — _(removed — HosteraX does not provide cloud/billing services)_
- `billing_subscription` — _(removed — HosteraX does not provide cloud/billing services)_
- `credit_pack` — _(removed — HosteraX does not provide cloud/billing services)_
- `stripe_webhook_event` — _(removed — HosteraX does not provide cloud/billing services)_
- `cloud_webhook_event` — _(removed — HosteraX does not provide cloud services)_
- `stripe_topup_grant` — _(removed — HosteraX does not provide cloud services)_
- `billing_anniversary_grant` — _(removed — HosteraX does not provide cloud services)_
- `billing_usage_snapshot` — _(removed — HosteraX does not provide cloud services)_

#### Notifications

- `notification_channel` — id, organizationId, type (in_app/email/webhook/slack), name, config (JSON), enabled, createdAt, updatedAt
- `notification_subscription` — id, userId, channelId, eventTypes (JSON), enabled, createdAt
- `notification_default` — id, organizationId, eventType, channels (JSON), createdAt, updatedAt
- `notification_delivery` — id, subscriptionId, eventType, channelType, status, error, deliveredAt, createdAt

#### Other

- `audit_event` — id, organizationId, userId, action, resourceType, resourceId, metadata (JSON), ipAddress, userAgent, createdAt
- `job` — id, organizationId, key, name, description, trigger (JSON), action (JSON), retryConfig (JSON), notifyConfig (JSON), enabled, createdAt, updatedAt
- `job_run` — id, jobId, status, trigger, startedAt, finishedAt, durationMs, output, error, createdAt
- `git_installation` — id, githubInstallationId, accountId, accountLogin, accountType, repositorySelection, permissions (JSON), createdAt, updatedAt
- `github_install_state` — id, state, installationId, expiresAt, createdAt
- `github_webhook_event` — id, eventType, payload (JSON), processed, error, createdAt
- `personal_access_token` — id, userId, name, token (hashed), scopes (JSON), expiresAt, lastUsedAt, createdAt, updatedAt
- `personal_access_token_grant` — id, tokenId, resourceType, resourceId, permissions (JSON), createdAt
- `oauth_application` — id, name, clientId, clientSecret, redirectUris, allowedScopes, createdAt, updatedAt
- `oauth_access_token` — id, clientId, userId, scopes, expiresAt, createdAt
- `oauth_consent` — id, clientId, userId, scopes, grantedAt
- `resource_grant` — id, organizationId, resourceType, resourceId, permissions (JSON), principalType (user/member), principalId, createdAt, updatedAt
- `invitation_pending_grant` — id, invitationId, resourceType, resourceId, permissions (JSON), createdAt
- `user_settings` — id, userId, settings (JSON), createdAt, updatedAt
- `instance_settings` — id, key, value (JSON), updatedAt
- `system_notice` — id, title, message, severity, active, createdAt, updatedAt
- `update_status` — id, entityType, entityId, currentVersion, latestVersion, status, checkedAt, createdAt, updatedAt
- `terminal_sessions` — id, sessionId, userId, serverId, containerId, connectedAt, disconnectedAt
- `service_terminal_sessions` — id, sessionId, userId, serviceId, containerId, connectedAt, disconnectedAt
- `orphaned_resource` — id, resourceType, resourceId, reason, detectedAt, resolvedAt
- `mail_servers` — id, organizationId, serverId, domain, status, config (JSON), createdAt, updatedAt
- `cloud_handoff_code` — _(removed — HosteraX does not provide cloud services)_
- `cloud_webhook_binding` — _(removed — HosteraX does not provide cloud services)_

### 10.2 Email Schema (`@repo/db-email`) — 16 Tables

Schema `vmail`:

- `admin` — Admin users for mail server
- `alias` — Email aliases
- `moderators` — Mailing list moderators
- `maillist_owners` — Mailing list owners
- `forwardings` — Email forwardings
- `domain` — Mail domains
- `alias_domain` — Domain aliases
- `domain_admins` — Domain administrators
- `mailbox` — Mailboxes (quota, password, settings)
- `maillists` — Mailing lists
- `sender_bcc_domain/user` — BCC rules
- `recipient_bcc_domain/user` — BCC rules
- `sender_relayhost` — Relay host configuration
- `deleted_mailboxes` — Soft-deleted mailboxes
- `share_folder` — Shared folders
- `anyone_shares` — Public shares
- `last_login` — Last login timestamps
- `used_quota` — Quota usage tracking

Schema `mail_app`:

- Zero webmail app state (settings, summaries, notes)

---

## 11. Design System & Tokens

### 11.1 Marketing Theme Tokens (`theme.css`)

The marketing site defines comprehensive CSS custom properties:

```css
/* Foreground scale (black opacity) */
--th-on-05, --th-on-06, --th-on-08, --th-on-10, --th-on-12, --th-on-16,
--th-on-20, --th-on-30, --th-on-40, --th-on-50, --th-on-60, --th-on-70,
--th-on-80, --th-on-90, --th-on-95, --th-on-100

/* Surface fill scale */
--th-sf-01 through --th-sf-08

/* Text colors */
--th-text-heading, --th-text-title, --th-text-strong, --th-text-body,
--th-text-secondary, --th-text-muted, --th-text-label, --th-text-hint, --th-text-ghost

/* Page backgrounds */
--th-bg-page, --th-bg-card, --th-bg-subtle, --th-bg-hover, --th-bg-inset

/* Borders */
--th-bd-default, --th-bd-subtle, --th-bd-strong, --th-bd-card

/* Component-level */
--th-btn-bg, --th-btn-text, --th-btn-bg-hover
--th-btn-ghost-bd, --th-btn-ghost-text, --th-btn-ghost-bd-hover, etc.
--th-card-bg, --th-card-bd, --th-card-bd-hover, --th-card-shadow

/* Semantic accent colors */
--th-clr-plum (#6C5CE7), --th-clr-terra (#E05874), --th-clr-sea (#00B894),
--th-clr-amber (#FFEAA7) with -soft, -wash, -bg, -blob, -bdr, -tag variants

/* Aurora glow palette */
--th-aurora-violet-strong/mid/soft, --th-aurora-amber-strong/mid/soft,
--th-aurora-peach-strong/mid, --th-aurora-lavender

/* Terminal */
--th-terminal-bg, --th-terminal-text, --th-terminal-muted,
--th-terminal-green, --th-terminal-red, --th-terminal-blue, --th-terminal-yellow

/* Utility classes */
.th-text-*, .th-bg-*, .th-card, .th-btn, .th-btn-ghost, .th-bd-*, .th-divider
```

### 11.2 Dashboard Theme Tokens (`theme.css`)

Dashboard uses its own theme.css (479 lines) with light/dim/dark mode support:

- `.th-light`, `.th-dim`, `.th-dark` mode classes
- `--th-*` tokens similar to marketing but with dim/dark variants
- shadcn CSS variable bridge for component theming

### 11.3 Design Language — Large Rounded

| Element                           | Border Radius            |
| --------------------------------- | ------------------------ |
| Full-width sections (DarkSection) | `clamp(32px, 5vw, 56px)` |
| Cards / visual containers         | 24px                     |
| Tiles / inner panels              | 16px                     |
| Icon badges / small elements      | 12px                     |
| Pills / status badges             | 999px (full pill)        |
| Circles (dots, avatars)           | 50%                      |

### 11.4 Typography

- **Primary:** Gellix (self-hosted on cdn.hosterax.io), 9 weights (100-900)
- **RTL fallback:** SF Arabic
- **Dashboard:** System font stack (via Tailwind)

### 11.5 Icon System

- **Primary:** Lucide React (dashboard + landing)
- **Stack icons:** DevIcon CDN (for 42 supported stacks)
- **App logos:** SimpleIcons + favicon resolution
- **Custom icons:** 35+ mail landing page SVG icon components
- **Theme icons:** Monokai Pro icon font mappings

### 11.6 Animation System

- **Landing:** GSAP v3 + ScrollTrigger for scroll-linked animations
- **Dashboard:** Motion v12 (Framer Motion) for UI transitions
- **Aurora breathing:** CSS keyframes (16s cycle)
- **Feature cards:** Top-edge highlight on hover
- **Dashboard showcase:** Perspective rotation on hover
- **Toast animations:** sonner glassmorphic toasts

### 11.7 Gap: Design Token Consolidation

- Marketing site tokens are light-only (no dark mode tokens defined)
- Dashboard has its own token system (partially overlapping)
- No shared token package between dashboard and marketing
- Missing: shadow scale, spacing scale, transition tokens, z-index scale

---

## 12. Localization System

### 12.1 Supported Locales (8)

| Code | Language   | File Count    | RTL |
| ---- | ---------- | ------------- | --- |
| `en` | English    | 23 namespaces | No  |
| `ar` | Arabic     | 21 namespaces | Yes |
| `de` | German     | 19 namespaces | No  |
| `es` | Spanish    | 19 namespaces | No  |
| `fr` | French     | 22 namespaces | No  |
| `ja` | Japanese   | 20 namespaces | No  |
| `pt` | Portuguese | 19 namespaces | No  |
| `zh` | Chinese    | 20 namespaces | No  |

### 12.2 Translation Namespaces (23)

`auth`, `billing`, `brand`, `chrome`, `dashboard`, `deploy`, `deployments`, `emails`, `emailsAdmin`, `importProject`, `jobs`, `library`, `migration`, `misc`, `onboarding`, `overview`, `projectDetail`, `projectSettings`, `projects`, `servers`, `settings`, `widgets`

### 12.3 Implementation

- Dynamic JSON loading via webpack context
- Deep merge for locale overrides
- RTL detection via Arabic language code
- Language switcher component in sidebar

---

## 13. Infrastructure & Deployment

### 13.1 Docker Compose Stack

| Service   | Image/Base              | Port            | Depends On      |
| --------- | ----------------------- | --------------- | --------------- |
| postgres  | postgres:16-alpine      | 5432 (internal) | —               |
| redis     | redis:7-alpine          | 6379 (internal) | —               |
| api       | Custom (oven/bun)       | 4000            | postgres, redis |
| dashboard | Custom (node:22-alpine) | 3001            | api             |
| web       | Custom (node:22-alpine) | 3000            | —               |

### 13.2 Desktop App Build

**Platforms:**

- Windows: .zip (Squirrel)
- macOS: .dmg (arm64 + x64, signed + notarized)
- Linux: .AppImage

**Build pipeline:**

1. `bun build/bundle.mjs` — bundles main + preload via esbuild
2. `bun build/stage.ts` — compiles hosteraX-api binary, stages dashboard standalone, copies PGlite + migrations
3. `electron-forge make` — packages into platform installers

### 13.3 CLI Deployment

- Published as `hosteraX` npm package
- Uses OIDC trusted publishing
- Build via tsup (bundles into a single executable)

### 13.4 API Build

- Compiled via tsup (TypeScript → JavaScript)
- Runs on Bun runtime
- Auto-migrates Postgres/PGlite on boot

### 13.5 Dashboard Build

- Next.js `output: "standalone"`
- `outputFileTracingRoot` set to monorepo root
- `transpilePackages`: `@repo/ui`, `@repo/core`

### 13.6 Web Build

- Next.js `output: "standalone"`
- Static MDX content via FumaDocs

### 13.7 Root Configuration Files

| File                  | Purpose                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo.json`          | Turborepo task orchestration: `build` (cached, dependsOn `^build`), `dev` (persistent, uncached), `lint`/`test` (dependsOn build), `db:*` (uncached) |
| `tsconfig.base.json`  | Shared TS strict config: ES2022 target, ESNext modules, bundler resolution, declaration + sourceMap                                                  |
| `pnpm-workspace.yaml` | Defines workspace paths: `apps/*`, `packages/*`                                                                                                      |
| `.bun-version`        | Pinned Bun version (1.3.10)                                                                                                                          |
| `.nvmrc`              | Pinned Node version (22)                                                                                                                             |
| `.env.example`        | Docker Compose env template                                                                                                                          |

### 13.8 Installation & Onboarding Scripts

| Script                       | Lines | Platform    | Purpose                                                                                                                                                                                                                               |
| ---------------------------- | ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/install.sh`         | 113   | Linux/macOS | One-line `curl \| sh` installer; installs Bun (with `unzip` auto-install via apt/dnf/yum/apk/pacman/zypper), then the hosterax CLI globallly; detects+heals broken installs (issue #21); wires Bun-based launcher when Node is absent |
| `scripts/install.ps1`        | 40    | Windows     | `irm ... \| iex` installer; installs Bun then the CLI                                                                                                                                                                                 |
| `installer-builder.ts` (CLI) | —     | All         | Desktop app installer builder (`hosterax install`)                                                                                                                                                                                    |

### 13.9 GeoIP Database

- Vendored at `apps/api/assets/geoip/GeoLite2-Country.mmdb`
- Updated via `scripts/update-geoip.mjs` — fetches from P3TERX mirror (or `GEOIP_UPSTREAM_URL` override), sanity-checks size (>1 MB)
- Updated at maintainer/CI time, committed to repo

### 13.10 In-App Advisory System

- `release-advisories.json` — version-targeted advisories displayed in desktop + dashboard

### 13.11 Documentation Files

| Document                                     | Purpose                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/installation.md`                       | 3-shape install guide: Desktop app (solo/private), Self-hosted on server (CLI `hosterax up`), Docker Compose; full CLI reference (42 commands across 4 categories); user access model (invite-only, no public signup)          |
| `docs/edge-routing-requirements.md`          | Out-of-scope: retains edge-routing design spec for future reference if upstream integration is re-evaluated. HosteraX uses OpenResty only (self-hosted routing).                                                               |
| `docs/i18n/README.{ar,de,es,fr,ja,pt,zh}.md` | 7 translated READMEs (Arabic RTL, German, Spanish, French, Japanese, Portuguese, Chinese)                                                                                                                                      |
| `CHANGELOG.md`                               | Release changelog (0.2.0, 0.2.2 highlights)                                                                                                                                                                                    |
| `CONTRIBUTING.md`                            | Dev setup (Bun, env, Docker), project structure, conventions (Conventional Commits), API module pattern, DB commands, verification commands                                                                                    |
| `SECURITY_GUIDE.md`                          | Security-sensitive surface map for auditors: 10 attack-surface sections (HTTP auth, webhooks, SSH exec, git clone/credential relay, mail provisioning, webmail, secrets at rest, domains/SSL, tokens/PAT) + reviewer checklist |
| `SECURITY.md`                                | Vulnerability disclosure policy (already referenced)                                                                                                                                                                           |
| `README.md`                                  | Main project README (already referenced)                                                                                                                                                                                       |

- Served from `raw.githubusercontent.com/hosterax/hosterax/<tag>/release-advisories.json`
- Fields: `id`, `severity` (critical/recommended/info), `affects` (semver range), `title`, `message`, `action`
- Critical advisories surface even when notifications are muted

---

## 14. Build & CI/CD Pipeline

### 14.1 GitHub Actions

**CI (`ci.yml`):**

- Trigger: PR + push to main
- Steps: Checkout → Setup Bun → Cache → Install → Typecheck API (`turbo run lint`) → Typecheck dashboard (`npx tsc --noEmit` with fumadocs errors filtered out)

**Release (`release.yml`):**

- Trigger: Version tags (`v*.*.*`) or manual `workflow_dispatch`
- Concurrency: per-tag, no cancel-in-progress
- Jobs (7 total, sequential publish):
  1. `build-hosterax` — `bun run --cwd apps/api build-release`, tars `release-dist/`
  2. `build-email` — `bun run --cwd apps/email build`, tars `dist/`
  3. `build-dashboard` — Next.js standalone build, copies `.next/standalone` + `static/` + `public/`
  4. `build-desktop` (matrix: Windows x64 + Linux x64) — `bun run --cwd apps/desktop make`, outputs `.zip` / `.AppImage`
  5. `build-desktop-macos` (macos-14) — `electron-forge make --arch=arm64` + `--arch=x64`, codesign + notarize + staple DMGs (gated on `APPLE_IDENTITY`)
  6. `publish-npm` — OIDC trusted publishing, strips workspace deps from manifest, `--tag next` for prereleases
  7. `publish` — creates GitHub Release with all artifacts; `--prerelease` for tags containing `-`

### 14.2 Local Development

```bash
# Start API + Dashboard
bun dev

# Start specific app
bun dev:api          # API only
bun dev:dashboard    # Dashboard only
bun dev:web          # Marketing site only
bun dev:desktop      # Desktop app only

# Start all apps
bun dev:all

# Database commands
bun db:generate    # Generate Drizzle migrations
bun db:push        # Push schema to DB
bun db:migrate     # Run migrations

# Build production
bun run build

# Run tests
bun run test

# Lint
bun run lint
```

### 14.3 Release Process

```bash
bun scripts/release.ts 0.2.2    # or: patch | minor | major | rc | current | --dry-run
```

The release script (`scripts/release.ts`, 411 lines):

1. **Preflight** (3 checks): clean working tree, on `main` branch (override `--force-branch`), up-to-date with origin
2. **Version compute** from `apps/api/package.json`; detects drift vs root `package.json`
3. **Bump kinds**: `patch`/`minor`/`major` (semver bump), `rc` (next rc or rc→stable promotion), `current` (re-release as-is), `<literal>` (explicit semver)
4. **Syncs version** across 6 `package.json` files: root, api, dashboard, web, desktop, cli, email
5. **Refuses** if tag already exists
6. Commits `"Bump to vX.Y.Z"`, pushes branch, tags `vX.Y.Z`, pushes tag
7. **Live CI watch**: polls `gh run list` for the matching tag-triggered run, then streams `gh run watch`

### 14.4 Docker Build Configuration

Each deployable app has its own Dockerfile:

| App       | Dockerfile                                        | Base Image                     |
| --------- | ------------------------------------------------- | ------------------------------ |
| api       | `apps/api/Dockerfile`                             | `oven/bun` (distroless)        |
| dashboard | `apps/dashboard/Dockerfile`                       | `node:22-alpine`               |
| web       | `apps/web/Dockerfile`                             | `node:22-alpine`               |
| email     | `apps/email/Dockerfile`                           | Multi-stage (builder + runner) |
| Compose   | `docker-compose.yml` + `docker-compose.email.yml` | Full stack orchestration       |

Build configs include:

- Docker `.dockerignore` files per app
- `.env.example` files for each app (api, dashboard, web)
- `tsconfig.json` per workspace (extends root `tsconfig.json`)
- Desktop entitlements: `apps/desktop/entitlements.mac.plist`, `apps/desktop/entitlements.daemon.plist`

### 14.5 Desktop Build Scripts

| Script                          | Purpose                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/desktop/build/stage.ts`   | Compiles hosteraX-api binary, stages dashboard standalone build, copies PGlite + migrations into the bundle |
| `apps/desktop/build/bundle.mjs` | esbuild bundler for Electron main + preload scripts with source maps                                        |
| `apps/desktop/build/run.mjs`    | Dev runner: spawns API + dashboard, then launches Electron window                                           |

### 14.6 CLI Build

| Script                              | Purpose                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/cli/build/stage-server.ts`    | Bundles server (api) as a single executable tarball for the CLI's `hosteraX up` command |
| `apps/cli/build/stage-dashboard.ts` | Bundles dashboard as a standalone Next.js build for the CLI                             |

### 14.7 Additional Scripts (`scripts/`)

| Script                     | Lines | Purpose                                                                                                                                                                                                      |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/release.ts`       | 411   | Full release automation: preflight (clean tree, on main, up-to-date), version compute (patch/minor/major/rc/literal), sync 6 package.json files, commit, push, tag, push tag, live CI watch (`gh run watch`) |
| `scripts/install.sh`       | 113   | Unix one-line installer (curl \| sh) — installs Bun + hosterax CLI globally, heals broken installs, wires Bun launcher if Node absent                                                                        |
| `scripts/install.ps1`      | 40    | Windows installer (irm \| iex) — installs Bun + CLI                                                                                                                                                          |
| `scripts/update-geoip.mjs` | 39    | GeoLite2 Country DB updater — 1M+ byte sanity check                                                                                                                                                          |

### 14.8 Commit Hooks (`.githooks/`)

| Hook                 | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `post-merge`         | Re-runs install after git pull                          |
| `post-rewrite`       | Handles post-rebase dependency sync                     |
| `_dev-stale-warn.sh` | Internal helper — warns when dev dependencies are stale |

---

## 15. Gap Analysis & Recommendations

### 15.1 Critical Gaps

| #   | Gap                                         | Impact                                                  | Recommended Feature                                                                                          |
| --- | ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | No real-time deployment dashboard widget    | Users must navigate to deployment list to see status    | **Live Deploy Feed** — Dashboard overview shows real-time deployment activity feed with auto-updating status |
| 2   | No project comparison or search             | Hard to find projects in large orgs                     | **Project Search & Filter** — Search by name, filter by environment, framework, status                       |
| 3   | No deployment comparison view               | Can't diff config between deployments                   | **Deployment Diff View** — Side-by-side comparison of env vars, services, build config                       |
| 4   | No service health dashboard                 | Service crashes go unnoticed                            | **Service Health Dashboard** — Live health indicators, uptime % per service, incident timeline               |
| 5   | No custom metrics / alerting                | No proactive problem detection                          | **Metrics Alerts** — Configurable thresholds for CPU, memory, response time, with notification actions       |
| 6   | No collaborative deployment comments        | Team can't discuss deployments                          | **Deployment Annotations** — Comment threads on deployments for team review                                  |
| 7   | No template/project cloning                 | Setting up similar projects is repetitive               | **Project Templates** — Save project config as reusable template; clone from existing project                |
| 8   | No resource quota visualization             | Users don't know when they'll hit limits                | **Resource Quota Gauges** — Visual usage meters for CPU, memory, storage, bandwidth per org                  |
| 9   | No guided onboarding wizard for new users   | Steep learning curve                                    | **Interactive Onboarding Tour** — Step-by-step walkthrough for first project setup                           |
| 10  | No mobile-responsive dashboard              | Can't monitor on mobile                                 | **Mobile Dashboard** — Responsive layout with key metrics, push notifications                                |
| 11  | Monitoring page is empty placeholder        | `/monitoring` returns `<div />`                         | **Monitoring Dashboard** — Full monitoring implementation with charts, alerts, logs                          |
| 12  | No design token consolidation               | Duplicate theme systems between dashboard and marketing | **Shared Design Token Package** — Unified `--th-*` tokens across all apps                                    |
| 13  | Shared UI package is minimal (4 components) | Dashboard has its own `ui/` with overlapping primitives | **UI Package Expansion** — Move shared primitives (Input, Select, Modal, Tabs, etc.) to `@repo/ui`           |
| 14  | No form validation library                  | Hand-rolled forms are inconsistent                      | **React Hook Form + Zod integration** — Consistent form validation across dashboard                          |

### 15.2 High-Value Enhancements

| #   | Feature                             | Description                                                       | Priority |
| --- | ----------------------------------- | ----------------------------------------------------------------- | -------- |
| 15  | **Deployment Rollout Progress Bar** | Visual progress indicator for rolling deployments across services | High     |
| 16  | **Environment Variable Diff**       | Side-by-side comparison across environments (prod vs staging)     | High     |
| 17  | **One-click Database Restore**      | From dashboard — trigger DB restore without CLI                   | High     |
| 18  | **Build Timeline Visualization**    | Gantt-style chart of build steps with durations                   | Medium   |
| 19  | **Git Branch Visualization**        | Visual tree of branches with deployment status per branch         | Medium   |
| 20  | **Service Dependency Graph**        | Visual graph showing service connections                          | Medium   |
| 21  | **Audit Log Viewer Enhancements**   | Searchable, filterable audit log with date range                  | Medium   |
| 22  | **Notification Test Button**        | Send test notification to verify channel config                   | Medium   |
| 23  | **SSL Certificate Expiry Banner**   | Global banner when cert is within 14 days of expiry               | Low      |
| 24  | **Dark Mode for Marketing Site**    | System-respecting dark mode for landing pages                     | Low      |
| 25  | **Keyboard Shortcuts**              | `g p` → projects, `g d` → deployments, `?` → shortcut reference   | Low      |
| 26  | **Bulk Actions**                    | Select multiple deployments/projects and perform batch actions    | Low      |
| 27  | **Full-text Deployment Log Search** | Search across all build/deployment logs                           | Low      |
| 28  | **Resource Usage Export**           | CSV/JSON export of analytics data                                 | Low      |
| 29  | **Project Star/Favorites**          | Pin frequently accessed projects to top of list                   | Low      |

### 15.3 Long-term Strategic Features

| #   | Feature                                  | Rationale                                                    |
| --- | ---------------------------------------- | ------------------------------------------------------------ |
| 30  | **Kanban-style Deployment Board**        | Deployments as cards (queued → building → deploying → ready) |
| 31  | **Cost Estimation Calculator**           | _(removed — HosteraX does not provide cloud services)_       |
| 32  | **Maintenance Mode Toggle**              | Show custom maintenance page during updates                  |
| 33  | **Webhook Log Viewer**                   | View incoming webhook payloads and delivery status           |
| 34  | **Custom Metrics Dashboard**             | User-defined dashboard panels from multiple data sources     |
| 35  | **White-label Dashboard**                | Custom branding for MSPs/enterprise                          |
| 36  | **SLA Tracking**                         | Uptime monitoring with SLA compliance reporting              |
| 37  | **Multi-region Deployment**              | Deploy to multiple geographic regions from one project       |
| 38  | **Database UI (phpPgAdmin alternative)** | Built-in database browser for Postgres                       |
| 39  | **Team Activity Feed**                   | Real-time activity feed for all team members                 |

---

## 16. UI Enhancement Roadmap

### Phase 1: Foundation (Current)

**Focus:** Core functionality, establish design system

- [x] Full dashboard layouts (sidebar, page-header, auth shell)
- [x] Deployment pipeline UI with live build logs (SSE)
- [x] Project settings forms (9-tab detail view)
- [x] Domain/routing management
- [x] Backup policy UI with restore wizard
- [x] Billing/credit UI with plans, usage, topups
- [x] Terminal integration (xterm.js WebSocket)
- [x] Theme provider (light/dim/dark)
- [x] Landing page with full section library (15 components)
- [x] MDX documentation (54 files)
- [x] Mail server admin panel (9 admin tabs)
- [x] Add server wizard (9-step auto-setup flow)
- [x] Internationalization (8 locales, 23 namespaces)
- [x] OAuth authorization screens
- [x] Empty/loading/error states for major views
- [x] Toast notification system (sonner)
- [x] GSAP scroll animations for landing page

### Phase 2: Polish (Recommended — Next 3 months)

**Focus:** UX refinement, design consistency, performance

| Item                               | Description                                                         | Effort |
| ---------------------------------- | ------------------------------------------------------------------- | ------ |
| **Dark Mode for Marketing**        | System-respecting dark mode for landing pages                       | Medium |
| **Responsive Dashboard**           | Mobile-responsive layouts for all dashboard pages                   | Large  |
| **Loading States**                 | Skeleton screens for every data-fetching view                       | Medium |
| **Empty States**                   | Informative empty states with CTA for all list views                | Medium |
| **Error States**                   | Consistent error boundaries, retry buttons, human-readable messages | Small  |
| **Breadcrumbs**                    | Breadcrumb navigation on nested pages                               | Small  |
| **Pagination/Infinite Scroll**     | For deployment lists, audit logs, job runs                          | Medium |
| **Form Validation UX**             | Inline validation with clear error messages                         | Medium |
| **Confirm Dialogs**                | Consistent destructive action confirmation modals                   | Small  |
| **Design Token Audit**             | Migrate dashboard to use `--th-*` tokens for consistency            | Large  |
| **Typography Scale**               | Define and apply consistent type scale across apps                  | Medium |
| **UI Package Expansion**           | Move shared primitives (Input, Select, Modal, Tabs) to `@repo/ui`   | Large  |
| **Monitoring Page Implementation** | Fill in the empty `/monitoring` placeholder                         | Medium |

### Phase 3: Delight (Recommended — 3-6 months)

**Focus:** Advanced interactions, animations, productivity

| Item                          | Description                                                    | Effort |
| ----------------------------- | -------------------------------------------------------------- | ------ |
| **Live Deploy Feed**          | Server-sent dashboard widget with real-time deployment updates | Medium |
| **Service Health Dashboard**  | Live health indicators with historical uptime                  | Medium |
| **Deployment Diff View**      | Side-by-side comparison of deployment configs                  | Medium |
| **Guided Onboarding Tour**    | Interactive walkthrough for first-time users                   | Medium |
| **Project Search & Filter**   | Instant search across projects with facet filters              | Medium |
| **Build Timeline Viz**        | Gantt-style build step visualization                           | Medium |
| **Service Dependency Graph**  | Interactive visual graph of service connections                | Large  |
| **Resource Quota Gauges**     | Circular/bar gauges for usage vs limits                        | Small  |
| **Keyboard Shortcuts**        | Power-user shortcuts with reference modal                      | Small  |
| **Bulk Actions**              | Multi-select and batch deploy/stop/restart                     | Small  |
| **Deployment Annotations**    | Comment threads on deployment events                           | Medium |
| **Animated Page Transitions** | Smooth route transitions via Motion                            | Medium |

### Phase 4: Advanced (6-12 months)

**Focus:** Proactive intelligence, automation, scale

| Item                        | Description                                            | Effort |
| --------------------------- | ------------------------------------------------------ | ------ |
| **Metrics Alerts Engine**   | Configurable thresholds with notification actions      | Large  |
| **Kanban Deployment Board** | Visual workflow for deployment lifecycle               | Medium |
| **Project Templates**       | Save/clone project configurations                      | Medium |
| **Webhook Log Viewer**      | Inspect webhook deliveries with replay                 | Medium |
| **Custom Dashboard Panels** | User-configurable dashboard widgets                    | Large  |
| **Cost Calculator**         | _(removed — HosteraX does not provide cloud services)_ | —      |
| **Maintenance Mode UI**     | One-click maintenance page toggle                      | Small  |
| **Mobile Dashboard**        | Native/safe-area responsive mobile experience          | Large  |
| **Multi-region Deploy UI**  | Region selector and geo-routing config                 | Large  |
| **White-label Branding**    | Custom logos, colors, domain for self-hosted           | Medium |

---

## 17. Performance & Accessibility Requirements

### 17.1 Performance Targets

| Metric                             | Target                             |
| ---------------------------------- | ---------------------------------- |
| **First Contentful Paint (FCP)**   | < 1.5s (landing), < 2s (dashboard) |
| **Largest Contentful Paint (LCP)** | < 2.5s                             |
| **First Input Delay (FID)**        | < 100ms                            |
| **Cumulative Layout Shift (CLS)**  | < 0.1                              |
| **Time to Interactive (TTI)**      | < 3.5s                             |
| **Bundle size (initial)**          | < 150KB JS, < 50KB CSS             |
| **API response time (p50)**        | < 100ms                            |
| **API response time (p99)**        | < 500ms                            |
| **Dashboard page navigation**      | Instant (Next.js App Router + RSC) |
| **SSE log latency**                | < 500ms from event to display      |

### 17.2 Accessibility Requirements (WCAG 2.1 AA)

| Requirement               | Implementation                                               |
| ------------------------- | ------------------------------------------------------------ |
| **Color contrast**        | All text meets 4.5:1 ratio (normal) / 3:1 (large)            |
| **Keyboard navigation**   | All interactive elements reachable and operable via keyboard |
| **Focus indicators**      | Visible focus ring on all interactive elements               |
| **ARIA labels**           | Icons, buttons, and form fields have descriptive labels      |
| **Screen reader support** | Live regions for dynamic content (build logs, notifications) |
| **Reduced motion**        | Respect `prefers-reduced-motion`; disable animations         |
| **Text scaling**          | Interface works at 200% zoom without breakage                |
| **Form labels**           | All inputs have associated `<label>` elements                |
| **Error announcements**   | Form errors announced via `aria-live` regions                |
| **Skip navigation**       | "Skip to main content" link on every page                    |
| **RTL support**           | Arabic layout direction handling                             |

### 17.3 Responsive Breakpoints

| Breakpoint  | Width      | Layout                      |
| ----------- | ---------- | --------------------------- |
| **Desktop** | > 1024px   | Full sidebar + content      |
| **Tablet**  | 768-1024px | Collapsed sidebar + content |
| **Mobile**  | < 768px    | Bottom nav or hamburger     |

---

## 18. Success Metrics

### 18.1 Product Metrics

| Metric                          | Current Baseline   | Target (6 months)                                      |
| ------------------------------- | ------------------ | ------------------------------------------------------ |
| **Time to first deploy**        | ~15 min (new user) | < 5 min                                                |
| **Deployment success rate**     | Unknown            | > 95%                                                  |
| **Average deploy duration**     | Unknown            | < 3 min                                                |
| **Dashboard page load time**    | Unknown            | < 2s p95                                               |
| **User onboarding completion**  | Unknown            | > 70%                                                  |
| **Feature adoption (env vars)** | Unknown            | > 80% of projects                                      |
| **Feature adoption (backups)**  | Unknown            | > 50% of production projects                           |
| **NPS (self-hosted)**           | Unknown            | > 40                                                   |
| **NPS (cloud)**                 | N/A                | _(removed — HosteraX does not provide cloud services)_ |

### 18.2 UI/UX Metrics

| Metric                 | Method            | Target                   |
| ---------------------- | ----------------- | ------------------------ |
| **Task success rate**  | Usability testing | > 90% for core tasks     |
| **Time on task**       | Analytics         | Decrease by 30% YoY      |
| **Error rate**         | Error tracking    | < 2% of form submissions |
| **Satisfaction score** | In-app survey     | > 4/5                    |
| **Return rate**        | Analytics         | > 60% weekly active      |

### 18.3 Code Quality Metrics

| Metric                         | Tool          | Target                 |
| ------------------------------ | ------------- | ---------------------- |
| **TypeScript strict coverage** | tsc --noEmit  | 100%                   |
| **Bundle size regressions**    | size-limit    | Warning > 10% increase |
| **API test coverage**          | Vitest        | > 80%                  |
| **Accessibility violations**   | axe-core      | 0 critical, 0 serious  |
| **Lighthouse score**           | Lighthouse CI | > 90 on all categories |

---

## Appendix A: File Count Statistics

| Category                    | Count                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Total source files**      | ~1,050+ (6 apps, 6 packages, scripts, fixtures, docs)                                                                  |
| — of which adapters/        | 151 files (backup 21, infra 18, runtime 37, system 35, toolchain 5, dockerfile 4, docs 6, scripts 2, tests 8, root 15) |
| — of which db/              | 117 files (schema 37, repos 36, migrations 56, scripts 5, root 3)                                                      |
| — of which core/            | 57 files (src 31, tests 9, root 2)                                                                                     |
| **Dashboard page files**    | 46                                                                                                                     |
| **Dashboard components**    | ~130+                                                                                                                  |
| **Dashboard hooks**         | 13                                                                                                                     |
| **Dashboard contexts**      | 15                                                                                                                     |
| **Dashboard API services**  | 35                                                                                                                     |
| **Dashboard utility files** | 13                                                                                                                     |
| **Marketing page files**    | ~30 pages                                                                                                              |
| **Marketing components**    | ~50                                                                                                                    |
| **Mail landing components** | ~10 + 35 icon components                                                                                               |
| **MDX documentation**       | 54 files                                                                                                               |
| **Blog/resources**          | 3 files                                                                                                                |
| **Changelog entries**       | 4 files                                                                                                                |
| **CSS files**               | 8 (web) + 2 (dashboard)                                                                                                |
| **Locale JSON files**       | ~160+ across 8 languages                                                                                               |
| **Locale namespaces**       | 23                                                                                                                     |
| **Core types/interfaces**   | 62+                                                                                                                    |
| **Core functions**          | 65+                                                                                                                    |
| **Language detectors**      | 9                                                                                                                      |
| **Workspace detectors**     | 10                                                                                                                     |
| **Stack definitions**       | 42                                                                                                                     |
| **App templates**           | 17 (1 coming soon)                                                                                                     |
| **Database tables**         | 38 (main) + 16 (email vmail) + 5 (mail app state)                                                                      |
| **Drizzle migration files** | 56 (main) + 10 (email)                                                                                                 |
| **API route modules**       | 34                                                                                                                     |
| **CLI command modules**     | 27                                                                                                                     |
| **Test files**              | 10+                                                                                                                    |

## Appendix B: Key Technical Debt Items

1. **Duplicate UI primitives** — `@repo/ui` has only 4 components; dashboard has its own `ui/` directory with 20 components (Button, Card, Input, Select, Modal, Tabs, etc.) that should be consolidated into the shared package.
2. **Token inconsistency** — Marketing site uses `--th-*` CSS custom properties; dashboard uses Tailwind classes directly. Marketing only has light mode tokens; dashboard has light/dim/dark.
3. **Empty monitoring page** — `/monitoring` returns `<div />` — placeholder that was never implemented.
4. **No form library** — Hand-rolled form state management; React Hook Form + Zod would reduce boilerplate.
5. **No database UI** — No built-in database browser for Postgres/MySQL/MongoDB.
6. **Incomplete i18n coverage** — Some locales have fewer namespace files (19-21) compared to English (23).
7. **No mobile responsive dashboard** — Dashboard is desktop-only.
8. **No PWA support** — Dashboard could benefit from service worker caching for offline access.

---

_This PRD is a living document reflecting the complete codebase inventory as of v0.2.2. Features and priorities should be reviewed quarterly based on user feedback and business goals._
