# ⚡ HosteraX — Autonomous Self-Hosted Cloud Control Plane

<p align="center">
  <img src="https://raw.githubusercontent.com/meetpatel1111/hosterax-dream-maker/main/public/favicon.ico" width="80" alt="HosteraX Logo" />
</p>

<p align="center">
  <strong>The open-source, AI-native alternative to Coolify, Dokku, and Render.</strong><br/>
  Featuring an Autonomous Model Context Protocol (MCP) Server with 34 tools for <strong>Cursor IDE</strong>, <strong>Claude Desktop</strong>, <strong>Devin</strong>, <strong>Windsurf</strong>, and multi-provider AI agents.
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-deployment-modes">Deployment Modes</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-cli-commands">CLI (`htx`)</a> •
  <a href="#-mcp-ide-integration">MCP IDE Setup</a> •
  <a href="#-app-store-catalog">App Store (2,502+ Apps)</a> •
  <a href="#-downloads">Downloads</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hosterax"><img src="https://img.shields.io/npm/v/hosterax.svg?style=flat-square&color=3b82f6" alt="NPM Version" /></a>
  <a href="https://github.com/meetpatel1111/hosterax-dream-maker/pkgs/container/hosterax"><img src="https://img.shields.io/badge/Docker-GHCR-blue?style=flat-square&logo=docker" alt="Docker Container" /></a>
  <a href="https://github.com/meetpatel1111/hosterax-dream-maker/releases"><img src="https://img.shields.io/github/v/release/meetpatel1111/hosterax-dream-maker?style=flat-square&color=10b981" alt="GitHub Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-orange?style=flat-square" alt="License" /></a>
</p>

---

## 🚀 Quick Start (Zero Installation Required!)

### 1. Instant All-in-One Launch via `npx`:
```bash
# Starts the engine daemon and opens the Web Dashboard on http://localhost:7777
npx hosterax
```

### 2. Official Multi-Arch Docker (AMD64 & ARM64):
```bash
docker run -d \
  --name hosterax \
  --restart unless-stopped \
  -p 7777:7777 \
  -p 8080:8080 \
  -p 80:80 \
  -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v hosterax_data:/root/.hosterax \
  ghcr.io/meetpatel1111/hosterax:latest
```
*Open `http://localhost:8080` or `http://localhost:7777` in your browser!*

### 3. Docker Compose (`docker-compose.yml`):
```yaml
version: "3.8"

services:
  hosterax:
    image: ghcr.io/meetpatel1111/hosterax:latest
    container_name: hosterax
    restart: unless-stopped
    ports:
      - "7777:7777"   # HosteraX Engine Daemon & API
      - "8080:8080"   # Web Dashboard Control Plane
      - "80:80"       # Edge Gateway (HTTP)
      - "443:443"     # Edge Gateway (HTTPS)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - hosterax_data:/root/.hosterax

volumes:
  hosterax_data:
```
```bash
docker compose up -d
```

---

## 📥 Native Desktop Installers & Downloads

