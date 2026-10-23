# ⚡ HosteraX — Autonomous Self-Hosted Cloud Control Plane

<p align="center">
  <img src="https://raw.githubusercontent.com/meetpatel1111/hosterax-dream-maker/main/public/logo.svg" width="280" alt="HosteraX Logo" />
</p>

<p align="center">
  <strong>The open-source, AI-native alternative to Coolify, Dokku, and Render.</strong><br/>
  Featuring an Autonomous Model Context Protocol (MCP) Server with 46 tools for <strong>Cursor IDE</strong>, <strong>Claude Desktop</strong>, <strong>Devin</strong>, <strong>Windsurf</strong>, and multi-provider AI agents.
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-deployment-modes">Deployment Modes</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-cli-commands">CLI (`htx`)</a> •
  <a href="#-mcp-tool-matrix-46-tools">MCP 46 Tools</a> •
  <a href="#-deployment-engine-matrix">Deployment Matrix</a> •
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
  -p 80:80 \
  -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v hosterax_data:/root/.hosterax \
  ghcr.io/meetpatel1111/hosterax:latest
docker logs hosterax    # prints the first admin API token
```

_Open `http://localhost:7777` in your browser and sign in with that token. Requests that arrive through a published Docker port are not treated as "local", so a token is required._

> The container has full control of the Docker daemon through the mounted socket — treat access to it like root on the host. Do not expose port 7777 to the internet without TLS in front of it.

### 3. Docker Compose (`docker-compose.yml`):

