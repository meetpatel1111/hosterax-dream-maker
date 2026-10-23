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
│                Native Node.js 20+ ESM • SQLite (WAL Mode)                   │
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

### 5. Server Registry (`hosterax/engine/src/server-manager.mjs`)

- Stores remote Linux hosts (SSH key encrypted at rest) and checks that their SSH port is reachable.
- Generates a Docker bootstrap script to run on a new host.
- The local node reports real CPU/RAM figures; remote nodes show unknown specs until a probe is implemented.
- **Not implemented:** running deployments on remote nodes. Projects currently run on the machine hosting the engine (see [ROADMAP.md](ROADMAP.md)).

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
