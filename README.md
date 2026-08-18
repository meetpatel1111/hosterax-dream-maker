# ⚡ HosteraX — Autonomous Self-Hosted Cloud Control Plane

<p align="center">
  <img src="https://raw.githubusercontent.com/meetpatel1111/hosterax-dream-maker/main/public/favicon.ico" width="80" alt="HosteraX Logo" />
</p>

<p align="center">
  <strong>The open-source, AI-native alternative to Coolify, Dokku, and Render.</strong><br/>
  Featuring an Autonomous Model Context Protocol (MCP) Server with 34 tools for <strong>Cursor IDE</strong>, <strong>Claude Desktop</strong>, <strong>Devin</strong>, <strong>Windsurf</strong>, and multi-provider AI agents.
</p>

<p align="center">
  <a href="#-key-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-cli-commands">CLI (`htx`)</a> •
  <a href="#-mcp-ide-integration">MCP IDE Setup</a> •
  <a href="#-app-store-catalog">App Store (2,502+ Apps)</a> •
  <a href="#-test-suite">Tests</a>
</p>

---

## 🌟 Key Features

* 🤖 **Universal Model Context Protocol (MCP) Server**: Exposes **34 enterprise-grade DevOps tools** over JSON-RPC 2.0 (`2024-11-05` spec) supporting both HTTP (`/api/mcp`) and stdio (`htx mcp:stdio`). Compatible with **Cursor**, **Claude Desktop**, **Devin**, **Windsurf**, and **VS Code (Cline / Roo Code)**.
* 🧠 **Multi-Provider AI Copilot (`htx ai`)**: Autonomous infrastructure assistant supporting **Google Gemini** (default: `gemini-3.5-flash`), **Anthropic Claude** (`claude-3-5-sonnet`), **OpenAI** (`gpt-4o`), and **Ollama** (offline local LLMs) with parallel tool execution and rate-limit backoff.
* 📦 **1-Click Open-Source App Store**: Instant search and zero-config deployment across **2,502+ curated open-source self-hosted applications** from Awesome-Selfhosted & Selfh.st (Ghost, Nextcloud, Plausible, Vaultwarden, Grafana, N8N, etc.).
* 🔄 **Zero-Downtime Blue/Green Deployments**: Automated builds from Git repositories, Dockerfiles, or Docker Hub images with port conflict resolution and health check polling.
* 🛡️ **Autonomous Self-Healing Supervisor**: Automated error diagnostics on failed containers with 1-click byte-for-byte snapshot rollbacks.
* 🗄️ **Managed Databases & Instant Backups**: 1-click provisioning of PostgreSQL, MySQL, MongoDB, Redis, ClickHouse, and MariaDB with SHA-256 verified point-in-time snapshots and automated sync to **AWS S3 / Cloudflare R2**.
* 🌐 **Edge Proxy & Automated SSL**: Dynamic routing with OpenResty Lua & Caddy 2, custom domains, wildcard SSL, and Magic DNS integration (`nip.io`, `sslip.io`).
* ✉️ **Self-Hosted Email Stack**: Inbound/outbound email management with DKIM, SPF, DMARC validation, mailboxes, forwarding aliases, and external SMTP relay chaining.
* 🖥️ **Multi-Node Fleet Management**: Add and orchestrate remote servers over SSH with live CPU/RAM load telemetry and latency pings.
* ⏱️ **Distributed Cron Engine**: Schedule recurring tasks with human-readable crontab schedules, audit execution logs, and manual triggers.

---

## 🏗️ Architecture

```
                                 ┌────────────────────────────────────────┐
                                 │          HosteraX Control Plane        │
                                 │    (TanStack Start + React 19 UI)      │
                                 └──────────────────┬─────────────────────┘
                                                    │
                                 ┌──────────────────┴─────────────────────┐
                                 │        HosteraX Engine Daemon          │
                                 │     (Port 7777 / SQLite Database)      │
                                 └──────────────────┬─────────────────────┘
                                                    │
     ┌──────────────────────┬───────────────────────┼──────────────────────┬──────────────────────┐
     │                      │                       │                      │                      │
┌────┴────────────┐  ┌──────┴─────────────┐  ┌──────┴─────────────┐  ┌─────┴─────────────┐  ┌─────┴─────────────┐
│ Universal MCP   │  │ Container Engine   │  │ Database & Backup  │  │ Edge Proxy & SSL  │  │ Multi-Node Fleet  │
│ 34 Tools Server │  │ Blue/Green Deploys │  │ S3 / R2 Remote Sync│  │ Caddy / OpenResty │  │ SSH Orchestration │
└─────────────────┘  └────────────────────┘  └────────────────────┘  └───────────────────┘  └───────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `v20.x` or higher
- **Docker Engine**: Installed and running

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/meetpatel1111/hosterax-dream-maker.git
cd hosterax-dream-maker

# Install dependencies
npm install

# Link the global CLI (htx and hosterax)
cd hosterax/cli && npm link && cd ../..
```