```yaml
version: "3.8"

services:
  hosterax:
    image: ghcr.io/meetpatel1111/hosterax:latest
    container_name: hosterax
    restart: unless-stopped
    ports:
      - "7777:7777" # HosteraX engine: API + web dashboard
      - "80:80" # Edge Gateway (HTTP)
      - "443:443" # Edge Gateway (HTTPS)
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

Download the official standalone application packages from the **[GitHub Releases Page](https://github.com/meetpatel1111/hosterax-dream-maker/releases/tag/v1.1.0)**:

| Platform           | Format                                                                                                                                                                         | Description                                                       |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| 🪟 **Windows**     | [`.exe Installer`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.zip`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest)    | Native Windows 10/11 Desktop Supervisor with System Tray          |
| 🍎 **macOS**       | [`.dmg Disk Image`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.zip`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest)   | Universal binary for Apple Silicon (M1/M2/M3/M4) & Intel          |
| 🐧 **Linux**       | [`.deb Package`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) / [`.AppImage`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest) | Ubuntu, Debian, Fedora, Arch, and portable Linux distributions    |
| 📦 **CLI Tarball** | [`.tar.gz`](https://github.com/meetpatel1111/hosterax-dream-maker/releases/latest)                                                                                             | Ultra-lightweight (~12.8 KB) standalone CLI & MCP stdio transport |
| 🌐 **NPM Package** | `npm i -g hosterax`                                                                                                                                                            | 100% All-in-one distribution with pre-built Web UI + Engine       |

---

## 🌟 Key Features

- 🤖 **Universal Model Context Protocol (MCP) Server**: Exposes **46 DevOps tools** over JSON-RPC 2.0 (`2024-11-05` spec) supporting both HTTP (`/api/mcp`) and stdio (`htx mcp`). Compatible with **Cursor**, **Claude Desktop**, **Devin**, **Windsurf**, and **VS Code (Cline / Roo Code)**.
- 🧠 **Multi-Provider AI Copilot (`htx ai`)**: Autonomous infrastructure assistant supporting **Google Gemini** (default: `gemini-3.5-flash`), **Anthropic Claude** (`claude-3-5-sonnet`), **OpenAI** (`gpt-4o`), and **Ollama** (offline local LLMs) with parallel tool execution and rate-limit backoff.
- 📦 **1-Click Open-Source App Store**: Search and deploy from a catalog of **2,500+ open-source self-hosted applications** built from Awesome-Selfhosted & Selfh.st (Ghost, Nextcloud, Plausible, Vaultwarden, Grafana, N8N, etc.). Entries flagged `imageVerified` have a confirmed Docker image; for the rest the image is a best guess that is resolved when you deploy.
- 🔄 **Blue/Green Deployments**: Builds from Git repositories, local folders/zip uploads, Dockerfiles, or Docker Hub images. A candidate container must pass its health check before traffic is swapped; otherwise the old one stays live.
- 🛡️ **Self-Healing Supervisor**: Detects failed containers, restarts them with backoff, and offers a one-click rollback that re-deploys a previous release (its source, environment and image).
- 🗄️ **Managed Databases & Backups**: Provisions PostgreSQL, MySQL, MariaDB, MongoDB and Redis containers. Backups are real dumps with a SHA-256 checksum; a failed dump is reported as failed. Optional sync to **AWS S3 / Cloudflare R2**.
- 🌐 **Edge Proxy & Automated SSL**: Dynamic routing with OpenResty Lua & Caddy 2, custom domains, wildcard SSL, and Magic DNS integration (`nip.io`, `sslip.io`).
- ✉️ **Email Configuration Manager**: Manages email domains with real DKIM keys plus SPF/DMARC records, mailboxes, aliases and sending through an external SMTP relay. HosteraX is **not** a mail server: it does not receive mail itself.
- 🖥️ **Server Registry**: Register remote VPS hosts, check that they are reachable, and generate a Docker bootstrap script. Deploying to remote nodes over SSH is **not implemented yet** — projects run on the machine hosting the engine.
- ⏱️ **Distributed Cron Engine**: Schedule recurring tasks with human-readable crontab schedules, audit execution logs, and manual triggers.

---

## 🤖 Model Context Protocol (MCP) 46-Tool Matrix

HosteraX exposes **46 native DevOps & SRE tools** to any AI Coding Agent via standard JSON-RPC 2.0. Every tool is gated by the scope of the API token the agent uses (`read`, `deploy` or `admin`), and destructive actions need an admin token:

| Category                   | Tool Name                                                                                                               | Description                                     |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| 📊 **Observability**       | `get_system_stats`, `get_system_metrics`, `get_activity_logs`                                                           | Host gauges, platform details and the audit log |
| 📁 **Projects**            | `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`                                    | Manage applications                             |
| 🚀 **Deployments**         | `deploy_project`, `rollback_project`, `get_deployment`, `get_project_logs`, `restart_project`, `diagnose_project_crash` | Deploy, roll back, inspect and diagnose         |
| ⚙️ **Config & Limits**     | `get_project_env`, `set_project_env`, `set_project_quotas`                                                              | Environment variables and CPU/RAM limits        |
| 🌐 **Domains & Edge**      | `list_domains`, `add_domain`, `verify_domain_ssl`, `get_edge_status`                                                    | Custom domains, TLS and edge proxy status       |
| 🗄️ **Databases & Backups** | `list_databases`, `provision_database`, `list_backups`, `create_backup`, `restore_backup`                               | Managed databases and their backups             |
| ☁️ **S3 / R2**             | `get_s3_storage_status`, `trigger_s3_sync`                                                                              | Remote backup storage                           |
| ⏰ **Cron**                | `list_cron_jobs`, `trigger_cron_job`                                                                                    | Scheduled jobs                                  |
| 🖥️ **Servers**             | `list_servers`, `test_server_connection`                                                                                | Registered nodes and connectivity checks        |
| ✉️ **Email**               | `list_email_domains`, `add_email_domain`, `list_mailboxes`, `create_mailbox`, `list_mail_aliases`, `create_mail_alias`  | Email configuration                             |
| 🔗 **Webhooks & Previews** | `get_webhook_config`, `list_pr_previews`, `delete_pr_preview`                                                           | Push-to-deploy and PR previews                  |
| 👥 **Organizations**       | `list_organizations`, `create_organization`, `list_org_members`                                                         | Workspace directory                             |
| 📦 **App Store**           | `search_catalog`, `deploy_catalog_app`                                                                                  | Search and launch catalog apps                  |

--- | :--- | :--- |
| 📊 **Observability** | `get_system_stats` | Live CPU, Memory, Disk gauges, and active routes |
| 📊 **Observability** | `get_system_metrics` | Detailed host metrics, platform specs, and load averages |
| 📊 **Observability** | `get_activity_logs` | Server deployment audit log and execution events |
| 📁 **Projects & Apps** | `list_projects` | List all applications, statuses, ports, and domains |
| 📁 **Projects & Apps** | `get_project` | Inspect project quotas, health metrics, and config |
| 📁 **Projects & Apps** | `create_project` | Provision app from Git, Dockerfile, or local workspace |
| 📁 **Projects & Apps** | `update_project` | Update build commands, ports, and sleep modes |
| 📁 **Projects & Apps** | `delete_project` | Destroy containers and clean up routing rules |
| 🚀 **Deployments** | `deploy_project` | Trigger zero-downtime blue/green deployment |
| 🚀 **Deployments** | `rollback_project` | 1-click byte-for-byte rollback to previous snapshot |
| 🚀 **Deployments** | `get_deployment` | Query deployment progress, phase, and exit codes |
| 🚀 **Deployments** | `get_project_logs` | Stream build and container runtime logs |
| 🚀 **Deployments** | `restart_project` | Immediate container restart and self-heal trigger |
| ⚙️ **Config & Limits** | `get_project_env` | Read environment variables and secrets |
| ⚙️ **Config & Limits** | `set_project_env` | Inject/update environment variables |
| ⚙️ **Config & Limits** | `set_project_quotas` | Set hard CPU core limits & RAM allocation caps |
| 🌐 **Domains & Edge** | `list_domains` | List all custom domains and SSL certificate statuses |
| 🌐 **Domains & Edge** | `add_domain` | Attach custom domain with Let's Encrypt TLS |
| 🌐 **Domains & Edge** | `remove_domain` | Detach domain and revoke routing rules |
| 🌐 **Domains & Edge** | `verify_domain_dns` | Query real-time DNS propagation and A records |
| 🌐 **Domains & Edge** | `get_edge_routes` | Query Caddy / OpenResty proxy route tables |
| 🌐 **Domains & Edge** | `create_edge_route` | Define custom upstream routing and middleware |
| 🗄️ **Databases & S3** | `list_databases` | List provisioned PostgreSQL, MySQL, Redis, MongoDB |
| 🗄️ **Databases & S3** | `create_database` | 1-click launch managed database container |
| 🗄️ **Databases & S3** | `delete_database` | Delete database and unmount storage volumes |
| 🗄️ **Databases & S3** | `list_backups` | View SHA-256 verified database snapshots |
| 🗄️ **Databases & S3** | `create_backup` | Take point-in-time snapshot of any database |
| 🗄️ **Databases & S3** | `restore_backup` | Restore database snapshot instantly |
| 🗄️ **Databases & S3** | `sync_s3_storage` | Trigger automated backup sync to S3 / Cloudflare R2 |
| ⏰ **Cron Engine** | `list_cron_jobs` | Inspect scheduled cron schedules and triggers |
| ⏰ **Cron Engine** | `create_cron_job` | Schedule recurring crontab task |
| ⏰ **Cron Engine** | `run_cron_job` | Trigger manual immediate execution of any job |
| ⏰ **Cron Engine** | `delete_cron_job` | Unregister scheduled task |
| 🖥️ **Fleet & Catalog** | `list_servers` | Multi-node SSH cluster health & latency |
| 🖥️ **Fleet & Catalog** | `add_server` | Attach remote VPS server to cluster |
| 📦 **App Store** | `search_catalog` | Search 2,500+ open-source application templates |
| 📦 **App Store** | `deploy_catalog_app` | 1-click launch Ghost, N8N, Nextcloud, Vaultwarden |

---

## 🔄 Deployment Engine Matrix (120+ Stacks & Auto-Detection)

The table lists the most common stacks; the engine detects 120+ in total.

| Framework / Stack            | Supported Detectors               | Default Build Command                   | Default Start Command                             |
| :--------------------------- | :-------------------------------- | :-------------------------------------- | :------------------------------------------------ |
| ⚡ **Next.js**               | `package.json` with `"next"`      | `npm run build`                         | `npm start` (or standalone server)                |
| ⚛️ **Vite / React / Vue**    | `vite.config.*` / `"vite"`        | `npm run build`                         | Embedded static file server (`dist/`)             |
| 🟢 **Node.js / Express**     | `package.json` (Express/Fastify)  | `npm install`                           | `node index.js` / `npm start`                     |
| 🚀 **NestJS / TypeScript**   | `nest-cli.json` / `tsconfig.json` | `npm run build`                         | `node dist/main.js`                               |
| 🐍 **Python FastAPI**        | `main.py`, `requirements.txt`     | `pip install -r requirements.txt`       | `uvicorn main:app --host 0.0.0.0 --port $PORT`    |
| 🐍 **Python Django / Flask** | `manage.py`, `app.py`             | `pip install -r requirements.txt`       | `gunicorn app:app` / `python manage.py runserver` |
| 🦀 **Rust (Actix / Axum)**   | `Cargo.toml`                      | `cargo build --release`                 | `./target/release/app`                            |
| 🐹 **Go (Gin / Fiber)**      | `go.mod`                          | `go build -o server .`                  | `./server`                                        |
| ☕ **Java Spring Boot**      | `pom.xml`, `build.gradle`         | `mvn clean package` / `./gradlew build` | `java -jar target/*.jar`                          |
| 💎 **Ruby on Rails**         | `Gemfile` with `rails`            | `bundle install`                        | `bundle exec rails s -p $PORT -b 0.0.0.0`         |
| 🐘 **PHP Laravel**           | `composer.json` with `laravel`    | `composer install --no-dev`             | `php artisan serve --port=$PORT`                  |
| 🦔 **Bun / Deno**            | `bun.lock`, `deno.json`           | `bun install` / `deno cache`            | `bun start` / `deno run -A main.ts`               |
| 🐳 **Dockerfile (Custom)**   | `Dockerfile`                      | Custom multi-stage build                | Container ENTRYPOINT / CMD                        |
| 📦 **Docker Compose**        | `docker-compose.yml`              | Multi-service orchestration             | Service composition                               |

---

## 🌐 Connecting to Remote Self-Hosted Servers

Once you run HosteraX on your VPS or cloud server (e.g. `159.65.120.45`):

```bash
# Connect CLI to your remote instance
htx login <YOUR_TOKEN> --url http://159.65.120.45:7777

# Deploy the project in the current directory to that engine
htx deploy .

# Provision a database for a project
htx db:create my-app prod-db postgres

# Tail container logs
htx logs my-app --follow
```

### Magic DNS & Custom Domains:

- **Zero Config Magic DNS**: Every app automatically gets a live URL `http://<app-name>.<your-vps-ip>.nip.io` with zero DNS configuration!
- **Custom Domains**: Add `A` record `*.apps.yourdomain.com -> <your-vps-ip>`, and HosteraX automatically provisions and auto-renews free Let's Encrypt SSL certificates.

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
htx projects                          # List all deployed projects
htx deploy <name|path>                # Trigger a blue/green deployment
htx rollback <deploymentId>           # Re-deploy a previous release
htx logs <deploymentId|name>          # Stream logs (add --follow)

# 🗄️ Databases & Storage
htx databases                         # List managed database containers
htx db:create <project> <name> <engine> # Provision postgres, mysql, mongodb or redis
htx backup:create <databaseId|name>   # Create a checksummed backup
htx s3:sync                           # Trigger remote AWS S3 / Cloudflare R2 sync

# 📦 1-Click App Store
htx catalog:search <query>            # Search 2,500+ open-source application templates

# 🧠 Autonomous AI Copilot
htx ai "<prompt>"                     # Autonomous AI infrastructure assistant
htx diagnose <name>                   # Diagnose a crashing project
htx ai:model <modelName>              # Set default AI model (default: gemini-3.5-flash)

# 🤖 MCP & Integrations
htx mcp:tools                         # List all 46 registered MCP tools
htx mcp:config [cursor|claude|devin|windsurf] # Print IDE MCP configuration JSON
htx mcp                               # Start stdio MCP protocol transport
```

---

## 🔐 Security & Configuration

- API tokens are stored only as SHA-256 hashes and are shown once, when created. Scopes: `read` < `deploy` < `admin`.
- Only requests from the engine's own machine (loopback, same origin) are trusted without a token. Everything else needs `Authorization: Bearer <token>`.
- SSH keys, S3 credentials, DKIM private keys, SMTP relay passwords, TLS private keys and AI provider keys are encrypted at rest (AES-256-GCM); mailbox passwords are stored as salted scrypt hashes. The key lives in `$HOSTERAX_HOME/secret.key` (mode 0600) unless you set `HOSTERAX_SECRET_KEY`; back it up with your data.
- Project environment variable values are **not** encrypted in the database. They are protected only by file permissions on `$HOSTERAX_HOME` and whatever disk encryption you use, they are masked in build/runtime logs, and `read`-scoped tokens cannot read them back.
- Public endpoints: `/api/health` and the GitHub webhook receiver (`/webhooks/github`, HMAC-verified).

| Variable                                     | Default       | Purpose                                                                                                                                                 |
| :------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HOSTERAX_PORT`                              | `7777`        | Port the engine listens on                                                                                                                              |
| `HOSTERAX_HOME`                              | `~/.hosterax` | State directory (database, key, backups)                                                                                                                |
| `HOSTERAX_REQUIRE_AUTH`                      | off           | Set to `1` to require a token even for local requests                                                                                                   |
| `HOSTERAX_TRUSTED_ORIGINS`                   | –             | Comma-separated extra browser origins allowed to call the API                                                                                           |
| `HOSTERAX_BIND_HOST`                         | `0.0.0.0`     | Interface deployed apps publish on (`127.0.0.1` forces traffic through the edge proxy)                                                                  |
| `HOSTERAX_PUBLIC_URL` / `HOSTERAX_PUBLIC_IP` | auto          | Public address used for webhook URLs and Magic DNS                                                                                                      |
| `HOSTERAX_SECRET_KEY`                        | generated     | Passphrase used to derive the at-rest encryption key (overrides `secret.key`)                                                                           |
| `HOSTERAX_IMAGE_DISCOVERY`                   | off           | Set to `1` to let the engine search Docker Hub and substitute a different publisher's image when a catalog image can't be pulled — a typosquatting risk |
| `HOSTERAX_DEV`                               | off           | Set to `1` to also trust the Vite dev-server origins (8080, 5173, 3000)                                                                                 |
| `HOSTERAX_URL` / `HOSTERAX_TOKEN`            | –             | Where the CLI and `htx mcp` connect                                                                                                                     |

Known limitations: remote SSH deployment and an inbound mail server are not implemented, team roles are a directory only (permissions come from API token scopes), and the edge proxy's Caddy admin API is reachable inside its container network. See [SECURITY.md](SECURITY.md) and [ROADMAP.md](ROADMAP.md).

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
© 2026 HosteraX Contributors
