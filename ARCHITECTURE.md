# 🏛️ HosteraX Architecture & System Design

HosteraX is an autonomous, self-hosted cloud control plane designed to bridge modern developer workflows, containerized cloud infrastructure, and AI engineering agents via the **Model Context Protocol (MCP)**.

---

## 📐 High-Level Architectural Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             USER INTERFACES                                 │
├───────────────────────────────┬───────────────────────────────┬─────────────┤
│   Web Dashboard (React 19)    │    Native Desktop (Electron)  │ CLI ('htx') │
│   Served by the engine on :7777│    Embedded Supervisor & Tray │ npx hosterax│
└───────────────┬───────────────┴───────────────┬───────────────┴──────┬──────┘
                │                               │                      │
                │ HTTP REST / Server-Sent Events│                      │
                ▼                               ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HOSTERAX ENGINE DAEMON (Port :7777)                      │
│                Native Node.js 22+ ESM • SQLite (WAL Mode)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐ │
│  │ Model Context Protocol│  │ Autonomous Self-Heal  │  │ Deployment Engine│ │
│  │ 46 Tools (JSON-RPC 2) │  │ Watchdog & AI Rollback│  │ Blue/Green Deploys│ │
│  └───────────────────────┘  └───────────────────────┘  └──────────────────┘ │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐ │
│  │ Server Registry       │ │ Database & S3 Manager │  │ Edge TLS Proxy   │ │
│  │ Reachability + script │  │ Snapshots & SHA-256   │  │ Magic DNS (nip)  │ │
│  └───────────────────────┘  └───────────────────────┘  └──────────────────┘ │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
      ┌───────────────────────────┐         ┌───────────────────────────┐
      │   LOCAL WORKLOADS (Host)  │         │   REMOTE SERVERS (Fleet)  │
      │ 🐳 Docker Engine / Compose │         │ 💻 Ubuntu / Debian / RHEL │
      │ ⚡ Native Node/Go/Python  │         │ 📝 Registered only (no deploy yet) │
      └───────────────────────────┘         └───────────────────────────┘
