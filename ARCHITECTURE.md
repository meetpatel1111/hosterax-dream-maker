# 🏛️ HosteraX Architecture & System Design

HosteraX is an autonomous, self-hosted cloud control plane designed to bridge modern developer workflows, containerized cloud infrastructure, and AI engineering agents via the **Model Context Protocol (MCP)**.

---

## 📐 High-Level Architectural Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             USER INTERFACES                                 │
├───────────────────────────────┬───────────────────────────────┬─────────────┤
│   Web Dashboard (React 19)    │    Native Desktop (Electron)  │ CLI ('htx') │
│   TanStack Start on :8080     │    Embedded Supervisor & Tray │ npx hosterax│
└───────────────┬───────────────┴───────────────┬───────────────┴──────┬──────┘
                │                               │                      │
                │ HTTP REST / Server-Sent Events│                      │
                ▼                               ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HOSTERAX ENGINE DAEMON (Port :7777)                      │
│                Native Node.js 20+ ESM • SQLite (WAL Mode)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐ │
│  │ Model Context Protocol│  │ Autonomous Self-Heal  │  │ Deployment Engine│ │
│  │ 34 Tools (JSON-RPC 2) │  │ Watchdog & AI Rollback│  │ Zero-Downtime B/G│ │
│  └───────────────────────┘  └───────────────────────┘  └──────────────────┘ │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐ │
│  │ Multi-Node Remote Fleet│ │ Database & S3 Manager │  │ Edge TLS Proxy   │ │
│  │ SSH Agent Manager     │  │ Snapshots & SHA-256   │  │ Magic DNS (nip)  │ │
│  └───────────────────────┘  └───────────────────────┘  └──────────────────┘ │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
      ┌───────────────────────────┐         ┌───────────────────────────┐
      │   LOCAL WORKLOADS (Host)  │         │   REMOTE SERVERS (Fleet)  │
      │ 🐳 Docker Engine / Compose │         │ 💻 Ubuntu / Debian / RHEL │
      │ ⚡ Native Node/Go/Python  │         │ 🔒 SSH Agent & Key Auth   │
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
- Exposes **34 registered tools** across:
  - Project provisioning, zero-downtime deployment, logs, rollback, and restart.
  - Managed database provisioning (Postgres, MySQL, MongoDB, Redis) and point-in-time snapshot restore.
  - Edge routing, custom domain verification, and Let's Encrypt SSL certificates.
  - Multi-node remote server SSH connection testing.
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

### 5. Multi-Node Remote Fleet Management (`hosterax/engine/src/server-manager.mjs`)

- Connects to remote Linux servers via encrypted SSH.
- Gathers hardware metrics (CPU load, memory usage, disk headroom, Docker status).
- Deploys container workloads to remote nodes with zero remote agent installation required.

---

### 6. Edge Proxy & Magic DNS (`hosterax/engine/src/edge-manager.mjs` & `tls-manager.mjs`)

- **Edge Drivers**: Supports OpenResty (Lua-powered dynamic routing) and Caddy 2.
- **Magic DNS**: Instant wildcards via `nip.io` and `sslip.io` without requiring manual DNS configuration.
- **Automated SSL**: Automatic ACME HTTP-01 challenge verification and Let's Encrypt TLS renewal.

---

### 7. App Store & 2,502+ Template Catalog (`public/catalog.json`)

- Offline-first database compiling templates from **Awesome-Selfhosted**, **selfh.st**, and **Awesome-Sysadmin**.
- Pre-mapped container images with high-resolution vector SVGs from **Homarr** and **Simple Icons**.
