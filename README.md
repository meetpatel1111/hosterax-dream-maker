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
- 🗄️ **Managed Databases & Backups**: Provisions PostgreSQL, MySQL, MariaDB, MongoDB and Redis containers. Backups are real dumps with a SHA-256 checksum; a failed dump is reported as failed. Scheduled backups with retention, automatic verification and optional restore drills, optional encrypted archives, and optional sync to **AWS S3 / Cloudflare R2**.
- 🌍 **Free Public Access**: Give any app a public https address from any computer, with no public IP or router setup, through free tunnels (Cloudflare, localhost.run, Pinggy, ngrok, Tailscale Funnel and more). Reconnects by itself and survives restarts. See [Public access](#-public-access-free-tunnels).
- 🌐 **Edge Proxy & Automated SSL**: Dynamic routing with OpenResty Lua & Caddy 2, custom domains, wildcard SSL, and Magic DNS integration (`nip.io`, `sslip.io`).
- ✉️ **Email Configuration Manager**: Manages email domains with real DKIM keys plus SPF/DMARC records, mailboxes, aliases and sending through an external SMTP relay. HosteraX is **not** a mail server: it does not receive mail itself.
- 🖥️ **Remote Servers over SSH**: Add a Linux VPS, confirm its host key, and place Docker projects on it. HosteraX builds and runs the container there with the system `ssh` (the server only needs Docker), and reaches the app over the same connection, so the app is never published on the server's public address. See [Remote servers](#-remote-servers-deploy-over-ssh).
- 🔒 **Password Protection**: Put a password in front of any app, whether it is reached through a domain, the edge proxy or a public tunnel. See [Password protection](#-password-protection).
- 🔔 **Notifications**: Be told by webhook, Slack, Discord, ntfy or email when a deploy fails, an app crashes, a server goes away or a backup fails. See [Notifications](#-notifications).
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

# 🖥️ Remote servers, password protection, notifications
htx server:add <name> --host <ip>     # Add a server (HosteraX makes its SSH key and prints the public half)
htx server:trust <serverId>           # Confirm the server's host key fingerprint
htx server:test <serverId>            # Log in and check Docker on it
htx create <name> --server <serverId> --source <image>   # Place a Docker project on it
htx gate <project> --password-stdin   # Ask visitors for a password (--off removes it)
htx notify:add <name> --type slack --url <webhook url>   # Be told when something fails

# 🌍 Public access (free tunnels)
htx expose <project|edge>             # Give an app a public https address
htx expose:list                       # Public addresses and their status
htx expose:providers                  # Free options and what this machine can run
htx expose:ip [--save]                # This machine's public IP (and use it for Magic DNS)

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

## 👥 Users, roles, two-factor and SSO

Accounts are optional and additive: API tokens and access from the engine's own machine keep working exactly as before. To use accounts, open **Users & access** in the dashboard (on the engine machine, or with the engine token) and create the owner account; the owner then adds everyone else.

| Role        | May                                                                                 |
| :---------- | :---------------------------------------------------------------------------------- |
| `owner`     | Everything, including managing admins and other owners (there is always one active) |
| `admin`     | Manage developers and viewers, API tokens, servers, settings                        |
| `developer` | Deploy and change projects, domains, databases, backups                             |
| `viewer`    | Read-only                                                                           |

- Roles are checked on **every request**, so changing a role, disabling a user or deleting one takes effect immediately and ends their sessions. They apply to the REST API, the MCP server and the AI copilot alike.
- A user signs in with email and password and receives a session (`hxs_…`, valid 7 days idle / 30 days at most) that is sent as `Authorization: Bearer`, so CLI, MCP and scripts can use it too. For automation, prefer an API token.
- **Two-factor (TOTP):** each user can turn it on in Settings (Google Authenticator, 1Password, Authy…). Recovery codes are shown once; a code cannot be used twice; an admin can reset a locked-out user (`htx user:2fa-reset`).
- **Lockout:** 8 wrong passwords or codes lock that email for 15 minutes. The log (Users & access → Recent sign-in activity, `GET /api/auth/events`) records sign-ins, failures, locks and account changes.
- **Passwords** are at least 10 characters, stored as salted scrypt hashes.

```bash
htx users
htx user:add jane@example.com --role developer      # prints a temporary password once
htx user:role jane@example.com viewer
htx user:disable jane@example.com
```

### Single sign-on (OpenID Connect)

Works with any OIDC provider (Google, Microsoft Entra, Okta, Keycloak, Authentik, …) using the authorization-code flow with PKCE. Set these on the engine and a "Sign in with …" button appears:

| Variable                                      | Purpose                                                                                        |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `HOSTERAX_OIDC_ISSUER`                        | The provider's issuer URL, exactly as in its discovery document (https)                        |
| `HOSTERAX_OIDC_CLIENT_ID` / `…_CLIENT_SECRET` | Credentials of the application you registered with the provider                                |
| `HOSTERAX_PUBLIC_URL`                         | Where users reach the engine. Register `<it>/api/auth/oidc/callback` as the redirect URI       |
| `HOSTERAX_OIDC_ALLOWED_DOMAINS`               | Comma-separated email domains allowed in (or `HOSTERAX_OIDC_ALLOW_ANY_EMAIL=1`)                |
| `HOSTERAX_OIDC_DEFAULT_ROLE`                  | `viewer` (default) or `developer` for first-time SSO users. SSO never creates admins or owners |
| `HOSTERAX_OIDC_NAME`                          | Button label (default "SSO")                                                                   |

The ID token's signature (RS256/ES256), issuer, audience, expiry and nonce are verified, and the email must be verified by the provider. A new SSO user starts with the default role; an owner promotes them in Users & access. If a local account already has the same (provider-verified) email, the SSO identity is linked to it and it keeps its role, so an owner who configures SSO can sign in with it. Anyone who can make your provider assert a verified address in an allowed domain can therefore sign in as that account — keep the allowed domains tight. If SSO is misconfigured the engine says why in its log and leaves it off. Two-factor for SSO users is the provider's job. **The SSO flow is tested against a simulated provider, not yet against a real one** — try it with a non-critical account first.

## 💾 Scheduled backups

```bash
# every night at 02:00, keep the last 14 (and nothing older than 30 days), prove each one is intact
htx backup:schedule my-db --cron "0 2 * * *" --keep 14 --days 30 --drill archive

# also restore it into a throwaway container every 7th run, and encrypt the archives
htx backup:schedule my-db --cron "0 2 * * *" --drill restore --encrypt

htx backup:schedules            # last result and next run of every schedule
htx backup:verify <backupId>    # re-check a backup now
htx backup:drill <backupId>     # restore it into a scratch container to prove it works
```

- **Retention** applies only after a run succeeded, so a failing backup never costs you the good ones. The newest backup is always kept.
- **Verification** (`--drill archive`, the default) re-reads the archive without Docker: the checksum still matches, the encryption authenticates, it decompresses end to end, and it ends the way a complete dump of its type does.
- **Restore drills** (`--drill restore`) start a scratch container from the source's image (no network, 1 GB), restore the backup into it, check that the database answers, and delete the container. Your database is never touched. They need a working Docker daemon and are not available for volume backups. Backups, verification, restore drills, restores over live data, encryption, tampering and scheduled runs with retention are tested end to end against **real PostgreSQL and Redis containers**. MySQL/MariaDB and MongoDB share the same code but have not been run against real containers yet, so treat their first drill as part of your own acceptance test.
- **Restoring PostgreSQL replaces the whole cluster** (`pg_dumpall --clean`: every database in it is dropped and recreated from the backup). Stop the application first: PostgreSQL will not drop a database that has connections, and then the restore refuses with `database … is being accessed by other users` and changes nothing. Restoring Redis stops the container, loads the snapshot and starts it again.
- **Failures** are recorded on the schedule (`htx backup:schedules`, Dashboard → Backups → Schedules) and logged as `backup_failed` events. There is no email or chat notification yet.
- **Encrypted archives** (`--encrypt`) use AES-256-GCM with the engine's key. Downloads are decrypted for you, but the files on disk and any copies in S3 are unreadable without `secret.key` (or `HOSTERAX_SECRET_KEY`): **keep a copy of that key somewhere else**.
- Times use the engine host's clock and time zone. If the engine was down at a scheduled time, the missed run happens once when it starts again. Retention also removes the matching remote copy when S3 sync is on.

## 🌍 Public access (free tunnels)

HosteraX can give an app an address that anyone on the internet can open, from **any computer**: no public IP, no router settings, and it works behind home internet and carrier NAT. A small free tunnel program makes an outbound connection to a relay and HosteraX runs it, reads the public URL, reconnects when it drops, and brings it back after the engine restarts.

```bash
htx expose my-app                      # picks the first free option that works on this machine
htx expose:list                        # addresses and status
htx expose:providers                   # every option and what this machine can run
htx expose:logs my-app                 # what the tunnel program printed
htx expose:stop my-app                 # stop being public
htx expose:auto on                     # opt in: make every deployed project public automatically
htx expose:ip --save                   # look up this machine's public IP and use it for Magic DNS names
```

The same thing is in the dashboard under **Public access**. Only an `admin` can use it.

| `--provider`       | Account needed                     | You get                                                 | This machine needs             | Notes                                                                                                |
| :----------------- | :--------------------------------- | :------------------------------------------------------ | :----------------------------- | :--------------------------------------------------------------------------------------------------- |
| `cloudflare`       | none                               | random `https://….trycloudflare.com`                    | `cloudflared`, or Docker       | Cloudflare calls quick tunnels a testing tool: no uptime promise                                     |
| `localhost-run`    | none                               | random `https://….lhr.life`                             | `ssh`                          | Address changes on every restart                                                                     |
| `pinggy`           | none                               | random `https://….pinggy.link`                          | `ssh`                          | Free sessions last 60 minutes; HosteraX reconnects and the address changes                           |
| `serveo`           | none                               | random `https://….serveousercontent.com`                | `ssh`                          | Community service, often down                                                                        |
| `localtunnel`      | none                               | random `https://….loca.lt`                              | Node.js (`npx`)                | Visitors see a click-through page; downloads npm code on start, so `auto` never picks it             |
| `ngrok`            | free ngrok account                 | random or your one free static domain                   | `ngrok`, or Docker             | `--authtoken` (or `NGROK_AUTHTOKEN`); free plan allows one agent online                              |
| `cloudflare-token` | free Cloudflare account + a domain | a stable name on your own domain, every app by hostname | `cloudflared`, or Docker       | Target `edge`; `--token` (or `CLOUDFLARE_TUNNEL_TOKEN`); point the hostname at `http://localhost:80` |
| `tailscale`        | free Tailscale account             | `https://<machine>.<tailnet>.ts.net`                    | Tailscale signed in, Funnel on | One public app per machine; the error shows the link if Funnel is off                                |
| `bore`             | none                               | raw TCP `bore.pub:<port>` (not a web page)              | `bore`, or Docker              | For game servers, databases, SSH. No HTTPS from the relay                                            |
| `custom`           | whatever you use                   | whatever your tool prints                               | your tool                      | zrok, frp, Loophole, Localtonet, playit.gg… Off unless `HOSTERAX_ALLOW_CUSTOM_TUNNELS=1`             |

`auto` (the default) tries `cloudflare`, then `localhost-run`, `pinggy` and `serveo`, skipping what is not installed and moving on when one does not connect, and tells you what it tried. If nothing is installed it says exactly what to install. Programs found on `PATH` are used first; otherwise HosteraX runs the official Docker image.

- **Running the engine in Docker works:** apps are published on the Docker host, so tunnels are pointed at the host's address as seen from the container (its default gateway). Set `HOSTERAX_TUNNEL_HOST` if that is not right for your network.
- **What can be made public:** a deployed project, or the HosteraX edge proxy (`edge`). The engine API and the dashboard are never reachable through a tunnel, whatever port you configure.
- **Anyone with the address can open the app.** It is exposed as it is, so give it its own login. Free relays are run by other companies: they carry your traffic and can change or end their free offer.
- **Tokens** (Cloudflare, ngrok) are stored encrypted, handed to the tunnel program through its environment rather than its command line, scrubbed from logs, and never returned by the API.
- **Automatic mode** (`htx expose:auto on`, or the dashboard) gives every deployed project its own address, including new deployments. It is off by default because it makes _every_ app public. Stopping one tunnel in the list sticks.
- **Direct exposure instead of a tunnel:** `htx expose:ip` tells you this machine's public IP and whether it is assigned to this machine (a VPS: open ports 80/443 and point a DNS record at it) or sits behind a router/NAT (use a tunnel, or forward 80/443). Nothing here opens router ports for you.
- **Not verified against the live services.** The tunnel commands and the way each address is recognised follow each provider's documentation and are tested against stand-in programs that print the documented output; they were not run against the real services. If one does not connect, `htx expose:logs` shows what it printed, and the `custom` provider lets you adapt the command and pattern.

## 🖥️ Remote servers (deploy over SSH)

Run a project on another machine instead of the one hosting the engine. The server needs Linux, Docker, and an SSH user that may use Docker (`docker` group). Nothing else is installed on it.

```bash
htx server:add "Frankfurt VPS" --host 203.0.113.50 --user deploy   # prints a public key
# on the server (as root):  htx server:bootstrap <id> | bash       # installs Docker and authorises that key
htx server:trust <id>                 # shows the host key fingerprint; confirm it matches your provider's console
htx server:test <id>                  # logs in, checks Docker, reads CPU / RAM / disk
htx create shop --server <id> --source nginx:alpine --port 80
htx deploy shop
```

The same steps are in the dashboard: **Servers** → Add Server Node → Confirm host key, then choose **Run on** when you create a project.

- **The host key is confirmed by you, once, and a changed key is refused.** HosteraX connects to a server only after you have confirmed its fingerprint, with strict host-key checking, key login only (no passwords, no agent, no terminal) and its own generated ssh config, so your personal `~/.ssh/config` plays no part. If the key later changes (a reinstall, or someone intercepting the connection) nothing is sent until you confirm the new one.
- **How it runs.** Docker commands go to the server's daemon through a small bridge process that runs `ssh … docker system dial-stdio` (the mechanism Docker's own `ssh://` support uses), so builds happen on the server and the same code that deploys locally deploys remotely. The container publishes only on the **server's loopback**; HosteraX forwards that port over the same SSH connection to a port on this machine, and routes, health checks, domains and public tunnels use that local port. The app is never reachable on the server's own public address.
- **When the server is unreachable**, its projects show as unreachable, not crashed: nothing is restarted, rolled back or redeployed until it answers again. A deploy to it fails at once with the reason (login rejected, host key changed, Docker not running, no permission to use Docker…).
- **Requirements and limits.** The engine must run on Linux or macOS (not Windows) with OpenSSH installed, and the server's `sshd` must allow TCP forwarding (the default). Only single-container Docker projects can be placed on a server (no compose or process targets). A deployed project cannot be moved: create it again. Managed databases, backups, scale-to-zero and the metrics charts still work on this machine only; self-heal and the start, stop, restart and log commands work remotely. Traffic from the internet still enters through this machine's edge or tunnel: there is no edge on the server yet. Anyone who can use the server's Docker group is root on it.
- **Tested against a real Docker daemon, not yet on a second machine.** The tests run the real engine, the real `docker` CLI, a real OpenSSH server and a real Docker daemon behind it: images are pulled and containers started, stopped, redeployed and rolled back on it, a Dockerfile project is built on it through the bridge, and its logs and port forward are used. That "server" is a second Docker daemon on the same machine as the test, so nothing has crossed a real network, and the proxy (Caddy/OpenResty) in front of a remote app has not been run for real. Your first real server is the first real check of those.

## 🔒 Password protection

```bash
echo 'a long password' | htx gate shop --password-stdin    # on
htx gate shop                                              # status
htx gate shop --off
```

Also under the project's **Settings**. Visitors see a password page; after the right password they get a 12-hour session cookie and everything (WebSockets included) is passed through to the app. The gate sits in front of the app and routes and public addresses are pointed at it, so it works with domains, the edge proxy and tunnels alike. The password is stored as a PBKDF2 hash, five wrong attempts lock a visitor out for 15 minutes, a new password signs everyone out, and the app never sees the gate's cookie. Redeploy the app after switching it on, so its own port is published on loopback only; before that, anyone on your network who knows the app's port can still reach it directly. It is one shared password, not user accounts.

## 🔔 Notifications

```bash
htx notify:add "Team Slack" --type slack --url https://hooks.slack.com/services/…
htx notify:add ops --type webhook --url https://example.com/hook --secret s3cret     # JSON, HMAC-signed
htx notify:add me --type email --to you@example.com                                # uses your Mail SMTP relay
htx notify:add phone --type ntfy --url https://ntfy.sh/my-topic
htx notify:list ; htx notify:test <id>
```

Channels (also on the dashboard's **Notifications** page) can subscribe to: `deploy.failed`, `deploy.succeeded`, `project.unhealthy` (crash loop, out of memory, auto-rollback), `server.down`, `server.up`, `backup.failed` (including a failed restore drill), `tunnel.failed` and `system.docker`. With nothing ticked a channel gets everything except the quiet ones (`deploy.succeeded`, `server.up`). The same problem for the same project is reported once per ten minutes. URLs are stored encrypted, shown masked, must be http(s), and are never followed through redirects; a failing channel shows its last error instead of failing silently. Webhook bodies carry `X-Hosterax-Signature: sha256=<hmac>` when you set a secret.

## 📚 API

The engine serves an OpenAPI 3.1 description of its routes at `GET /api/openapi.json` (paths and
methods; response schemas are not modelled yet). It is generated from the engine source, and CI fails
if the CLI or the dashboard call a route that is not in it.

Reference pages generated from the code (CI fails if they drift): [docs/CLI.md](docs/CLI.md) (every command), [docs/API.md](docs/API.md) (every route and the token scope it needs) and [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md) (what HosteraX is built from, under which licences, and the programs it starts or pulls).

---

## 🔐 Security & Configuration

- API tokens are stored only as SHA-256 hashes and are shown once, when created. Scopes: `read` < `deploy` < `admin`.
- Only requests from the engine's own machine (loopback, same origin) are trusted without a token. Everything else needs `Authorization: Bearer <token>`.
- Project environment variables, SSH keys, S3 credentials, DKIM private keys, SMTP relay passwords, TLS private keys and AI provider keys are encrypted at rest (AES-256-GCM); mailbox passwords are stored as salted scrypt hashes. Values written by older versions are encrypted automatically on the next start. The key lives in `$HOSTERAX_HOME/secret.key` (mode 0600) unless you set `HOSTERAX_SECRET_KEY`; back it up with your data.
- Environment variable values are masked in build/runtime logs. They are never part of a project's JSON, and `read`-scoped tokens cannot read them; variables flagged secret are also masked for `deploy` tokens in `GET /api/projects/:name/env`. They are decrypted only when an app is deployed or when a `deploy`-level MCP/AI tool reads them.
- Public endpoints: `/api/health` and the GitHub webhook receiver (`/webhooks/github`, HMAC-verified).

| Variable                                                | Default       | Purpose                                                                                                                                                                                               |
| :------------------------------------------------------ | :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOSTERAX_PORT`                                         | `7777`        | Port the engine listens on                                                                                                                                                                            |
| `HOSTERAX_HOME`                                         | `~/.hosterax` | State directory (database, key, backups)                                                                                                                                                              |
| `HOSTERAX_REQUIRE_AUTH`                                 | off           | Set to `1` to require a token even for local requests                                                                                                                                                 |
| `HOSTERAX_TRUSTED_ORIGINS`                              | –             | Comma-separated extra browser origins allowed to call the API                                                                                                                                         |
| `HOSTERAX_BIND_HOST`                                    | `0.0.0.0`     | Interface deployed apps publish on (`127.0.0.1` forces traffic through the edge proxy)                                                                                                                |
| `HOSTERAX_PUBLIC_URL`                                   | –             | Where people reach the engine (SSO redirect address, invite links). Not detected automatically                                                                                                        |
| `HOSTERAX_PUBLIC_IP`                                    | `127.0.0.1`   | Public IPv4 used for Magic DNS names such as `app.203-0-113-9.sslip.io`. **Not detected automatically**: `htx expose:ip --save` looks it up and saves it                                              |
| `HOSTERAX_TUNNEL_HOST`                                  | auto          | Address tunnels send traffic to for apps on this machine: `127.0.0.1`, or the Docker host's gateway when the engine runs in a container                                                               |
| `HOSTERAX_ALLOW_CUSTOM_TUNNELS`                         | off           | Set to `1` to allow the `custom` tunnel provider, which runs a command you give it                                                                                                                    |
| `HOSTERAX_TUNNEL_PROBE`                                 | on            | Set to `0` to stop the engine checking, from this machine, that a new tunnel's public address answers                                                                                                 |
| `HOSTERAX_IP_LOOKUP_URLS`                               | built-in      | Comma-separated URLs that return this machine's public IP as plain text (replaces the built-in public services)                                                                                       |
| `HOSTERAX_<TOOL>_PATH`                                  | –             | Where a tunnel program lives if it is not on `PATH`, e.g. `HOSTERAX_CLOUDFLARED_PATH`, `HOSTERAX_SSH_PATH`, `HOSTERAX_NGROK_PATH`                                                                     |
| `HOSTERAX_<TOOL>_IMAGE`                                 | pinned        | Docker image used for `CLOUDFLARED`, `NGROK` or `BORE` when the program is not installed. Defaults are pinned by version and digest; set this to move to a newer one                                  |
| `HOSTERAX_SSH_KEYSCAN_PATH`, `HOSTERAX_SSH_KEYGEN_PATH` | on `PATH`     | Where `ssh-keyscan` and `ssh-keygen` live, for remote servers                                                                                                                                         |
| `HOSTERAX_SERVER_POLL_MS`                               | `60000`       | How often connected remote servers are checked                                                                                                                                                        |
| `HOSTERAX_EDGE_PROVIDER`                                | `caddy`       | Proxy used for domains: `caddy`, `openresty`, or `external` to run none (you provide your own proxy; no container is started, no port 80/443 is taken). Read once, when the database is first created |
| `HOSTERAX_PULL_RETRY_MS`                                | `3000,8000`   | Waits between retries when a registry fails temporarily (rate limit, timeout, 5xx) while pulling an image                                                                                             |
| `HOSTERAX_SECRET_KEY`                                   | generated     | Passphrase used to derive the at-rest encryption key (overrides `secret.key`)                                                                                                                         |
| `HOSTERAX_IMAGE_DISCOVERY`                              | off           | Set to `1` to let the engine search Docker Hub and substitute a different publisher's image when a catalog image can't be pulled — a typosquatting risk                                               |
| `HOSTERAX_DEV`                                          | off           | Set to `1` to also trust the Vite dev-server origins (8080, 5173, 3000)                                                                                                                               |
| `HOSTERAX_URL` / `HOSTERAX_TOKEN`                       | –             | Where the CLI and `htx mcp` connect                                                                                                                                                                   |

Known limitations: free tunnels depend on third-party relays, remote servers run single-container Docker projects only and have no edge of their own (see [Remote servers](#-remote-servers-deploy-over-ssh)), an inbound mail server is not implemented, team roles are a directory only (permissions come from API token scopes), and the edge proxy's Caddy admin API is reachable inside its container network. See [SECURITY.md](SECURITY.md) and [ROADMAP.md](ROADMAP.md).

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
© 2026 HosteraX Contributors