```

---

## 🧩 Core Subsystems

### 1. Control Plane & Web Dashboard (`src/`)

- **Technology**: TanStack Start, React 19, Tailwind CSS, Radix UI.
- **File-Based Routing**: Strict route typing via `@tanstack/react-router` in `src/routes/`.
- **Localization**: Native instant multi-language support (English, Spanish, French, German, Chinese, Japanese, Arabic with RTL).
- **Telemetry**: Real-time CPU, RAM, disk gauges, and deployment log streaming via WebSocket and SSE.

---

### 2. Universal MCP Server (`hosterax/engine/src/mcp-server.mjs`)

- Implements the **Model Context Protocol (JSON-RPC 2.0)** for direct AI agent integration.
- Exposes **46 registered tools**, each gated by the calling token's scope (`read`/`deploy`/`admin`), across:
  - Project provisioning, zero-downtime deployment, logs, rollback, and restart.
  - Managed database provisioning (Postgres, MySQL, MongoDB, Redis) and point-in-time snapshot restore.
  - Edge routing, custom domain verification, and Let's Encrypt SSL certificates.
  - Server registry reachability tests.
  - Email domains/mailboxes/aliases, GitHub webhooks and PR previews, and organization directory.
  - Cron job scheduling, S3 sync, and AI container crash diagnostics.
- Supports Stdio (`htx mcp:stdio`) and HTTP transport (`/api/mcp`) for **Cursor IDE, Claude Desktop, Devin, Windsurf, and OpenAI Codex**.

---

### 3. Zero-Downtime Deployment & Supervisor (`hosterax/engine/src/index.mjs`)

- **Blue/Green Release Lifecycle**:
  1. Clones repository or resolves direct container image into an isolated versioned workdir (`~/.hosterax/work/<project>/<version>`).
  2. Builds project using native toolchains or generated multi-stage Dockerfiles.
  3. Boots new service on an ephemeral target port.
  4. Runs health-check probes (`/` or custom `health_path`).
  5. Atomically switches the internal reverse proxy route to the new port once healthy.
  6. Gracefully terminates the previous release snapshot.

---

### 4. Autonomous Self-Healing & AI Diagnostics (`hosterax/engine/src/self-heal.mjs`)

- Probes running containers and processes every 5 seconds.
- Automatically handles:
  - **Deadlock / Unresponsive Sockets**: Suspends intrusive checks when Docker Desktop is offline.
  - **Crash Loops**: Implements exponential backoff and circuit breaking (`CLOSED` ➔ `OPEN` ➔ `HALF-OPEN`).
  - **Automatic Rollback**: Auto-reverts to the last known working release snapshot if 3 consecutive failures occur.
  - **AI Crash Diagnostics**: Analyzes stack traces and container exit codes to recommend 1-click code fixes.

---

### 5. Remote Servers (`server-manager.mjs`, `ssh-transport.mjs`, `ssh-bridge-worker.mjs`, `docker-scope.mjs`)

- **Servers**: Linux hosts reached with the system `ssh` using key authentication. The key is stored encrypted; the host key must be confirmed by an admin and is pinned (a changed key is refused). A monitor re-checks each connected server every minute and records status changes as events.
- **One way to reach Docker**: a bridge process per server listens on a private unix socket and turns each connection into `ssh … docker system dial-stdio`. `DOCKER_HOST=unix://<that socket>` therefore works for the Docker CLI and the engine's HTTP Docker client alike. It is a separate process because the engine calls `spawnSync("docker", …)` in many places, which blocks its own event loop.
- **Placement**: `projects.server_id`. The work for a project runs inside `runOnServer(serverId, …)` (`docker-scope.mjs`, an `AsyncLocalStorage` scope): while it is active, `docker` processes started through the scoped `spawn` / `execFile` / `spawnSync` get that server's `DOCKER_HOST`. Deploy, stop, restart, rollback, logs, delete, self-heal and prune all use it; a server that is down makes the call fail instead of falling back to this machine.
- **Reaching the app**: the container publishes on the server's loopback (`projects.remote_port`); the bridge forwards it with `ssh -W` over the same connection to `projects.port` on this machine, so routes, health checks, domains and tunnels are unchanged.
- **Failure behaviour**: an unreachable server shows its projects as unreachable; self-heal does nothing for them until it answers.
- **Not implemented:** compose or process targets on a server, an edge on each server, an agent for servers behind NAT, remote managed databases and backups, remote metrics charts. See [ROADMAP.md](ROADMAP.md).

---

### 5b. Password Gate (`gate-manager.mjs`) and Notifications (`notification-manager.mjs`)

- **Gate**: a per-project listener that shows a password page, then proxies (HTTP and WebSocket) to the app. Routes and tunnels point at the gate's port instead of the app's.
- **Notifications**: subscribes to the engine's event log (self-heal, tunnels, servers, scheduled backups) and to deployment outcomes, and delivers to webhook, Slack, Discord, ntfy or email channels with de-duplication and per-channel status.

---

### 6. Edge Proxy & Magic DNS (`hosterax/engine/src/edge-manager.mjs` & `tls-manager.mjs`)

- **Edge Drivers**: Supports OpenResty (Lua-powered dynamic routing) and Caddy 2.
- **Magic DNS**: Instant wildcards via `nip.io` and `sslip.io` without requiring manual DNS configuration.
- **Automated SSL**: Automatic ACME HTTP-01 challenge verification and Let's Encrypt TLS renewal.

---

### 7. App Store & 2,500+ Template Catalog (`public/catalog.json`)

- Bundled database (no network needed to browse) compiling templates from **Awesome-Selfhosted**, **selfh.st**, and **Awesome-Sysadmin**.
- Container images are mapped per entry. Entries with `imageVerified: true` were confirmed against a registry; the rest are best guesses that the image resolver tries (and reports on) at deploy time.
- Logos are loaded from public icon CDNs and can be switched off in Settings → Privacy.