Download the official standalone application packages from the **[GitHub Releases Page](https://github.com/meetpatel1111/hosterax-dream-maker/releases/tag/v1.0.0)**:

| Platform | Format | Description |
| :--- | :--- | :--- |
| 🪟 **Windows** | [`.exe Installer`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.zip`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) | Native Windows 10/11 Desktop Supervisor with System Tray |
| 🍎 **macOS** | [`.dmg Disk Image`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.zip`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) | Universal binary for Apple Silicon (M1/M2/M3/M4) & Intel |
| 🐧 **Linux** | [`.deb Package`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.AppImage`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) | Ubuntu, Debian, Fedora, Arch, and portable Linux distributions |
| 📦 **CLI Tarball** | [`.tar.gz`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) | Ultra-lightweight (~12.8 KB) standalone CLI & MCP stdio transport |
| 🌐 **NPM Package** | `npm i -g hosterax` | 100% All-in-one distribution with pre-built Web UI + Engine |

---

## 🌟 Key Features

- 🤖 **Universal Model Context Protocol (MCP) Server**: Exposes **34 enterprise-grade DevOps tools** over JSON-RPC 2.0 (`2024-11-05` spec) supporting both HTTP (`/api/mcp`) and stdio (`htx mcp`). Compatible with **Cursor**, **Claude Desktop**, **Devin**, **Windsurf**, and **VS Code (Cline / Roo Code)**.
- 🧠 **Multi-Provider AI Copilot (`htx ai`)**: Autonomous infrastructure assistant supporting **Google Gemini** (default: `gemini-3.5-flash`), **Anthropic Claude** (`claude-3-5-sonnet`), **OpenAI** (`gpt-4o`), and **Ollama** (offline local LLMs) with parallel tool execution and rate-limit backoff.
- 📦 **1-Click Open-Source App Store**: Instant search and zero-config deployment across **2,502+ curated open-source self-hosted applications** from Awesome-Selfhosted & Selfh.st (Ghost, Nextcloud, Plausible, Vaultwarden, Grafana, N8N, etc.).
- 🔄 **Zero-Downtime Blue/Green Deployments**: Automated builds from Git repositories, Dockerfiles, or Docker Hub images with port conflict resolution and health check polling.
- 🛡️ **Autonomous Self-Healing Supervisor**: Automated error diagnostics on failed containers with 1-click byte-for-byte snapshot rollbacks.
- 🗄️ **Managed Databases & Instant Backups**: 1-click provisioning of PostgreSQL, MySQL, MongoDB, Redis, ClickHouse, and MariaDB with SHA-256 verified point-in-time snapshots and automated sync to **AWS S3 / Cloudflare R2**.
- 🌐 **Edge Proxy & Automated SSL**: Dynamic routing with OpenResty Lua & Caddy 2, custom domains, wildcard SSL, and Magic DNS integration (`nip.io`, `sslip.io`).
- ✉️ **Self-Hosted Email Stack**: Inbound/outbound email management with DKIM, SPF, DMARC validation, mailboxes, forwarding aliases, and external SMTP relay chaining.
- 🖥️ **Multi-Node Fleet Management**: Add and orchestrate remote servers over SSH with live CPU/RAM load telemetry and latency pings.
- ⏱️ **Distributed Cron Engine**: Schedule recurring tasks with human-readable crontab schedules, audit execution logs, and manual triggers.

---

## 🌐 Connecting to Remote Self-Hosted Servers

Once you run HosteraX on your VPS or cloud server (e.g. `159.65.120.45`):

```bash
# Connect CLI to your remote instance
htx target http://159.65.120.45:7777 --token <YOUR_TOKEN>

# Deploy any local git repository to your remote server
htx deploy

# Provision remote database
htx db:create postgres prod-db

# Tail remote container logs
htx logs my-app
```

### Magic DNS & Custom Domains:
* **Zero Config Magic DNS**: Every app automatically gets a live URL `http://<app-name>.<your-vps-ip>.nip.io` with zero DNS configuration!
* **Custom Domains**: Add `A` record `*.apps.yourdomain.com -> <your-vps-ip>`, and HosteraX automatically provisions and auto-renews free Let's Encrypt SSL certificates.

---

## 🔌 Use as MCP Server for AI IDEs

### 1. Cursor IDE (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "hosterax": {
      "url": "http://localhost:7777/api/mcp"
    }
  }
}
```

### 2. Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "hosterax": {
      "command": "npx",
      "args": ["-y", "hosterax", "mcp"]
    }
  }
}
```

### 3. Windsurf / Devin / Cline:
```json
{
  "mcpServers": {
    "hosterax": {
      "command": "htx",
      "args": ["mcp"]
    }
  }
}
```

---

## 💻 CLI Commands (`htx` / `hosterax`)

```bash
# 🚀 Management & Deploys
htx status                            # Inspect host CPU/RAM, uptime, and engine status
htx list                              # List all deployed projects
htx deploy                            # Trigger blue/green deployment from current directory
htx rollback <projectId>              # Rollback container to previous snapshot
htx logs <projectId>                  # Tail real-time live container logs

# 🗄️ Databases & Storage
htx dbs                               # List managed database containers
htx db:create <name> --engine pg      # Provision PostgreSQL, MySQL, Redis, MongoDB
htx backup:create <dbId>              # Create SHA-256 verified snapshot
htx s3:sync                           # Trigger remote AWS S3 / Cloudflare R2 sync

# 📦 1-Click App Store
htx catalog:search <query>            # Search 2,502+ open-source application templates

# 🧠 Autonomous AI Copilot
htx ai "<prompt>"                     # Autonomous AI infrastructure assistant
htx ask "Why is my database slow?"    # Diagnose system and infrastructure issues
htx ai:model <modelName>              # Set default AI model (default: gemini-3.5-flash)

# 🤖 MCP & Integrations
htx mcp:tools                         # List all 34 registered MCP tools
htx mcp:config [cursor|claude|devin]  # Print instant IDE MCP configuration JSON
htx mcp                               # Start stdio MCP protocol transport
```

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
© 2026 HosteraX Contributors