### 3. Start HosteraX
```bash
# Terminal 1: Start the Backend Engine Daemon (Port 7777)
node hosterax/engine/src/index.mjs

# Terminal 2: Start the Web Control Plane Dashboard (Port 8081)
npm run dev
```

Open your browser at `http://localhost:8081` to access the full web dashboard!

---

## 💻 CLI Commands (`htx` / `hosterax`)

The HosteraX CLI is accessible globally via `htx` or `hosterax`:

```bash
# Status & Metrics
htx status                               # Inspect daemon health, CPU/RAM, and uptime
htx projects                             # List all deployed containers and services
htx deploy <projectId>                   # Trigger blue/green deployment
htx rollback <projectId>                 # Instant byte-for-byte snapshot rollback
htx logs <projectId> [--lines 100]       # Tail live container logs

# Managed Databases & S3 Backups
htx dbs                                  # List managed database containers
htx db:new <name> --engine postgres      # Provision new database (postgres, mysql, redis, mongo)
htx backup:new <dbId>                    # Create SHA-256 verified database snapshot
htx s3:status                            # Check remote S3/Cloudflare R2 sync configuration
htx s3:sync                              # Trigger immediate remote database backup sync

# App Store & Templates
htx catalog:search <query>               # Search 2,502+ open-source app templates
htx catalog:search ghost --category CMS  # Filter by category

# Autonomous AI Copilot
htx ai "<prompt>"                        # Ask AI agent to inspect/manage infrastructure
htx ai:model <modelName>                 # Configure default model (default: gemini-3.5-flash)
htx ai:key <apiKey> [--provider <name>]  # Securely save AI provider key in ~/.hosterax/cli.json

# MCP IDE Integration
htx mcp:tools                            # List all 34 registered MCP tools
htx mcp:config [cursor|claude|devin]     # Generate 1-click IDE configuration JSON
htx mcp:stdio                            # Start JSON-RPC 2.0 stdio transport
```

---

## 🔌 MCP IDE Integration Guide

HosteraX can be controlled directly by AI assistants inside your favorite IDE:

### 1. Cursor IDE (`.cursor/mcp.json` or Settings → MCP)
```json
{
  "mcpServers": {
    "hosterax": {
      "url": "http://localhost:7777/api/mcp"
    }
  }
}
```

### 2. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "hosterax": {
      "command": "node",
      "args": [
        "C:\\Users\\pmeet\\Downloads\\hosterax-dream-maker\\hosterax\\cli\\src\\cli.mjs",
        "mcp:stdio"
      ]
    }
  }
}
```

### 3. Devin / Windsurf / VS Code (Cline / Roo Code)
- **Endpoint**: `http://localhost:7777/api/mcp`
- **Transport**: HTTP or stdio (`htx mcp:stdio`)

---

## 🧪 Test Suite

HosteraX includes a comprehensive automated test suite testing all 18 major subsystems:

```bash
node --test hosterax/engine/test/engine.test.mjs
```

```
✔ health endpoint (808ms)
✔ token bootstrap (3ms)
✔ projects CRUD (320ms)
✔ catalog endpoints serve from bundled JSON (12ms)
✔ database provisioning + backup lifecycle (354ms)
✔ tokens create + list + revoke (11ms)
✔ system stats (167ms)
✔ s3 storage configuration and remote sync api (7ms)
✔ cron jobs engine CRUD and manual execution (473ms)
✔ model context protocol (MCP) JSON-RPC 2.0 server (23ms)
✔ multi-node server management CRUD and connection test (496ms)
✔ github webhooks and ephemeral pr previews lifecycle (716ms)
✔ multi-tenant organizations and rbac member management (15ms)
✔ self-hosted email stack, dns records, mailboxes, and webmail messages (16ms)
✔ email aliases, inbound forwarding, and outbound smtp relays (12ms)
✔ ai container crash diagnostics and 1-click rollback endpoint (325ms)
✔ universal multi-framework zero-config dockerfile generation (22ms)
✔ project health_path configuration and persistence (605ms)
ℹ tests 18, pass 18, fail 0
```

---

## 📄 License

MIT © HosteraX Contributors. Open-source and free for commercial and personal self-hosting.
