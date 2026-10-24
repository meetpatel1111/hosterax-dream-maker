#!/usr/bin/env node
// HosteraX engine daemon. Real HTTP+WS server; spawns real deploys.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFile } from "./docker-scope.mjs";
import { spawnSync } from "./safe-exec.mjs";
import { runOnServer, currentServerId, configureDockerScope } from "./docker-scope.mjs";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import { createProjectsApi, initProjectsSchema } from "./projects-api.mjs";
import { normalizeDomain, assertDomainAvailable } from "./domain-utils.mjs";
import { initSecrets, encryptJson, decryptJson } from "./secrets.mjs";
import { AccountManager, AccountError } from "./accounts.mjs";
import { OidcClient, OidcError, loadOidcConfig } from "./oidc.mjs";
import { ENGINE_VERSION } from "./version.mjs";
import { createCatalogApi, catalogApps as catalogAppsList } from "./catalog-api.mjs";
import {
  generateToken,
  hashToken,
  tokenPrefix,
  bearerFrom,
  isTrustedLocalRequest,
  scopesLevel,
  requiredLevel,
  assertSafeImageRef,
  splitArgs,
  isValidEnvKey,
  displayArgv,
  isSafeContainerName,
} from "./security.mjs";
import {
  DETECTORS,
  STACK_REGISTRY,
  detectStackDir,
  detectPackageManager,
  detectWorkspace,
} from "./stack-registry.mjs";
import { SelfHealEngine } from "./self-heal.mjs";
import { pullWithUniversalHealing, normalizeImageSource } from "./image-resolver.mjs";
import { TLSManager } from "./tls-manager.mjs";
import { EdgeManager } from "./edge-manager.mjs";
import { BackupManager } from "./backup-manager.mjs";
import { CronManager } from "./cron-manager.mjs";
import { MCPServer } from "./mcp-server.mjs";
import { ServerManager } from "./server-manager.mjs";
import { GateManager } from "./gate-manager.mjs";
import { NotificationManager, EVENT_KINDS, CHANNEL_TYPES } from "./notification-manager.mjs";
import { createDashboard } from "./dashboard-server.mjs";
import { BackupScheduler } from "./backup-scheduler.mjs";
import {
  TunnelManager,
  PROVIDERS as TUNNEL_PROVIDERS,
  detectPublicIp,
  isPrivateAddress,
  tunnelTargetHost,
} from "./tunnel-manager.mjs";
import { WebhookManager } from "./webhook-manager.mjs";
import { OrgManager } from "./org-manager.mjs";
import { EmailManager } from "./email-manager.mjs";
import { S3StorageClient } from "./s3-storage.mjs";
import { GpuManager } from "./gpu-manager.mjs";
import { ScaleToZeroManager } from "./scale-to-zero.mjs";
import { AIOpsManager } from "./ai-ops.mjs";
import { MetricsManager } from "./metrics-manager.mjs";
import { DockerApiClient } from "./docker-api.mjs";
import { generateUniversalDockerfile } from "./dockerfile-generator.mjs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOME = process.env.HOSTERAX_HOME
  ? path.resolve(process.env.HOSTERAX_HOME)
  : path.join(os.homedir(), ".hosterax");
const WORK = path.join(HOME, "work");
const LOGDIR = path.join(HOME, "logs");
const EDGEDIR = path.join(HOME, "edge");
for (const d of [HOME, WORK, LOGDIR, EDGEDIR]) fs.mkdirSync(d, { recursive: true });
try {
  fs.chmodSync(HOME, 0o700); // the database and secret key live here
} catch {}
initSecrets(HOME);

const db = new Database(path.join(HOME, "hosterax.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("cache_size = -8000"); // 8MB memory cache ceiling
db.pragma("temp_store = MEMORY");
db.pragma("mmap_size = 33554432"); // 32MB max memory mapped I/O
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  build_cmd TEXT,
  start_cmd TEXT,
  env_json TEXT NOT NULL DEFAULT '{}',
  target TEXT NOT NULL DEFAULT 'process',
  cpu_limit REAL,
  memory_mb_limit INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  version TEXT NOT NULL,
  phase TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  exit_code INTEGER,
  workdir TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  ssl_status TEXT NOT NULL DEFAULT 'none',
  ssl_expires TEXT,
  challenge_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS managed_dbs (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  engine TEXT NOT NULL,
  size_mb INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'provisioning',
  connection_string TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  project_name TEXT,
  database_name TEXT NOT NULL,
  db_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_db ON backups(database_name);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'github',
  secret TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS installed_apps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  container_id TEXT,
  port INTEGER,
  status TEXT NOT NULL DEFAULT 'installing',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  image TEXT,
  build_context TEXT,
  ports_json TEXT NOT NULL DEFAULT '[]',
  volumes_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  depends_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL,
  UNIQUE (project, name)
);
CREATE TABLE IF NOT EXISTS routes (
  project TEXT PRIMARY KEY,
  hostname TEXT,
  upstream_port INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  detail TEXT,
  config_path TEXT,
  updated_at INTEGER NOT NULL
);
`);

// Migrations
try {
  db.exec("ALTER TABLE projects ADD COLUMN cpu_limit REAL");
} catch (e) {}
try {
  db.exec("ALTER TABLE projects ADD COLUMN memory_mb_limit INTEGER");
} catch (e) {}
try {
  db.exec("ALTER TABLE projects ADD COLUMN port INTEGER");
} catch (e) {}
try {
  db.exec("ALTER TABLE projects ADD COLUMN restart_policy TEXT DEFAULT 'on-failure'");
} catch (e) {}
// Where a project runs: NULL / 'local' is this machine; otherwise a remote server's id. For a remote
// project `port` is the port on this machine that reaches it (an SSH forward) and `remote_port` is the
// port the container publishes on the server's loopback.
try {
  db.exec("ALTER TABLE projects ADD COLUMN server_id TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE projects ADD COLUMN remote_port INTEGER");
} catch (e) {}
try {
  db.exec("ALTER TABLE deployments ADD COLUMN snapshot_json TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE deployments ADD COLUMN environment TEXT DEFAULT 'production'");
} catch (e) {}
try {
  db.exec("ALTER TABLE deployments ADD COLUMN route_status TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE deployments ADD COLUMN stack TEXT");
} catch (e) {}

// Settings key-value store
try {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  // Seed defaults
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(
    "magic_dns_provider",
    "sslip.io",
  );
} catch (e) {}

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row?.value ?? fallback;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
}
const MAGIC_DNS_PROVIDERS = {
  "sslip.io": {
    suffix: "sslip.io",
    format: (proj) => `${proj}.127-0-0-1.sslip.io`,
    label: "sslip.io",
    badge: "Recommended",
    description: "Modern & robust wildcard DNS. Supports IPv4, IPv6, and hexadecimal addresses.",
    status: "active",
  },
  "nip.io": {
    suffix: "nip.io",
    format: (proj) => `${proj}.127.0.0.1.nip.io`,
    label: "nip.io",
    badge: "Popular",
    description: "Classic zero-config wildcard DNS (127.0.0.1.nip.io) for local apps.",
    status: "active",
  },
  "traefik.me": {
    suffix: "traefik.me",
    format: (proj) => `${proj}.traefik.me`,
    label: "traefik.me",
    badge: "Zero-Config",
    description: "Clean domain format mapping subdomains directly to 127.0.0.1.",
    status: "active",
  },
  "ipq.co": {
    suffix: "ipq.co",
    format: (proj) => `${proj}.127.0.0.1.ipq.co`,
    label: "ipq.co",
    badge: "Alternative",
    description: "Configurable DNS wildcard mapping service for target IPs.",
    status: "active",
  },
  "fdns.uk": {
    suffix: "fdns.uk",
    format: (proj) => `${proj}.127.0.0.1.fdns.uk`,
    label: "fdns.uk",
    badge: "Fast",
    description: "Magic wildcard domain resolving to any target IP address.",
    status: "active",
  },
  localhost: {
    suffix: "localhost",
    format: (proj) => `${proj}.localhost`,
    label: ".localhost",
    badge: "Offline / Native",
    description: "RFC 6761 browser-native loopback domain. Works without internet.",
    status: "active",
  },
};

function getServerIp() {
  return (
    process.env.SERVER_IP ||
    process.env.HOSTERAX_PUBLIC_IP ||
    getSetting("server_public_ip", "127.0.0.1")
  );
}

function getMagicDnsHost(projectName) {
  const provider = getSetting("magic_dns_provider", "sslip.io");
  const ip = getServerIp();
  const dashedIp = ip.replace(/\./g, "-");

  if (provider === "nip.io") return `${projectName}.${ip}.nip.io`;
  if (provider === "traefik.me")
    return ip === "127.0.0.1" ? `${projectName}.traefik.me` : `${projectName}.${ip}.nip.io`;
  if (provider === "ipq.co") return `${projectName}.${ip}.ipq.co`;
  if (provider === "fdns.uk") return `${projectName}.${ip}.fdns.uk`;
  if (provider === "localhost") return `${projectName}.localhost`;
  return `${projectName}.${dashedIp}.sslip.io`;
}

initProjectsSchema(db);

// Clean up stale in-flight deployments from previous engine sessions/restarts
try {
  db.prepare(
    `
    UPDATE deployments 
    SET phase='failed', finished_at=?, exit_code=1 
    WHERE phase IN ('queued', 'building', 'pulling', 'deploying', 'fetching', 'health_check') AND (exit_code IS NULL OR exit_code != 0)
  `,
  ).run(Date.now());
  db.prepare(
    `UPDATE deployments SET phase='ready' WHERE phase='health_check' AND exit_code=0 AND finished_at IS NOT NULL`,
  ).run();
} catch {}

// API tokens are stored as SHA-256 digests; the plaintext is only ever shown once at creation.
for (const [col, type] of [
  ["prefix", "TEXT"],
  ["last_used_at", "INTEGER"],
]) {
  try {
    db.exec(`ALTER TABLE tokens ADD COLUMN ${col} ${type}`);
  } catch {}
}
// One-time migration of legacy plaintext tokens (they all start with "hxt_"; digests are 64 hex chars).
try {
  const legacy = db
    .prepare("SELECT token FROM tokens WHERE token LIKE 'hxt\\_%' ESCAPE '\\'")
    .all();
  const migrate = db.prepare("UPDATE tokens SET token=?, prefix=? WHERE token=?");
  for (const row of legacy) migrate.run(hashToken(row.token), tokenPrefix(row.token), row.token);
  if (legacy.length)
    console.log(`[security] Migrated ${legacy.length} API token(s) to hashed storage.`);
} catch (e) {
  console.warn("[security] token migration failed:", e.message);
}

// bootstrap token
const tokenCount = db.prepare("SELECT COUNT(*) c FROM tokens").get().c;
if (tokenCount === 0) {
  const t = generateToken();
  db.prepare(
    "INSERT INTO tokens (token, name, created_at, scopes_json, prefix) VALUES (?,?,?,?,?)",
  ).run(hashToken(t), "bootstrap", Date.now(), JSON.stringify(["*"]), tokenPrefix(t));
  console.log("\n╭─ HosteraX Engine ─────────────────────────────╮");
  console.log("│ Bootstrap token (save this — shown only once):│");
  console.log("│ " + t.padEnd(45) + " │");
  console.log("╰───────────────────────────────────────────────╯\n");
}

// ---------- rate limiter ----------
const rateLimiter = new Map(); // ip -> { count, resetAt }
function rateLimit(req, maxRequests = 60, windowMs = 60000) {
  const ip = req.socket?.remoteAddress || "unknown";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost") {
    return false;
  }
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  if (entry.count > maxRequests) return true;
  return false;
}
// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimiter) {
    if (now > entry.resetAt) rateLimiter.delete(ip);
  }
}, 300000);

// ---------- log bus ----------
const subscribers = new Map(); // deploymentId -> Set<ws>
const deploymentLogs = new Map(); // deploymentId -> [{ts, stream, text}]
const MAX_DEPLOYMENT_LOG_ENTRIES = 5000;
const MAX_ACTIVE_LOG_BUFFERS = 200;
function publish(deploymentId, line) {
  const item = {
    deploymentId,
    ts: line.ts || Date.now(),
    stream: line.stream || "stdout",
    text: line.text || "",
  };
  const msg = JSON.stringify(item);
  const set = subscribers.get(deploymentId);
  if (set) {
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  // Memory buffer for deployment
  const depBuf = deploymentLogs.get(deploymentId) ?? [];
  depBuf.push(item);
  while (depBuf.length > MAX_DEPLOYMENT_LOG_ENTRIES) depBuf.shift();
  deploymentLogs.set(deploymentId, depBuf);

  // Pipe to project runtimeLogs for instant SSE streaming
  try {
    const dep = db.prepare("SELECT project FROM deployments WHERE id=?").get(deploymentId);
    if (dep?.project) {
      const pBuf = runtimeLogs.get(dep.project) ?? [];
      pBuf.push(item);
      while (pBuf.length > RUNTIME_CAP) pBuf.shift();
      runtimeLogs.set(dep.project, pBuf);
    }
  } catch {}

  try {
    fs.promises.appendFile(
      path.join(LOGDIR, deploymentId + ".log"),
      `[${new Date(item.ts).toISOString()}] ${item.stream}: ${item.text}\n`,
    );
  } catch {}
}

// Cleanup abandoned log buffers every 5 minutes
setInterval(() => {
  // Remove deployment log buffers for completed/failed deployments not in running set
  for (const [id] of deploymentLogs) {
    if (!subscribers.has(id) && !running.has(id.split("_d_")[0])) {
      deploymentLogs.delete(id);
    }
  }
  // Cap total active log buffers
  if (deploymentLogs.size > MAX_ACTIVE_LOG_BUFFERS) {
    const keys = [...deploymentLogs.keys()];
    for (let i = 0; i < keys.length - MAX_ACTIVE_LOG_BUFFERS; i++) {
      if (!subscribers.has(keys[i])) deploymentLogs.delete(keys[i]);
    }
  }
}, 300000);

// ---------- runtime (post-deploy) log bus ----------
const RUNTIME_CAP = 500;
const runtimeLogs = new Map(); // project -> [{ts,stream,text}]
const runtimeSubs = new Map(); // project -> Set<ws>
function publishRuntime(project, line) {
  const buf = runtimeLogs.get(project) ?? [];
  buf.push(line);
  while (buf.length > RUNTIME_CAP) buf.shift();
  runtimeLogs.set(project, buf);
  const set = runtimeSubs.get(project);
  if (set) {
    const msg = JSON.stringify({ project, ...line });
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {}
    }
  }
}

// running process registry (per project)
const running = new Map(); // project -> { child, restarts, stopped, startedAt, cmd, workdir, env }

// On engine startup, inspect running docker containers starting with hx_ and track them.
// This must never block boot: a missing, stopped or hung Docker daemon only delays the scan.
execFile(
  "docker",
  ["ps", "--filter", "name=hx_", "--format", "{{.Names}}"],
  { timeout: 5000, windowsHide: true },
  (err, stdout) => {
    if (err || !stdout) return;
    try {
      for (const l of String(stdout).trim().split("\n")) {
        const name = l.trim();
        if (!name) continue;
        const projName = name.replace(/^hx_/, "");
        const match = db.prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER(?)").get(projName);
        if (match) {
          running.set(match.name, {
            child: { pid: process.pid },
            stopped: false,
            startedAt: Date.now(),
            cmd: `docker container ${name}`,
            workdir: "",
            env: {},
            policy: "always",
          });
        }
      }
    } catch {}
  },
);

// ---------- project config override (hosterax.json) ----------
function readProjectConfig(workdir) {
  for (const f of ["hosterax.json", ".hosterax.json"]) {
    const p = path.join(workdir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return {
        build_cmd: raw.build ?? raw.buildCommand ?? null,
        start_cmd: raw.start ?? raw.startCommand ?? null,
        port: raw.port ?? null,
        env: raw.env ?? {},
        hostname: raw.hostname ?? raw.domain ?? null,
        target: raw.target ?? null,
        file: f,
      };
    } catch {
      return { parseError: f };
    }
  }
  return null;
}

// ---------- zero-config stack detection (registry lives in stack-registry.mjs) ----------

function detectStack(workdir, p, id) {
  const cfg = readProjectConfig(workdir);
  if (cfg?.parseError)
    publish(id, {
      ts: Date.now(),
      stream: "stderr",
      text: `[config] ${cfg.parseError} is not valid JSON — ignoring`,
    });
  else if (cfg)
    publish(id, {
      ts: Date.now(),
      stream: "system",
      text: `[config] using overrides from ${cfg.file}`,
    });

  const det = detectStackDir(workdir);
  if (det.id !== "unknown") {
    publish(id, {
      ts: Date.now(),
      stream: "system",
      text: `[zero-config] Detected ${det.name} (${det.language}${det.marker ? ", " + det.marker : ""})`,
    });
    if (det.packageManager !== "none")
      publish(id, {
        ts: Date.now(),
        stream: "system",
        text: `[zero-config] Package manager: ${det.packageManager}`,
      });
  } else {
    publish(id, {
      ts: Date.now(),
      stream: "system",
      text: "[zero-config] No known stack marker; using project commands",
    });
  }
  if (det.workspace)
    publish(id, {
      ts: Date.now(),
      stream: "system",
      text: `[monorepo] ${det.workspace.label} detected`,
    });

  const build_cmd = cfg?.build_cmd ?? p.build_cmd ?? det.build ?? null;
  const start_cmd = cfg?.start_cmd ?? p.start_cmd ?? det.start ?? null;
  const port = cfg?.port ?? p.port ?? det.port ?? null;
  return {
    stack: det.id === "unknown" ? "custom" : det.id,
    stackName: det.name,
    language: det.language,
    category: det.category,
    packageManager: det.packageManager,
    workspace: det.workspace?.id ?? null,
    build_cmd,
    start_cmd,
    port,
    extraEnv: cfg?.env ?? {},
    hostname: cfg?.hostname ?? null,
  };
}

// ---------- docker compose import ----------
function parseCompose(workdir) {
  const file = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"]
    .map((f) => path.join(workdir, f))
    .find(fs.existsSync);
  if (!file) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const services = [];
  let inServices = false,
    cur = null,
    key = null;
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const ind = indentOf(raw);
    const line = raw.trim();
    if (ind === 0) {
      inServices = /^services:/.test(line);
      cur = null;
      continue;
    }
    if (!inServices) continue;
    if (ind <= 2 && line.endsWith(":")) {
      cur = {
        name: line.slice(0, -1),
        image: null,
        build_context: null,
        ports: [],
        volumes: [],
        env: {},
        depends: [],
      };
      services.push(cur);
      key = null;
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const val = kv[2].replace(/^["']|["']$/g, "");
      if (key === "image" && val) cur.image = val;
      else if (key === "build" && val) cur.build_context = val;
      else if (key === "context" && val) cur.build_context = val;
      continue;
    }
    const item = line.match(/^-\s*(.+)$/);
    if (item) {
      const val = item[1].replace(/^["']|["']$/g, "");
      if (key === "ports") cur.ports.push(val);
      else if (key === "volumes") cur.volumes.push(val);
      else if (key === "depends_on") cur.depends.push(val);
      else if (key === "environment") {
        const [k, ...rest] = val.split("=");
        if (k) cur.env[k] = rest.join("=");
      }
    }
  }
  return { file, services };
}

function syncComposeServices(project, workdir, id) {
  const parsed = parseCompose(workdir);
  if (!parsed) return null;
  publish(id, {
    ts: Date.now(),
    stream: "system",
    text: `[compose] ${path.basename(parsed.file)} → ${parsed.services.length} service(s)`,
  });
  const ins =
    db.prepare(`INSERT INTO services (id, project, name, image, build_context, ports_json, volumes_json, env_json, depends_json, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project, name) DO UPDATE SET image=excluded.image, build_context=excluded.build_context,
      ports_json=excluded.ports_json, volumes_json=excluded.volumes_json, env_json=excluded.env_json, depends_json=excluded.depends_json`);
  for (const s of parsed.services) {
    ins.run(
      "svc_" + crypto.randomBytes(6).toString("hex"),
      project,
      s.name,
      s.image,
      s.build_context,
      JSON.stringify(s.ports),
      JSON.stringify(s.volumes),
      JSON.stringify(s.env),
      JSON.stringify(s.depends),
      "idle",
      Date.now(),
    );
  }
  const names = parsed.services.map((s) => s.name);
  if (names.length) {
    db.prepare(
      `DELETE FROM services WHERE project=? AND name NOT IN (${names.map(() => "?").join(",")})`,
    ).run(project, ...names);
  }
  return parsed;
}

// ---------- dynamic port allocation ----------
const portLock = new Set();
export function allocateProjectPort(projectName, preferredPort = null, avoid = null) {
  const norm = (s) => (s || "").toLowerCase();
  const currentProjectName = norm(projectName);
  // Prevent concurrent allocation for the same project
  if (portLock.has(currentProjectName)) {
    // Wait and retry
    for (let i = 0; i < 50; i++) {
      if (!portLock.has(currentProjectName)) break;
      // busy wait 10ms
      const start = Date.now();
      while (Date.now() - start < 10) {}
    }
  }
  portLock.add(currentProjectName);
  try {
    // Collect all ports currently assigned or in use by other projects
    const usedPorts = new Set([7777, 8080, ...(avoid ?? [])]);

    // Ports in projects table for other projects
    try {
      const allProjects = db.prepare("SELECT name, port FROM projects").all();
      for (const p of allProjects) {
        if (norm(p.name) !== currentProjectName && p.port) {
          usedPorts.add(Number(p.port));
        }
      }
    } catch {}

    // Ports in routes table for other projects
    try {
      const allRoutes = db.prepare("SELECT project, upstream_port FROM routes").all();
      for (const r of allRoutes) {
        if (norm(r.project) !== currentProjectName && r.upstream_port) {
          usedPorts.add(Number(r.upstream_port));
        }
      }
    } catch {}

    // Ports in running map
    for (const [runProj] of running) {
      if (norm(runProj) !== currentProjectName) {
        try {
          const pr = db
            .prepare("SELECT port FROM projects WHERE LOWER(name)=LOWER(?)")
            .get(runProj);
          if (pr?.port) usedPorts.add(Number(pr.port));
        } catch {}
      }
    }

    // If this project already has a specific port in projects or routes that is NOT taken by others, reuse it
    try {
      const thisProj = db
        .prepare("SELECT port FROM projects WHERE LOWER(name)=LOWER(?)")
        .get(projectName);
      if (thisProj?.port && !usedPorts.has(Number(thisProj.port))) {
        return Number(thisProj.port);
      }
    } catch {}

    // If user or detector preferred a port (e.g. 3000, 5173, 8000) and it's not taken:
    if (preferredPort && !usedPorts.has(Number(preferredPort))) {
      return Number(preferredPort);
    }

    // Otherwise, find the next free port starting at 3000
    let candidate = preferredPort ? Number(preferredPort) : 3000;
    while (usedPorts.has(candidate)) {
      candidate += 1;
    }
    return candidate;
  } finally {
    portLock.delete(currentProjectName);
  }
}

/**
 * allocateProjectPort only knows the ports HosteraX itself has handed out. This also skips ports something
 * else on this machine is listening on (a dev server on 3000, another engine, another app), which would
 * otherwise fail the first deploy with "address already in use". It applies to a project that has not been
 * deployed successfully yet; once it has been, the app listening on its port may be the project itself (a
 * redeploy starts the new version before the old one is gone), so it keeps the port it has.
 */
async function allocateFreeProjectPort(projectName, preferredPort = null) {
  const owned = db
    .prepare(
      "SELECT p.port FROM projects p WHERE LOWER(p.name)=LOWER(?) AND EXISTS (SELECT 1 FROM deployments d WHERE LOWER(d.project)=LOWER(?) AND d.phase='ready')",
    )
    .get(projectName, projectName)?.port;
  const avoid = new Set();
  for (let attempt = 0; attempt < 500; attempt++) {
    const port = allocateProjectPort(projectName, preferredPort, avoid);
    if (port === owned || (await isPortFree(port))) return port;
    avoid.add(port);
  }
  throw new Error("no free port could be found on this machine");
}

// Interface that deployed apps publish on. Use 127.0.0.1 to force all traffic through the edge proxy.
const BIND_HOST = /^[0-9.]+$|^::1?$/.test(process.env.HOSTERAX_BIND_HOST || "")
  ? process.env.HOSTERAX_BIND_HOST
  : "0.0.0.0";

const tlsManager = new TLSManager(db, EDGEDIR, () => [
  getServerIp(),
  ...Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal)
    .map((i) => i.address),
]);
const edgeManager = new EdgeManager({ db, edgeDir: EDGEDIR, tlsManager, HOME });
const backupManager = new BackupManager({ db, HOME });
const backupScheduler = new BackupScheduler({
  db,
  backups: backupManager,
  // selfHeal is created later in this file; events are only recorded once a run has failed
  recordEvent: (project, type, details, status) =>
    selfHeal?.logEvent?.(project, type, details, status),
});
// What a tunnel may point at: a deployed project's port, or the edge proxy. Never the engine itself.
function resolveTunnelTarget(target) {
  const host = tunnelTargetHost({ bindHost: BIND_HOST });
  let port;
  if (target === "edge") {
    port = Number(edgeManager.getSettings().http_port) || 80;
  } else {
    const p = db.prepare("SELECT port FROM projects WHERE name=?").get(target);
    if (!p) return { missing: true };
    if (!p.port) return { waiting: "the project has not been deployed yet" };
    // a project with a password is exposed through its gate, never around it
    port = gateManager.portFor(target) ?? p.port;
  }
  if (port === PORT || port === dashboard.ssrPort())
    throw new Error(`port ${port} belongs to the HosteraX engine and is never made public`);
  return { host, port };
}
const tunnelManager = new TunnelManager({
  db,
  HOME,
  resolveTarget: resolveTunnelTarget,
  recordEvent: (project, type, details, status) =>
    selfHeal?.logEvent?.(project, type, details, status),
  // opt-in: every deployed project gets a public address on its own
  autoTargets: () =>
    getSetting("tunnels_auto_expose", "0") === "1"
      ? db
          .prepare("SELECT name FROM projects WHERE port IS NOT NULL")
          .all()
          .map((r) => r.name)
      : [],
  autoProvider: () => getSetting("tunnels_auto_provider", "auto"),
});
const drillsInFlight = new Set();
const cronManager = new CronManager({ db, backupManager });
cronManager.startScheduler();
const serverManager = new ServerManager({
  db,
  HOME,
  // an app on a remote server is reached through a local forward, published like any local app
  bindHost: BIND_HOST,
  listForwards: (serverId) =>
    db
      .prepare(
        "SELECT name, port, remote_port FROM projects WHERE server_id=? AND remote_port IS NOT NULL AND port IS NOT NULL",
      )
      .all(serverId)
      .map((r) => ({ id: r.name, remotePort: r.remote_port, localPort: r.port })),
  onForwardMoved: (serverId, project, localPort) => {
    db.prepare("UPDATE projects SET port=? WHERE name=?").run(localPort, project);
    const route = db.prepare("SELECT hostname FROM routes WHERE project=?").get(project);
    applyRoute(project, localPort, route?.hostname ?? null, null);
  },
  onStatusChange: (srv, from, to, detail) =>
    selfHeal?.logEvent?.(
      srv.name,
      "server_status",
      `Server ${srv.name} went from ${from} to ${to}${detail ? `: ${detail}` : ""}`,
      to === "online" ? "info" : "error",
    ),
});
configureDockerScope({ dockerEnv: (serverId) => serverManager.dockerEnv(serverId) });
serverManager.isInUse = (serverId) =>
  db
    .prepare("SELECT COUNT(*) c FROM projects WHERE server_id=? AND deleted_at IS NULL")
    .get(serverId).c;
const SCALE_TO_ZERO_REMOTE =
  "Scale to zero is not available for projects on a remote server (it stops and starts containers on this machine).";
/** The remote server a project is placed on, or null for this machine. */
function serverOf(project) {
  const row = db.prepare("SELECT server_id FROM projects WHERE name=?").get(project);
  return row?.server_id && row.server_id !== "local" ? row.server_id : null;
}
const gateManager = new GateManager({
  db,
  bindHost: BIND_HOST,
  upstream: (project) =>
    db.prepare("SELECT port FROM projects WHERE name=?").get(project)?.port ?? null,
  onPortChange: (project) => {
    const p = db.prepare("SELECT port FROM projects WHERE name=?").get(project);
    if (!p?.port) return;
    const route = db.prepare("SELECT hostname FROM routes WHERE project=?").get(project);
    applyRoute(project, p.port, route?.hostname ?? null, null);
  },
});
const webhookManager = new WebhookManager({ db, runDeployment, applyRoute, HOME });
const orgManager = new OrgManager({ db });
const emailManager = new EmailManager({ db, HOME });
const notifier = new NotificationManager({
  db,
  sendEmail: (m) => emailManager.sendSystemMail(m),
  baseUrl: () => process.env.HOSTERAX_PUBLIC_URL || "",
});
const dockerApi = new DockerApiClient();
const remoteDockerApis = new Map();
/** Docker HTTP client for a project's server: this machine's daemon, or the remote one through its bridge. */
function dockerApiForServer(serverId) {
  if (!serverId || serverId === "local") return dockerApi;
  const socketPath = serverManager.dockerSocket(serverId);
  if (!socketPath) throw new Error(`Server ${serverId} is not connected.`);
  let c = remoteDockerApis.get(serverId);
  if (!c || c.socketPath !== socketPath) {
    c = new DockerApiClient({ socketPath });
    remoteDockerApis.set(serverId, c);
  }
  return c;
}
const gpuManager = new GpuManager(db);
const scaleToZeroManager = new ScaleToZeroManager(db, dockerApi);
scaleToZeroManager.start();
const metricsManager = new MetricsManager({ db, HOME, LOGDIR, dockerApi });

// Periodic Database Maintenance & Memory Trim
setInterval(
  () => {
    try {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      db.prepare("DELETE FROM alert_history WHERE created_at < ?").run(sevenDaysAgo);
      db.prepare("DELETE FROM self_heal_events WHERE created_at < ?").run(sevenDaysAgo);
      db.prepare("DELETE FROM ai_audit_logs WHERE created_at < ?").run(sevenDaysAgo);
      db.pragma("wal_checkpoint(PASSIVE)");
      if (global.gc) global.gc();
    } catch {}
  },
  60 * 60 * 1000,
);

// Initial route synchronization and edge container check
edgeManager.syncRoutes().catch((e) => console.error("[edge] initial sync:", e.message));

function applyRoute(project, appPort, hostname, id) {
  const now = Date.now();
  // The edge talks to the gate when the project has a password; the gate talks to the app.
  const port = appPort ? (gateManager.portFor(project) ?? appPort) : appPort;
  const upsert = (status, detail, configPath) =>
    db
      .prepare(
        `INSERT INTO routes (project, hostname, upstream_port, status, detail, config_path, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project) DO UPDATE SET hostname=excluded.hostname, upstream_port=excluded.upstream_port,
        status=excluded.status, detail=excluded.detail, config_path=excluded.config_path, updated_at=excluded.updated_at`,
      )
      .run(
        project,
        hostname ?? null,
        port ?? null,
        status,
        detail ?? null,
        configPath ?? null,
        now,
      );

  const primary =
    hostname ??
    db.prepare("SELECT hostname FROM domains WHERE project=? AND is_primary=1").get(project)
      ?.hostname ??
    null;
  if (!port) {
    upsert(
      "action_required",
      "No port detected — set port in hosterax.json or project settings",
      null,
    );
    if (id)
      publish(id, {
        ts: now,
        stream: "system",
        text: "[edge] action required: unknown upstream port (app is still running)",
      });
    return { status: "action_required" };
  }
  const defaultHost = getMagicDnsHost(project);
  const host = primary ?? defaultHost;

  try {
    edgeManager.syncRoutes().catch(() => {});
    const confPath = path.join(EDGEDIR, `${project}.conf`);
    upsert(
      primary ? "active" : "pending_dns",
      primary ? null : "Add a primary domain to serve this app publicly",
      confPath,
    );
    if (id)
      publish(id, {
        ts: now,
        stream: "system",
        text: `[edge] ${edgeManager.getSettings().provider.toUpperCase()} edge route synced (${host} → :${port})`,
      });
    return { status: primary ? "active" : "pending_dns", config_path: confPath };
  } catch (e) {
    upsert("action_required", String(e), null);
    if (id) publish(id, { ts: now, stream: "system", text: `[edge] action required: ${e}` });
    return { status: "action_required" };
  }
}

// ---------- deploy engine ----------
function nextVersion(project) {
  const n = db.prepare("SELECT COUNT(*) c FROM deployments WHERE project=?").get(project).c;
  return `v0.${n + 1}.0`;
}

function sanitizeImageTag(tag) {
  // Image references never start with "-" (would be parsed as a docker flag).
  return tag.replace(/[^a-zA-Z0-9._/:@-]/g, "").replace(/^-+/, "");
}

function shellFor(cmd) {
  return process.platform === "win32"
    ? { shell: "cmd.exe", args: ["/c", cmd] }
    : { shell: "sh", args: ["-c", cmd] };
}

function runStep(deploymentId, cwd, cmd, env) {
  return new Promise((resolve) => {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: `$ ${cmd}` });
    const { shell, args } = shellFor(cmd);
    const child = spawn(shell, args, { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (b) =>
      publish(deploymentId, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }),
    );
    child.stderr.on("data", (b) =>
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }),
    );
    child.on("close", (code) => {
      publish(deploymentId, { ts: Date.now(), stream: "system", text: `exit ${code}` });
      resolve(code ?? 0);
    });
    child.on("error", (e) => {
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: String(e) });
      resolve(1);
    });
  });
}

/** Runs `bin args...` WITHOUT a shell, so no argument can be interpreted as shell syntax. */
/**
 * `opts.capture`, if given, is an array that receives the tail of what the command printed (stdout and
 * stderr, bounded), so a caller can tell why it failed instead of only that it did.
 */
function runStepArgv(deploymentId, cwd, bin, args, env = {}, opts = {}) {
  const keep = (b) => {
    if (!opts.capture) return;
    opts.capture.push(b.toString());
    while (opts.capture.join("").length > 8192) opts.capture.shift();
  };
  return new Promise((resolve) => {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `$ ${displayArgv(bin, args)}`,
    });
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (b) => {
      keep(b);
      publish(deploymentId, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() });
    });
    child.stderr.on("data", (b) => {
      keep(b);
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() });
    });
    child.on("close", (code) => {
      publish(deploymentId, { ts: Date.now(), stream: "system", text: `exit ${code}` });
      resolve(code ?? 0);
    });
    child.on("error", (e) => {
      keep(String(e));
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: String(e) });
      resolve(1);
    });
  });
}

// Only network git remotes are cloned. Anything else (local paths, "ext::" transports, strings that
// start with "-") is never handed to `git`, which would otherwise parse it as an option.
const GIT_URL_RE = /^(https?:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[A-Za-z0-9._-]+:[^\s]+)$/;
function isGitSource(source) {
  return typeof source === "string" && !source.startsWith("-") && GIT_URL_RE.test(source);
}

function runGitClone(deploymentId, cwd, url, targetDir, branch = "") {
  return new Promise((resolve) => {
    const args = ["clone", "--depth", "1"];
    if (branch && /^[A-Za-z0-9._\-/]{1,200}$/.test(branch) && !branch.startsWith("-"))
      args.push("--branch", branch);
    args.push("--", url, targetDir);
    publish(deploymentId, { ts: Date.now(), stream: "system", text: `$ git ${args.join(" ")}` });
    const child = spawn("git", args, {
      cwd,
      // never block on a credentials prompt; forbid the command-executing "ext" transport
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "http:https:ssh:git" },
    });
    child.stdout.on("data", (b) =>
      publish(deploymentId, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }),
    );
    child.stderr.on("data", (b) =>
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }),
    );
    child.on("close", (code) => {
      publish(deploymentId, { ts: Date.now(), stream: "system", text: `exit ${code ?? 0}` });
      resolve(code ?? 0);
    });
    child.on("error", (e) => {
      publish(deploymentId, { ts: Date.now(), stream: "stderr", text: String(e) });
      resolve(1);
    });
  });
}

async function fetchSource(deploymentId, source, workdir, target, branch = "") {
  fs.mkdirSync(workdir, { recursive: true });
  if (target === "docker" && source && !fs.existsSync(source) && !isGitSource(source)) {
    // Direct Docker image deployment (One-Click App as project)
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[docker] Container image target: ${source}`,
    });
    return 0;
  }
  if (isGitSource(source)) {
    return runGitClone(deploymentId, path.dirname(workdir), source, path.basename(workdir), branch);
  }
  const abs = path.resolve(String(source || ""));
  if (!source || !fs.existsSync(abs)) {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "stderr",
      text: `source not found: ${source ? abs : "(empty)"} — expected a git URL (https/ssh) or a folder on the engine host`,
    });
    return 1;
  }
  publish(deploymentId, { ts: Date.now(), stream: "system", text: `copy ${abs} → ${workdir}` });
  try {
    await fs.promises.cp(abs, workdir, { recursive: true, force: true });
    return 0;
  } catch (e) {
    publish(deploymentId, { ts: Date.now(), stream: "stderr", text: String(e) });
    return 1;
  }
}

function generateZeroConfigDockerfile(workdir) {
  return generateUniversalDockerfile(workdir);
}

// ---------- readiness health probe ----------
/**
 * Poll a container's HTTP endpoint until healthy or timeout.
 * Correctly waits for the web server inside the container to listen without
 * getting fooled by Docker host proxy TCP listeners.
 * @returns {{ healthy: boolean, attempts: number, latencyMs: number|null }}
 */
async function waitForHealthy(deploymentId, containerPort, opts = {}) {
  const { healthPath = "/", maxAttempts = 45, intervalMs = 2000, timeoutMs = 3000 } = opts;
  const isHttp = healthPath && healthPath !== "none";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    if (isHttp) {
      try {
        const result = await new Promise((resolve, reject) => {
          const req = http.get(
            {
              hostname: "127.0.0.1",
              port: containerPort,
              path: healthPath.startsWith("/") ? healthPath : `/${healthPath}`,
              timeout: timeoutMs,
            },
            (res) => {
              // Drain response body
              res.resume();
              resolve({ status: res.statusCode, latencyMs: Date.now() - start });
            },
          );
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error("timeout"));
          });
        });

        // Any HTTP response (2xx, 3xx, 4xx) confirms the web application is listening and serving requests!
        if (result.status >= 200 && result.status < 500) {
          publish(deploymentId, {
            ts: Date.now(),
            stream: "system",
            text: `[health] ✓ Container ready (HTTP ${result.status}, ${result.latencyMs}ms, attempt ${attempt}/${maxAttempts})`,
          });
          return { healthy: true, attempts: attempt, latencyMs: result.latencyMs };
        }

        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[health] Probe ${attempt}/${maxAttempts}: HTTP ${result.status} (server initializing...)`,
        });
      } catch (err) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[health] Probe ${attempt}/${maxAttempts}: waiting for HTTP service on port ${containerPort}...`,
        });
      }
    } else {
      // Raw TCP service fallback (e.g. databases, workers, queues)
      try {
        await new Promise((resolve, reject) => {
          const sock = new net.Socket();
          sock.setTimeout(timeoutMs);
          sock.connect(containerPort, "127.0.0.1", () => {
            sock.destroy();
            resolve(true);
          });
          sock.on("error", reject);
          sock.on("timeout", () => {
            sock.destroy();
            reject(new Error("tcp timeout"));
          });
        });
        const latencyMs = Date.now() - start;
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[health] ✓ Container ready (TCP port open, ${latencyMs}ms, attempt ${attempt}/${maxAttempts})`,
        });
        return { healthy: true, attempts: attempt, latencyMs };
      } catch {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[health] Probe ${attempt}/${maxAttempts}: waiting for TCP port ${containerPort}...`,
        });
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  publish(deploymentId, {
    ts: Date.now(),
    stream: "stderr",
    text: `[health] ✗ Container failed readiness health check after ${maxAttempts} attempts (${Math.round((maxAttempts * intervalMs) / 1000)}s)`,
  });
  return { healthy: false, attempts: maxAttempts, latencyMs: null };
}

// ---------- pre-deploy migration hooks ----------
/**
 * Auto-detect and run database migrations inside the container before traffic cutover.
 * Returns 0 on success/skip, non-zero on failure.
 */
async function runPreDeployHooks(deploymentId, workdir, env, containerName) {
  const exists = (f) => fs.existsSync(path.join(workdir, f));
  const readDeps = () => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workdir, "package.json"), "utf8"));
      return { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      return {};
    }
  };

  const hooks = [];
  const deps = exists("package.json") ? readDeps() : {};

  // Prisma
  if (exists("prisma/schema.prisma") || deps["prisma"]) {
    hooks.push({ name: "Prisma", cmd: "npx prisma migrate deploy" });
  }
  // Drizzle
  if (deps["drizzle-kit"]) {
    hooks.push({ name: "Drizzle", cmd: "npx drizzle-kit migrate" });
  }
  // TypeORM
  if (deps["typeorm"]) {
    hooks.push({
      name: "TypeORM",
      cmd: "npx typeorm migration:run -d dist/data-source.js 2>/dev/null || npx typeorm migration:run",
    });
  }
  // Sequelize
  if (deps["sequelize-cli"]) {
    hooks.push({ name: "Sequelize", cmd: "npx sequelize-cli db:migrate" });
  }
  // Django
  if (exists("manage.py")) {
    hooks.push({ name: "Django", cmd: "python manage.py migrate --noinput" });
  }
  // Laravel
  if (exists("artisan")) {
    hooks.push({ name: "Laravel", cmd: "php artisan migrate --force" });
  }
  // Rails
  if (exists("Rakefile") && exists("db/migrate")) {
    hooks.push({ name: "Rails", cmd: "bundle exec rails db:migrate" });
  }

  if (hooks.length === 0) return 0;

  for (const hook of hooks) {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[migrate] Running ${hook.name} migrations...`,
    });

    if (containerName) {
      // Run inside Docker container for correct runtime environment
      const rc = await runStepArgv(deploymentId, workdir, "docker", [
        "exec",
        containerName,
        "sh",
        "-c",
        hook.cmd,
      ]);
      if (rc !== 0) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[migrate] ${hook.name} migration failed (exit ${rc})`,
        });
        return rc;
      }
    } else {
      // Run directly for process/local targets
      const rc = await runStep(deploymentId, workdir, hook.cmd, env);
      if (rc !== 0) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[migrate] ${hook.name} migration failed (exit ${rc})`,
        });
        return rc;
      }
    }
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[migrate] ✓ ${hook.name} migrations complete`,
    });
  }
  return 0;
}

// ---------- docker container helpers for blue/green ----------
function stopContainer(name) {
  try {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  } catch {}
}

function renameContainer(from, to) {
  try {
    spawnSync("docker", ["rename", from, to], { stdio: "ignore" });
  } catch {}
}

const staticServers = new Map(); // project -> http.Server

function stopProject(project, reason = "manual stop") {
  return runOnServer(serverOf(project), () => stopProjectHere(project, reason));
}

function stopProjectHere(project, reason) {
  const cleanName = project.toLowerCase().replace(/[^a-z0-9]/g, "_");
  try {
    const child = spawn("docker", ["rm", "-f", `hx_${cleanName}`]);
    child.on("error", () => {});
  } catch (err) {
    // A server that cannot be reached cannot have its container removed; say so rather than pretend.
    if (currentServerId())
      selfHeal?.logEvent?.(project, "remote_stop_failed", String(err.message), "error");
  }
  const srv = staticServers.get(project);
  if (srv) {
    try {
      srv.close();
    } catch {}
    staticServers.delete(project);
  }
  const rec = running.get(project);
  if (!rec) return false;
  rec.stopped = true;
  if (rec.server) {
    try {
      rec.server.close();
    } catch {}
  }
  if (rec.child?.pid && rec.child.pid !== process.pid) {
    try {
      process.kill(rec.child.pid);
    } catch {}
  }
  publishRuntime(project, { ts: Date.now(), stream: "system", text: `stopped (${reason})` });
  running.delete(project);
  return true;
}

function startStaticServer(project, rootDir, port, deploymentId) {
  stopProject(project, "new deploy");
  const MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".txt": "text/plain",
  };

  const MAGIC_DNS_SUFFIXES_INNER = [
    ".sslip.io",
    ".nip.io",
    ".traefik.me",
    ".ipq.co",
    ".fdns.uk",
    ".localhost",
  ];

  const srv = http.createServer((req, res) => {
    const rawHost = (req.headers.host || "").toLowerCase();
    const reqHostname = rawHost.split(":")[0];
    const sub = reqHostname.split(".")[0];

    // If host specifies another project and is not this project, proxy to the other project's upstream port!
    if (
      MAGIC_DNS_SUFFIXES_INNER.some((s) => reqHostname.includes(s)) &&
      sub &&
      sub.toLowerCase() !== project.toLowerCase()
    ) {
      const otherRoute = db
        .prepare(
          "SELECT * FROM routes WHERE LOWER(project)=LOWER(?) OR LOWER(hostname) LIKE LOWER(?)",
        )
        .get(sub, `%${sub}%`);
      const otherProj = db
        .prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)")
        .get(sub, sub);
      const otherPort = otherRoute?.upstream_port || otherProj?.port;
      if (otherPort && Number(otherPort) !== Number(port)) {
        const proxyReq = http.request(
          {
            host: "127.0.0.1",
            port: otherPort,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on("error", () => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Bad Gateway: App '${sub}' on port ${otherPort} is not reachable`,
            }),
          );
        });
        req.pipe(proxyReq);
        return;
      }
    }

    let reqPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let filePath = path.join(rootDir, reqPath);

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch {}

    // SPA fallback: return index.html for client-side routing
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(rootDir, "index.html");
      }
    } catch {}

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("404 Not Found");
    }

    try {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      const stream = fs.createReadStream(filePath);
      res.writeHead(200, {
        "content-type": mime,
        "access-control-allow-origin": "*",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000",
      });
      stream.pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });

  srv.listen(port, "0.0.0.0", () => {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[static-server] Serving ${path.basename(rootDir)} at http://127.0.0.1:${port}`,
    });
    publishRuntime(project, {
      ts: Date.now(),
      stream: "system",
      text: `[static-server] Serving ${path.basename(rootDir)} at http://127.0.0.1:${port}`,
    });
  });

  srv.on("error", (err) => {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "stderr",
      text: `[static-server] Error on port ${port}: ${err.message}`,
    });
  });

  staticServers.set(project, srv);
  running.set(project, {
    child: { pid: process.pid },
    server: srv,
    stopped: false,
    startedAt: Date.now(),
    cmd: `static-server ${rootDir} :${port}`,
    workdir: rootDir,
    env: {},
    policy: "always",
  });
}

function superviseProcess(project, workdir, cmd, env, policy, deploymentId) {
  const { shell, args } = shellFor(cmd);
  const child = spawn(shell, args, {
    cwd: workdir,
    env: { ...process.env, ...env },
    detached: true,
  });
  const prev = running.get(project);
  const rec = {
    child,
    restarts: prev?.restarts ?? 0,
    stopped: false,
    startedAt: Date.now(),
    cmd,
    workdir,
    env,
    policy,
  };
  running.set(project, rec);
  child.stdout.on("data", (b) =>
    publishRuntime(project, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }),
  );
  child.stderr.on("data", (b) =>
    publishRuntime(project, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }),
  );
  child.on("close", (code) => {
    publishRuntime(project, { ts: Date.now(), stream: "system", text: `process exited ${code}` });
    if (deploymentId)
      publish(deploymentId, { ts: Date.now(), stream: "system", text: `service exited ${code}` });
    const cur = running.get(project);
    if (!cur || cur.child !== child || cur.stopped) return;
    const shouldRestart = policy === "always" || (policy === "on-failure" && code !== 0);
    if (!shouldRestart) {
      running.delete(project);
      return;
    }
    if (cur.restarts >= 5) {
      publishRuntime(project, {
        ts: Date.now(),
        stream: "system",
        text: "restart limit reached (5) — giving up",
      });
      running.delete(project);
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** cur.restarts);
    cur.restarts += 1;
    publishRuntime(project, {
      ts: Date.now(),
      stream: "system",
      text: `restarting in ${delay}ms (attempt ${cur.restarts}/5)`,
    });
    setTimeout(() => {
      if (running.get(project) === cur && !cur.stopped)
        superviseProcess(project, workdir, cmd, env, policy, null);
    }, delay);
  });
  return rec;
}

function inspectDockerImage(tag) {
  try {
    const res = spawnSync("docker", ["image", "inspect", tag], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (res.stdout) {
      const raw = JSON.parse(res.stdout.trim());
      const data = Array.isArray(raw) ? raw[0] : raw;
      const cfg = data?.Config || {};
      const exposedPorts = [];
      if (cfg.ExposedPorts) {
        for (const p of Object.keys(cfg.ExposedPorts)) {
          const m = p.match(/^(\d+)/);
          if (m) exposedPorts.push(parseInt(m[1], 10));
        }
      }
      const volumes = [];
      if (cfg.Volumes) {
        for (const v of Object.keys(cfg.Volumes)) {
          volumes.push(v);
        }
      }
      return {
        exposedPorts,
        volumes,
        env: cfg.Env || [],
        entrypoint: cfg.Entrypoint || [],
        cmd: cfg.Cmd || [],
      };
    }
  } catch (err) {
    console.warn("inspectDockerImage warning:", err);
  }
  return { exposedPorts: [], volumes: [], env: [], entrypoint: [], cmd: [] };
}

function pickPrimaryHttpPort(exposedPorts) {
  if (!exposedPorts || exposedPorts.length === 0) return 3000;
  const priority = [
    80, 8080, 3000, 5000, 8000, 5678, 8090, 8055, 8096, 2368, 2283, 9000, 8108, 6333,
  ];
  for (const p of priority) {
    if (exposedPorts.includes(p)) return p;
  }
  return exposedPorts[0];
}

async function startService(deploymentId, project, workdir, cmd, env, target, port) {
  stopProject(project, "superseded by new deploy");
  const remoteServerId = currentServerId();
  if (remoteServerId) {
    // Projects on another server run as a single Docker container; nothing else is placed there.
    if (target !== "docker") {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[server] ❌ Only Docker projects can run on a remote server (this project's target is "${target}").`,
      });
      return 1;
    }
    try {
      await serverManager.ensureReady(remoteServerId);
    } catch (err) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[server] ❌ ${err.message}`,
      });
      return 1;
    }
  }
  if (!remoteServerId && (target === "docker" || target === "compose")) {
    const isDaemonUp = selfHeal ? await selfHeal.probeDockerDaemon() : true;
    if (!isDaemonUp) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[docker] ❌ Docker Daemon Offline: Cannot deploy "${project}". Docker Desktop is not running on this host.\n[docker] 💡 Action Required: Please launch Docker Desktop from your Start menu or start the Docker service, then retry deployment.`,
      });
      return 1;
    }
  }
  if (target === "compose") {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: "docker compose up -d" });
    return runStep(deploymentId, workdir, "docker compose up -d --build", env);
  }
  if (target === "docker") {
    const cleanName = project.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const projRow = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
    const isDirectImage =
      projRow?.source && !fs.existsSync(projRow.source) && !isGitSource(projRow.source);

    let tag = isDirectImage ? projRow.source : `hosterax/${cleanName}:latest`;

    // A bare name ("nginx", "uptime-kuma") becomes its usual image; a tag the user chose is kept as given.
    if (isDirectImage) tag = normalizeImageSource(tag, project);

    let imageInspect = { exposedPorts: [], volumes: [], env: [] };

    if (isDirectImage) {
      const pullRes = await pullWithUniversalHealing({
        deploymentId,
        workdir,
        initialTag: tag,
        projectName: project,
        publish,
        runStep,
        runArgv: runStepArgv,
      });

      if (!pullRes.ok) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[docker] ERROR: Aborting deployment. No valid container image could be resolved for "${project}".`,
        });
        return 1;
      }

      tag = pullRes.tag;
      imageInspect = inspectDockerImage(tag);
      if (imageInspect.exposedPorts.length > 0) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[docker] Discovered exposed port(s): ${imageInspect.exposedPorts.join(", ")}`,
        });
      }
      if (imageInspect.volumes.length > 0) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[docker] Discovered persistent volume(s): ${imageInspect.volumes.join(", ")}`,
        });
      }
    } else {
      // Ensure a Dockerfile exists; if missing or release-only, generate a zero-config multi-stage Dockerfile
      const dockerfilePath = path.join(workdir, "Dockerfile");
      let isZeroConfigGenerated = false;

      // Inspect if existing Dockerfile is a release-only Dockerfile (e.g. GoReleaser COPY binary) missing the binary on disk
      if (fs.existsSync(dockerfilePath)) {
        try {
          const dfContent = fs.readFileSync(dockerfilePath, "utf8");
          const copyMatches = [...dfContent.matchAll(/^\s*COPY\s+([^\s]+)\s+/gm)];
          const missingCopy = copyMatches.some(([_, src]) => {
            const trimmed = src.trim();
            if (trimmed.startsWith("--from=")) return false;
            return !fs.existsSync(path.join(workdir, trimmed));
          });
          if (
            missingCopy &&
            (fs.existsSync(path.join(workdir, "go.mod")) ||
              fs.existsSync(path.join(workdir, "Cargo.toml")) ||
              fs.existsSync(path.join(workdir, "package.json")) ||
              fs.existsSync(path.join(workdir, "requirements.txt")))
          ) {
            publish(deploymentId, {
              ts: Date.now(),
              stream: "system",
              text: "[self-heal] Detected release distribution Dockerfile with missing pre-compiled binary. Generating resilient multi-stage build...",
            });
            const backupPath = path.join(workdir, "Dockerfile.original");
            if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, dfContent, "utf8");
            fs.writeFileSync(dockerfilePath, generateZeroConfigDockerfile(workdir), "utf8");
            isZeroConfigGenerated = true;
          }
        } catch {}
      }

      if (!fs.existsSync(dockerfilePath)) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[docker] No Dockerfile found; generating zero-config Dockerfile for ${project}`,
        });
        const generatedDockerfile = generateZeroConfigDockerfile(workdir);
        fs.writeFileSync(dockerfilePath, generatedDockerfile, "utf8");
        isZeroConfigGenerated = true;
      }

      publish(deploymentId, { ts: Date.now(), stream: "system", text: `docker build → ${tag}` });
      let bc = await runStepArgv(
        deploymentId,
        workdir,
        "docker",
        ["build", "-t", sanitizeImageTag(tag), "."],
        {
          ...env,
          DOCKER_BUILDKIT: "1",
        },
      );

      // Self-Healing Build Fallback: If original Dockerfile build failed, fallback to zero-config multi-stage build!
      if (bc !== 0 && !isZeroConfigGenerated) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: "[self-heal] Docker build failed with repository Dockerfile. Automatically generating zero-config multi-stage Dockerfile and retrying...",
        });
        const generatedDockerfile = generateZeroConfigDockerfile(workdir);
        fs.writeFileSync(dockerfilePath, generatedDockerfile, "utf8");
        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `docker build (self-healing retry) → ${tag}`,
        });
        bc = await runStepArgv(
          deploymentId,
          workdir,
          "docker",
          ["build", "-t", sanitizeImageTag(tag), "."],
          {
            ...env,
            DOCKER_BUILDKIT: "1",
          },
        );
      }

      if (bc !== 0) return bc;
      imageInspect = inspectDockerImage(tag);
    }

    // ── Blue/Green Zero-Downtime Deployment ──
    // 1. Launch NEW container as hx_{name}_green (old hx_{name} keeps serving)
    // 2. Run pre-deploy migration hooks inside green container
    // 3. Health probe green container
    // 4. If healthy → swap: remove old, rename green → hx_{name}
    // 5. If unhealthy → destroy green, keep old live, fail deployment

    const greenName = `hx_${cleanName}_green`;
    // Clean up any stale green container from a previous failed deploy
    stopContainer(greenName);

    // Auto-discover container internal port using smart HTTP port prioritization
    let containerInternalPort = 3000;
    if (imageInspect.exposedPorts && imageInspect.exposedPorts.length > 0) {
      containerInternalPort = pickPrimaryHttpPort(imageInspect.exposedPorts);
    } else if (port && port !== 3000) {
      containerInternalPort = port;
    } else if (projRow?.port && projRow.port !== 3000) {
      containerInternalPort = projRow.port;
    }

    // Allocate verified free host port. For a remote project this is the port on THIS machine that
    // reaches it (an SSH forward); the container itself publishes on the server's loopback only.
    const hostPort = await allocateFreeProjectPort(project, containerInternalPort);
    try {
      db.prepare("UPDATE projects SET port=? WHERE name=?").run(hostPort, project);
    } catch {}
    let remotePort = null;
    const allocateRemote = async (seed) => {
      const taken = db
        .prepare(
          "SELECT remote_port FROM projects WHERE server_id=? AND name != ? AND remote_port IS NOT NULL",
        )
        .all(remoteServerId, project)
        .map((r) => r.remote_port);
      return serverManager.allocateRemotePort(remoteServerId, { seed, taken });
    };
    if (remoteServerId) {
      try {
        remotePort = await allocateRemote(project);
      } catch (err) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[server] ❌ Could not choose a port on the server: ${err.message}`,
        });
        return 1;
      }
      publish(deploymentId, {
        ts: Date.now(),
        stream: "system",
        text: `[server] container will publish on the server's loopback :${remotePort}, forwarded to :${hostPort} here`,
      });
    }

    // Persistent volume mappings (use reliable Docker Named Volumes for cross-platform stability)
    const volArgs = [];
    if (imageInspect.volumes && imageInspect.volumes.length > 0) {
      for (const v of imageInspect.volumes) {
        // Volume paths come from (untrusted) image metadata: accept absolute POSIX paths only.
        if (!/^\/[A-Za-z0-9_./-]*$/.test(v) || v.includes("..")) continue;
        const safeVolKey = v.replace(/[^a-zA-Z0-9_-]/g, "_");
        volArgs.push("-v", `hx_vol_${cleanName}_${safeVolKey}:${v}`);
      }
    }

    const dockerEnv = {
      HOST: "0.0.0.0",
      HOSTERAX_ENVIRONMENT: "production",
      HOSTERAX_RESTART_POLICY: "on-failure",
      ...env,
      PORT: String(containerInternalPort),
    };

    if (tag.includes("ghost")) {
      if (!dockerEnv.url && !dockerEnv.URL) {
        dockerEnv.url = `http://${cleanName}.127-0-0-1.sslip.io:${hostPort}`;
      }
      if (!dockerEnv.database__client && !dockerEnv.DATABASE__CLIENT) {
        dockerEnv.database__client = "sqlite3";
        dockerEnv.database__connection__filename = "/var/lib/ghost/content/data/ghost.db";
      }
    }

    if (tag.includes("elasticsearch")) {
      if (!dockerEnv["discovery.type"]) {
        dockerEnv["discovery.type"] = "single-node";
      }
      if (!dockerEnv["xpack.security.enabled"]) {
        dockerEnv["xpack.security.enabled"] = "false";
      }
      if (!dockerEnv["ES_JAVA_OPTS"]) {
        dockerEnv["ES_JAVA_OPTS"] = "-Xms512m -Xmx512m";
      }
    }

    let glanceConfigFile = null;
    if (tag.includes("glance")) {
      const glanceConfigDir = path.join(HOME, "configs", cleanName);
      fs.mkdirSync(glanceConfigDir, { recursive: true });
      glanceConfigFile = path.join(glanceConfigDir, "glance.yml");
      if (!fs.existsSync(glanceConfigFile)) {
        const defaultGlanceYaml = `theme:
  background-color: 240 21 15
  contrast-multiplier: 1.2
  primary-color: 217 91 60

pages:
  - name: Home
    columns:
      - size: small
        widgets:
          - type: calendar
            first-day-of-week: monday
          - type: clock
            hour-format: 24h
            timezones:
              - timezone: UTC
                label: UTC
      - size: full
        widgets:
          - type: search
            autofocus: true
          - type: rss
            title: Hacker News
            limit: 8
            url: https://news.ycombinator.com/rss
`;
        fs.writeFileSync(glanceConfigFile, defaultGlanceYaml, "utf8");
      }
      volArgs.push("-v", `hx_config_${cleanName}:/app/config`);
    }

    const envArgs = [];
    for (const [k, v] of Object.entries(dockerEnv)) {
      if (!isValidEnvKey(k)) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[env] Skipping invalid variable name ${JSON.stringify(k)}`,
        });
        continue;
      }
      const cleanVal = String(v ?? "").replace(/^"(.*)"$/, "$1");
      envArgs.push("-e", `${k}=${cleanVal}`);
    }

    // Custom startup command overrides for images requiring arguments
    let extraArgs = [];
    if (cmd && cmd.trim() && !cmd.startsWith("serve-static:")) {
      extraArgs = splitArgs(cmd.trim());
    } else if (tag.includes("minio")) {
      extraArgs = ["server", "/data", "--console-address", ":9001"];
    } else if (tag.includes("airflow")) {
      extraArgs = ["standalone"];
    }

    const portArgs = remoteServerId
      ? ["-p", `127.0.0.1:${remotePort}:${containerInternalPort}`]
      : [
          "-p",
          // a gated app is only reachable through its gate, so keep its own port off the network
          `${gateManager.isEnabled(project) ? "127.0.0.1" : BIND_HOST}:${hostPort}:${containerInternalPort}`,
        ];
    // Extra ports (admin consoles, …) stay on the loopback of whichever machine runs the container.
    const secondaryPort = async (key, containerPort) =>
      remoteServerId ? allocateRemote(key) : allocateFreeProjectPort(key, containerPort);
    if (imageInspect.exposedPorts && imageInspect.exposedPorts.length > 1) {
      for (const p of imageInspect.exposedPorts) {
        if (p !== containerInternalPort) {
          const secondaryHostPort = await secondaryPort(`${project}_p${p}`, p);
          portArgs.push("-p", `127.0.0.1:${secondaryHostPort}:${p}`);
        }
      }
    } else if (tag.includes("minio")) {
      const consoleHostPort = await secondaryPort(`${project}_console`, 9001);
      portArgs.push("-p", `127.0.0.1:${consoleHostPort}:9001`);
    }

    // Resource limits (memory and CPU capping)
    const resourceLimits = db
      .prepare("SELECT memory_mb_limit, cpu_limit FROM projects WHERE name=?")
      .get(project);
    const resArgs = [];
    const memLimit = Number(resourceLimits?.memory_mb_limit);
    const cpuLimit = Number(resourceLimits?.cpu_limit);
    if (Number.isFinite(memLimit) && memLimit > 0) {
      resArgs.push(
        "--memory",
        `${Math.floor(memLimit)}m`,
        "--memory-swap",
        `${Math.floor(memLimit * 2)}m`,
      );
    }
    if (Number.isFinite(cpuLimit) && cpuLimit > 0) {
      resArgs.push("--cpus", String(cpuLimit));
    }

    // Step 1: Launch green container (old container still serves traffic)
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[blue/green] Launching candidate container ${greenName}...`,
    });
    const runArgs = [
      "run",
      "-d",
      "--init",
      "--name",
      greenName,
      "--restart",
      "unless-stopped",
      "--add-host",
      "host.docker.internal:host-gateway",
      ...portArgs,
      ...volArgs,
      ...resArgs,
      ...envArgs,
      assertSafeImageRef(sanitizeImageTag(tag)),
      ...extraArgs,
    ];
    const runCmd = displayArgv("docker", runArgs); // env values are masked
    const rc = await runStepArgv(deploymentId, workdir, "docker", runArgs);
    if (rc !== 0) {
      stopContainer(greenName);
      return rc;
    }

    // Glance config injection (before health check)
    if (glanceConfigFile && fs.existsSync(glanceConfigFile)) {
      try {
        await runStepArgv(deploymentId, workdir, "docker", [
          "cp",
          glanceConfigFile,
          `${greenName}:/app/config/glance.yml`,
        ]);
        await runStepArgv(deploymentId, workdir, "docker", ["restart", greenName]);
      } catch {}
    }

    // Step 2: Run pre-deploy migration hooks inside the green container
    const projSettings = db.prepare("SELECT health_path FROM projects WHERE name=?").get(project);
    const healthPath = projSettings?.health_path || "/";

    setPhase(deploymentId, "migrating");
    const migrationRc = await runPreDeployHooks(deploymentId, workdir, env, greenName);
    if (migrationRc !== 0) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[blue/green] Migration failed — destroying candidate, keeping old container live.`,
      });
      stopContainer(greenName);
      return migrationRc;
    }

    // A remote container is only reachable through the forward, so open it before probing.
    let reachPort = hostPort;
    if (remoteServerId) {
      try {
        const bound = await serverManager.forward(remoteServerId, {
          id: project,
          remotePort,
          localPort: hostPort,
        });
        if (bound !== hostPort) {
          db.prepare("UPDATE projects SET port=? WHERE name=?").run(bound, project);
          reachPort = bound;
        }
        db.prepare("UPDATE projects SET remote_port=? WHERE name=?").run(remotePort, project);
      } catch (err) {
        publish(deploymentId, {
          ts: Date.now(),
          stream: "stderr",
          text: `[server] ❌ Could not open the connection to the app on the server: ${err.message}`,
        });
        stopContainer(greenName);
        return 1;
      }
    }

    // Step 3: Readiness health probe on the green container
    setPhase(deploymentId, "health_check");
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[health] Starting readiness probe on port ${reachPort} (path: ${healthPath})...`,
    });
    const health = await waitForHealthy(deploymentId, reachPort, { healthPath });

    if (!health.healthy) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[blue/green] ✗ Candidate failed health check — destroying candidate, old container remains live.`,
      });
      stopContainer(greenName);
      return 1;
    }

    // Step 4: Atomic traffic cutover — remove old, rename green → production
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[blue/green] ✓ Candidate healthy — swapping traffic...`,
    });
    const oldName = `hx_${cleanName}`;
    stopContainer(oldName);
    renameContainer(greenName, oldName);
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[blue/green] ✓ Zero-downtime cutover complete (${oldName})`,
    });
    setPhase(deploymentId, "ready", { finished_at: Date.now(), exit_code: 0 });

    running.set(project, {
      child: { pid: process.pid },
      stopped: false,
      startedAt: Date.now(),
      cmd: runCmd,
      workdir,
      env,
      policy: "always",
    });
    return 0;
  }

  // Static SPA server mode
  if (cmd?.startsWith("serve-static:")) {
    const rel = cmd.slice("serve-static:".length);
    const staticDir = path.resolve(workdir, rel);
    startStaticServer(project, staticDir, port || 3000, deploymentId);
    return 0;
  }

  if (!cmd) {
    const possibleDirs = ["build", "dist", "out", "public", "."];
    const foundDir = possibleDirs.find(
      (d) =>
        fs.existsSync(path.join(workdir, d, "index.html")) &&
        fs.statSync(path.join(workdir, d)).isDirectory(),
    );
    if (foundDir) {
      const staticDir = path.resolve(workdir, foundDir);
      startStaticServer(project, staticDir, port || 3000, deploymentId);
      return 0;
    }
    publish(deploymentId, { ts: Date.now(), stream: "system", text: "no start command; skipping" });
    return 0;
  }
  if (!cmd.startsWith("serve-static:")) {
    setPhase(deploymentId, "migrating");
    const migrationRc = await runPreDeployHooks(deploymentId, workdir, env, null);
    if (migrationRc !== 0) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "stderr",
        text: `[migrate] Pre-deploy migration failed (exit ${migrationRc})`,
      });
      return migrationRc;
    }
  }

  setPhase(deploymentId, "deploying");
  publish(deploymentId, {
    ts: Date.now(),
    stream: "system",
    text: `starting (restart=${env.HOSTERAX_RESTART_POLICY || "on-failure"}): ${cmd}`,
  });
  superviseProcess(
    project,
    workdir,
    cmd,
    env,
    env.HOSTERAX_RESTART_POLICY || "on-failure",
    deploymentId,
  );

  if (port && !cmd.startsWith("serve-static:")) {
    const projSettings = db.prepare("SELECT health_path FROM projects WHERE name=?").get(project);
    const healthPath = projSettings?.health_path || "/";
    setPhase(deploymentId, "health_check");
    await waitForHealthy(deploymentId, port, { healthPath, maxAttempts: 25 });
  }

  return 0;
}

const ALLOWED_PHASE_COLUMNS = new Set([
  "phase",
  "finished_at",
  "exit_code",
  "stack",
  "snapshot_json",
  "route_status",
  "workdir",
  "environment",
  "trigger",
  "version",
]);
const notifiedDeployments = new Set();
/** Tell the notification channels how a deployment ended (once per deployment). */
function notifyDeployOutcome(id, phase) {
  if (!["failed", "ready"].includes(phase) || notifiedDeployments.has(id)) return;
  const d = db.prepare("SELECT project, version, trigger FROM deployments WHERE id=?").get(id);
  if (!d) return;
  notifiedDeployments.add(id);
  if (notifiedDeployments.size > 500)
    notifiedDeployments.delete(notifiedDeployments.values().next().value);
  const failed = phase === "failed";
  const tail = failed
    ? readDeploymentLog(id, 40)
        .split("\n")
        .filter((l) => /error|✗|❌|failed|cannot|denied/i.test(l))
        .slice(-3)
        .join("\n")
    : "";
  notifier.notify(failed ? "deploy.failed" : "deploy.succeeded", {
    title: `Deploy of ${d.project} ${failed ? "failed" : "finished"} (${d.version})`,
    text: failed ? tail || "See the deployment log for details." : `Triggered by ${d.trigger}.`,
    project: d.project,
    severity: failed ? "error" : "info",
  });
}

function setPhase(id, phase, extra = {}) {
  const fields = ["phase = ?"];
  const values = [phase];
  for (const [k, v] of Object.entries(extra)) {
    if (!ALLOWED_PHASE_COLUMNS.has(k)) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  db.prepare(`UPDATE deployments SET ${fields.join(",")} WHERE id=?`).run(...values);
  notifyDeployOutcome(id, phase);
}

/** Options that make runDeployment replay an earlier deployment (workdir + frozen snapshot). */
function rollbackOptions(dep, trigger = "rollback") {
  let snapshot = null;
  try {
    snapshot = dep.snapshot_json ? JSON.parse(dep.snapshot_json) : null;
  } catch {}
  return {
    trigger,
    rollbackFrom: {
      version: dep.version,
      workdir: dep.workdir,
      environment: dep.environment,
      snapshot,
    },
  };
}

async function runDeployment(project, opts = {}) {
  return runOnServer(serverOf(project), () => runDeploymentHere(project, opts));
}

async function runDeploymentHere(project, opts = {}) {
  const p = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
  if (!p) throw new Error("no such project");
  const id = "d_" + crypto.randomBytes(8).toString("hex");
  const version = opts.rollbackFrom?.version ?? nextVersion(project);
  const workdir = opts.rollbackFrom?.workdir ?? path.join(WORK, project, version);
  const environment = opts.environment || opts.rollbackFrom?.environment || "production";
  db.prepare(
    `INSERT INTO deployments (id, project, version, phase, trigger, started_at, finished_at, exit_code, workdir, environment)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    project,
    version,
    "queued",
    opts.trigger || "manual",
    Date.now(),
    null,
    null,
    workdir,
    environment,
  );
  const env = { ...decryptJson(p.env_json) };
  if (p.cpu_limit) env.HOSTERAX_CPU_LIMIT = String(p.cpu_limit);
  if (p.memory_mb_limit) env.HOSTERAX_MEMORY_LIMIT_MB = String(p.memory_mb_limit);
  env.HOSTERAX_ENVIRONMENT = environment;
  env.HOSTERAX_RESTART_POLICY = p.restart_policy || "on-failure";

  (async () => {
    try {
      // rollbacks replay the frozen snapshot so they are byte-for-byte reproducible
      const snap = opts.rollbackFrom?.snapshot ?? null;
      let finalStartCmd = snap?.start_cmd ?? p.start_cmd;
      let finalPort = snap?.port ?? p.port ?? null;
      let stack = snap?.stack ?? null;
      let hostname = snap?.hostname ?? null;
      let target = snap?.target ?? p.target;

      if (!opts.rollbackFrom) {
        setPhase(id, "fetching");
        const code = await fetchSource(id, p.source, workdir, p.target, p.git_branch || "");
        if (code !== 0) {
          setPhase(id, "failed", { finished_at: Date.now(), exit_code: code });
          return;
        }

        const det = detectStack(workdir, p, id);
        finalStartCmd = det.start_cmd || p.start_cmd;
        finalPort = await allocateFreeProjectPort(project, p.port || det.port || 3000);
        try {
          db.prepare("UPDATE projects SET port=? WHERE name=?").run(finalPort, project);
        } catch {}
        stack = det.stack;
        hostname = det.hostname;
        Object.assign(env, det.extraEnv);
        if (finalPort) env.PORT = String(finalPort);

        const compose = syncComposeServices(project, workdir, id);
        if (compose && p.target !== "docker") target = "compose";

        // 1. Dependency installation for all stacks
        if (target !== "docker" && target !== "compose") {
          if (fs.existsSync(path.join(workdir, "package.json"))) {
            setPhase(id, "building");
            publish(id, {
              ts: Date.now(),
              stream: "system",
              text: "installing node dependencies...",
            });
            let ic = 0;
            if (fs.existsSync(path.join(workdir, "pnpm-lock.yaml"))) {
              ic = await runStep(id, workdir, "pnpm install", env);
            } else if (fs.existsSync(path.join(workdir, "yarn.lock"))) {
              ic = await runStep(id, workdir, "yarn install", env);
            } else if (
              fs.existsSync(path.join(workdir, "bun.lockb")) ||
              fs.existsSync(path.join(workdir, "bun.lock"))
            ) {
              ic = await runStep(id, workdir, "bun install", env);
            } else {
              // Use npm install with --include=dev and legacy-peer-deps to install build tools (tailwindcss, typescript, etc.)
              ic = await runStep(
                id,
                workdir,
                "npm install --include=dev --prefer-offline --no-audit --no-fund --legacy-peer-deps",
                { ...env, NODE_ENV: "development" },
              );
              if (ic !== 0) {
                publish(id, {
                  ts: Date.now(),
                  stream: "system",
                  text: "retrying dependency installation with --force...",
                });
                ic = await runStep(
                  id,
                  workdir,
                  "npm install --include=dev --force --no-audit --no-fund",
                  { ...env, NODE_ENV: "development" },
                );
              }
            }

            if (ic !== 0) {
              setPhase(id, "failed", { finished_at: Date.now(), exit_code: ic });
              return;
            }
          } else if (fs.existsSync(path.join(workdir, "requirements.txt"))) {
            setPhase(id, "building");
            publish(id, {
              ts: Date.now(),
              stream: "system",
              text: "installing python dependencies...",
            });
            const ic = await runStep(id, workdir, "pip install -r requirements.txt", env);
            if (ic !== 0) {
              setPhase(id, "failed", { finished_at: Date.now(), exit_code: ic });
              return;
            }
          } else if (fs.existsSync(path.join(workdir, "go.mod"))) {
            setPhase(id, "building");
            publish(id, { ts: Date.now(), stream: "system", text: "downloading go modules..." });
            await runStep(id, workdir, "go mod download", env);
          } else if (fs.existsSync(path.join(workdir, "Gemfile"))) {
            setPhase(id, "building");
            publish(id, { ts: Date.now(), stream: "system", text: "installing gems..." });
            await runStep(id, workdir, "bundle install", env);
          } else if (fs.existsSync(path.join(workdir, "composer.json"))) {
            setPhase(id, "building");
            publish(id, {
              ts: Date.now(),
              stream: "system",
              text: "installing composer dependencies...",
            });
            await runStep(id, workdir, "composer install --no-dev --prefer-dist", env);
          }
        }

        // 2. Build step (for process/local targets)
        let buildCmd = det.build_cmd || p.build_cmd;
        if (target !== "docker" && target !== "compose") {
          if (!buildCmd && fs.existsSync(path.join(workdir, "package.json"))) {
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(workdir, "package.json"), "utf8"));
              if (pkg.scripts?.build) buildCmd = "npm run build";
            } catch {}
          } else if (
            !buildCmd &&
            (fs.existsSync(path.join(workdir, "go.mod")) ||
              fs.existsSync(path.join(workdir, "main.go")))
          ) {
            buildCmd = "go build -o app . || go build -o app ./cmd/... || go build -o app ./...";
          } else if (!buildCmd && fs.existsSync(path.join(workdir, "Cargo.toml"))) {
            buildCmd = "cargo build --release";
          }

          if (buildCmd) {
            setPhase(id, "building");
            const bc = await runStep(id, workdir, buildCmd, env);
            if (bc !== 0) {
              setPhase(id, "failed", { finished_at: Date.now(), exit_code: bc });
              return;
            }
          }
        }

        // 3. Determine start command / serving mode
        if (!finalStartCmd && target !== "docker" && target !== "compose") {
          const possibleDirs = ["build", "dist", "out", "public", "."];
          const foundDir = possibleDirs.find(
            (d) =>
              fs.existsSync(path.join(workdir, d, "index.html")) &&
              fs.statSync(path.join(workdir, d)).isDirectory(),
          );
          if (foundDir) {
            finalStartCmd = `serve-static:${foundDir}`;
          } else if (fs.existsSync(path.join(workdir, "package.json"))) {
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(workdir, "package.json"), "utf8"));
              if (pkg.scripts?.start) finalStartCmd = "npm start";
              else if (pkg.main && fs.existsSync(path.join(workdir, pkg.main)))
                finalStartCmd = `node ${pkg.main}`;
              else if (fs.existsSync(path.join(workdir, "server.js")))
                finalStartCmd = "node server.js";
              else if (fs.existsSync(path.join(workdir, "app.js"))) finalStartCmd = "node app.js";
              else if (fs.existsSync(path.join(workdir, "index.js")))
                finalStartCmd = "node index.js";
            } catch {}
          } else if (
            fs.existsSync(path.join(workdir, "app")) ||
            fs.existsSync(path.join(workdir, "app.exe")) ||
            fs.existsSync(path.join(workdir, "go.mod"))
          ) {
            finalStartCmd = "./app";
          } else if (
            fs.existsSync(path.join(workdir, "target", "release")) ||
            fs.existsSync(path.join(workdir, "Cargo.toml"))
          ) {
            finalStartCmd = "./target/release/app";
          } else if (fs.existsSync(path.join(workdir, "main.py"))) {
            finalStartCmd = "python main.py";
          } else if (fs.existsSync(path.join(workdir, "app.py"))) {
            finalStartCmd = "python app.py";
          }
        }
        setPhase(id, "building", {
          stack,
          snapshot_json: JSON.stringify({
            stack,
            target,
            build_cmd: buildCmd,
            start_cmd: finalStartCmd,
            port: finalPort,
            hostname,
            source: p.source,
            environment,
            env_keys: Object.keys(env).sort(),
            created_at: Date.now(),
          }),
        });
      } else {
        publish(id, {
          ts: Date.now(),
          stream: "system",
          text: `rollback to ${version}${snap ? " (from frozen snapshot)" : ""}`,
        });
        if (snap) {
          setPhase(id, "building", { stack: snap.stack, snapshot_json: JSON.stringify(snap) });
          if (snap.port) env.PORT = String(snap.port);
        }
      }

      setPhase(id, "deploying");
      const serviceRc = await startService(
        id,
        project,
        workdir,
        finalStartCmd,
        env,
        target,
        finalPort,
      );
      if (serviceRc !== 0) {
        publish(id, {
          ts: Date.now(),
          stream: "stderr",
          text: `[deploy] Deployment failed with exit code ${serviceRc}. Aborting ready state.`,
        });
        setPhase(id, "failed", { finished_at: Date.now(), exit_code: serviceRc });
        return;
      }
      const liveProj = db.prepare("SELECT port FROM projects WHERE name=?").get(project);
      if (liveProj?.port) finalPort = liveProj.port;

      // routing/TLS runs AFTER the app is live, so DNS/cert problems never kill a working deploy
      const route = applyRoute(project, finalPort, hostname, id);
      setPhase(id, "ready", { finished_at: Date.now(), exit_code: 0, route_status: route.status });
    } catch (e) {
      publish(id, { ts: Date.now(), stream: "stderr", text: String(e) });
      setPhase(id, "failed", { finished_at: Date.now(), exit_code: 1 });
    }
  })();

  return { id, version, environment };
}

// ---------- live OS metrics ----------
function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  // compute average CPU usage across cores
  let totalIdle = 0,
    totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  let disk = { total_gb: 0, used_gb: 0, percent: 0 };
  try {
    const st = fs.statfsSync(process.platform === "win32" ? "C:\\\\" : "/");
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const used = total - free;
    disk = {
      total_gb: Math.round(total / 1073741824),
      used_gb: Math.round(used / 1073741824),
      percent: parseFloat(((used / total) * 100).toFixed(1)),
    };
  } catch (e) {}

  return {
    cpu: {
      percent: parseFloat(cpuPercent),
      cores: cpus.length,
      model: cpus[0]?.model ?? "unknown",
    },
    memory: {
      used_mb: Math.round(usedMem / 1048576),
      total_mb: Math.round(totalMem / 1048576),
      percent: ((usedMem / totalMem) * 100).toFixed(1),
    },
    disk,
    uptime_seconds: Math.round(os.uptime()),
    platform: os.platform(),
    hostname: os.hostname(),
    load_avg: os.loadavg().map((v) => parseFloat(v.toFixed(2))),
  };
}

async function getContainerMetrics(projectName) {
  return runOnServer(serverOf(projectName), () => getContainerMetricsHere(projectName));
}

async function getContainerMetricsHere(projectName) {
  const cleanName = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return new Promise((resolve) => {
    const cp = spawn("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      `hx_${cleanName}`,
    ]);
    let stdout = "";
    cp.stdout.on("data", (d) => (stdout += d.toString()));
    cp.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        return resolve(null);
      }
      try {
        const raw = JSON.parse(stdout.trim());
        const cpuNum = parseFloat((raw.CPUPerc || "0").replace("%", "")) || 0;
        const memNum = parseFloat((raw.MemPerc || "0").replace("%", "")) || 0;
        const pids = parseInt(raw.PIDs || "0", 10) || 0;
        resolve({
          container_id: raw.ID,
          name: raw.Name,
          cpu_percent: cpuNum,
          memory_usage: raw.MemUsage,
          memory_percent: memNum,
          network_io: raw.NetIO,
          block_io: raw.BlockIO,
          pids,
          target: "docker",
        });
      } catch (e) {
        resolve(null);
      }
    });
    cp.on("error", () => resolve(null));
  });
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

const dashboard = createDashboard({ log: (m) => console.warn(m) });
const PORT = Number(process.env.HOSTERAX_PORT || 7777);
function readBody(req, maxSizeBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let s = "";
    let totalBytes = 0;
    req.on("data", (c) => {
      totalBytes += c.length;
      if (totalBytes > maxSizeBytes) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      s += c;
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
/** Reads the raw request body (needed for HMAC verification) with a hard size cap. */
function readRawBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ───────────── user accounts and single sign-on ─────────────
const accounts = new AccountManager({ db });
accounts.purgeExpiredSessions();
setInterval(() => accounts.purgeExpiredSessions(), 3600_000).unref();
const oidcConfig = loadOidcConfig();
if (oidcConfig && !oidcConfig.ok) console.warn(`[sso] disabled: ${oidcConfig.reason}`);
const oidc = oidcConfig?.ok ? new OidcClient({ config: oidcConfig }) : null;
if (oidc) console.log(`[sso] enabled: "${oidcConfig.name}" (${oidcConfig.issuer})`);

/** The signed-in user behind this request's session token, if any (resolved once per request). */
function sessionOf(req) {
  if (req.hxSession === undefined) {
    const t = bearerFrom(req);
    req.hxSession = t.startsWith("hxs_") ? accounts.resolveSession(t) : null;
  }
  return req.hxSession;
}

/** Who is acting, for permission checks on user management: a signed-in user, or an admin token / the local machine. */
function actorOf(req) {
  const ses = sessionOf(req);
  return ses ? { kind: "user", user: ses.user } : { kind: "system" };
}

const clientIp = (req) => req.socket?.remoteAddress || null;

/** Turns an AccountError into the matching JSON response. */
function authFail(res, e) {
  if (!(e instanceof AccountError))
    return json(res, 500, { ok: false, error: String(e.message || e) });
  if (e.extra?.retryAfterSeconds) res.setHeader("Retry-After", String(e.extra.retryAfterSeconds));
  return json(res, e.status, { ok: false, error: e.message, ...e.extra });
}

const touchToken = (() => {
  const stmt = db.prepare("UPDATE tokens SET last_used_at=? WHERE token=?");
  const last = new Map();
  return (hash) => {
    const now = Date.now();
    if (now - (last.get(hash) || 0) < 60_000) return;
    last.set(hash, now);
    try {
      stmt.run(now, hash);
    } catch {}
  };
})();

/** Resolves the caller's scopes: null = unauthenticated, otherwise an array of scopes. */
function callerScopes(req) {
  const t = bearerFrom(req);
  if (t) {
    if (t.startsWith("hxs_")) return sessionOf(req)?.scopes ?? null;
    const hash = hashToken(t);
    const row = db.prepare("SELECT scopes_json FROM tokens WHERE token=?").get(hash);
    if (!row) return null;
    touchToken(hash);
    try {
      return row.scopes_json ? JSON.parse(row.scopes_json) : ["*"];
    } catch {
      return ["*"];
    }
  }
  if (isTrustedLocalRequest(req, PORT)) return ["*"];
  return null;
}

function authOk(req) {
  return callerScopes(req) !== null;
}

function requirePerm(req, perm) {
  const scopes = callerScopes(req);
  if (!scopes) return false;
  if (scopes.includes("*") || scopes.includes(perm)) return true;
  return scopesLevel(scopes) >= (perm.endsWith(":admin") || perm.startsWith("token:") ? 3 : 2);
}

/** Maps the caller's token scopes onto an AIOps RBAC role. */
function aiRoleFor(req) {
  const level = scopesLevel(callerScopes(req) || []);
  return level >= 3 ? "admin" : level === 2 ? "operator" : "viewer";
}

const projectsApi = createProjectsApi({
  db,
  sessionScopes: (token) => accounts.resolveSession(token)?.scopes ?? null,
  runDeployment,
  running,
  runtimeLogs,
  applyRoute,
  parseCompose,
  syncComposeServices,
  DETECTORS,
  STACK_REGISTRY,
  detectStackDir,
  detectPackageManager,
  detectWorkspace,
  HOME,
  json,
  readBody,
  stopProject,
  serverManager,
  gateManager,
  purgeDatabases: async (projectName) => {
    for (const row of db.prepare("SELECT * FROM managed_dbs WHERE project=?").all(projectName))
      await removeManagedDatabase(row);
  },
});

async function restartService(project) {
  return runOnServer(serverOf(project), () => restartServiceHere(project));
}

async function restartServiceHere(project) {
  const p = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
  if (!p) return;
  const cleanName = project.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (p.target === "docker") {
    const dep = db
      .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
      .get(project);
    if (dep) {
      await startService(
        dep.id,
        project,
        dep.workdir,
        p.start_cmd,
        decryptJson(p.env_json),
        p.target,
        p.port || 3000,
      );
    } else {
      // Without a deployment there is nothing to replay, and a bare `docker run` would publish on the
      // server's public interface; remote projects always start from a deployment.
      if (currentServerId())
        throw new Error(`Deploy "${project}" first; it has never been deployed.`);
      const hostPort = p.port || 3002;
      const tag = p.source || `${project}:latest`;
      spawnSync("docker", ["rm", "-f", `hx_${cleanName}`]);
      spawnSync("docker", [
        "run",
        "-d",
        "--init",
        "--name",
        `hx_${cleanName}`,
        "--restart",
        "unless-stopped",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-p",
        `${BIND_HOST}:${hostPort}:80`,
        "-e",
        "HOST=0.0.0.0",
        "-e",
        "PORT=80",
        tag,
      ]);
    }
  } else {
    const dep = db
      .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
      .get(project);
    if (dep) {
      await startService(
        dep.id,
        project,
        dep.workdir,
        p.start_cmd,
        decryptJson(p.env_json),
        p.target,
        p.port || 3000,
      );
    }
  }
}

/** Docker container name HosteraX uses for a project (single source of truth). */
function containerNameFor(project) {
  return `hx_${String(project)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}`;
}

/** Reads a deployment log from disk (optionally only the last `lines`). Safe against path traversal. */
function readDeploymentLog(deploymentId, lines = 0) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(deploymentId))) return "";
  const file = path.join(LOGDIR, deploymentId + ".log");
  if (!fs.existsSync(file)) return "";
  const text = fs.readFileSync(file, "utf8");
  return lines > 0 ? text.split("\n").slice(-lines).join("\n") : text;
}

function dockerCli(args, timeout = 60000) {
  return new Promise((resolve) => {
    try {
      execFile(
        "docker",
        args,
        { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) =>
          resolve({
            ok: !err,
            stdout: stdout || "",
            stderr: (stderr || err?.message || "").trim(),
          }),
      );
    } catch (err) {
      // e.g. the project's server is not connected: report it like any other failed command
      resolve({ ok: false, stdout: "", stderr: String(err.message) });
    }
  });
}

/** Start / stop / restart a project. Status is only updated when the action really succeeded. */
const lifecycle = {
  containerName: containerNameFor,
  readDeploymentLog,
  /** Last `lines` of the container's stdout/stderr (docker target) or the in-memory runtime buffer. */
  async runtimeLogs(project, lines = 100) {
    const n = Math.min(Math.max(Number(lines) || 100, 1), 5000);
    const r = await dockerCli(["logs", "--tail", String(n), containerNameFor(project)], 15000);
    if (r.ok) return (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
    const buf = runtimeLogs.get(project);
    return Array.isArray(buf)
      ? buf
          .slice(-n)
          .map((l) => l.text ?? String(l))
          .join("\n")
      : "";
  },
  async _exists(project) {
    return (await dockerCli(["inspect", "--type", "container", containerNameFor(project)], 8000))
      .ok;
  },
  _setStatus(project, status) {
    db.prepare("UPDATE projects SET status=?, updated_at=? WHERE name=?").run(
      status,
      Date.now(),
      project,
    );
  },
  async stop(project) {
    const p = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
    if (!p) return { ok: false, error: `Project '${project}' not found` };
    // Mark first so the self-heal loop does not resurrect the service mid-stop.
    lifecycle._setStatus(project, "stopped");
    if (p.target === "docker") {
      if (await lifecycle._exists(project)) {
        const r = await dockerCli(["stop", containerNameFor(project)]);
        if (!r.ok) {
          lifecycle._setStatus(project, p.status || "running");
          return { ok: false, error: r.stderr };
        }
      }
    } else {
      stopProject(project, "manual stop");
    }
    return { ok: true, status: "stopped" };
  },
  async start(project) {
    const p = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
    if (!p) return { ok: false, error: `Project '${project}' not found` };
    try {
      if (p.target === "docker" && (await lifecycle._exists(project))) {
        const r = await dockerCli(["start", containerNameFor(project)]);
        if (!r.ok) return { ok: false, error: r.stderr };
      } else {
        await restartService(project);
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
    lifecycle._setStatus(project, "running");
    return { ok: true, status: "running" };
  },
  async restart(project) {
    const p = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
    if (!p) return { ok: false, error: `Project '${project}' not found` };
    try {
      if (p.target === "docker" && (await lifecycle._exists(project))) {
        const r = await dockerCli(["restart", containerNameFor(project)]);
        if (!r.ok) return { ok: false, error: r.stderr };
      } else {
        await restartService(project);
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
    lifecycle._setStatus(project, "running");
    return { ok: true, status: "running", restartedAt: Date.now() };
  },
};

// Every lifecycle action works on the server the project lives on.
for (const action of ["runtimeLogs", "_exists", "stop", "start", "restart"]) {
  const inner = lifecycle[action];
  lifecycle[action] = (project, ...rest) =>
    runOnServer(serverOf(project), () => inner.call(lifecycle, project, ...rest));
}

// ───────────── Managed databases ─────────────
try {
  db.exec("ALTER TABLE managed_dbs ADD COLUMN port INTEGER");
} catch {}

const DB_ENGINES = {
  postgres: { image: "postgres:16-alpine", port: 5432, dataDir: "/var/lib/postgresql/data" },
  mysql: { image: "mysql:8", port: 3306, dataDir: "/var/lib/mysql" },
  mariadb: { image: "mariadb:11", port: 3306, dataDir: "/var/lib/mysql" },
  mongodb: { image: "mongo:7", port: 27017, dataDir: "/data/db" },
  redis: { image: "redis:7-alpine", port: 6379, dataDir: "/data" },
};
const DB_ENGINE_ALIASES = {
  postgresql: "postgres",
  pg: "postgres",
  mongo: "mongodb",
  valkey: "redis",
};

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function findFreeDbPort(start) {
  const taken = new Set(
    db
      .prepare("SELECT port FROM managed_dbs WHERE port IS NOT NULL")
      .all()
      .map((r) => r.port),
  );
  for (let candidate = start; candidate < start + 500; candidate++) {
    if (!taken.has(candidate) && (await isPortFree(candidate))) return candidate;
  }
  throw new Error(`No free port found near ${start}`);
}

/**
 * Starts a real database container with working credentials. The port is published on 127.0.0.1 only
 * (apps reach it through host.docker.internal) and data lives in a named volume.
 */
async function provisionDatabase({ project, name, engine, sizeMb = 1024 }) {
  const eng =
    DB_ENGINE_ALIASES[String(engine || "").toLowerCase()] || String(engine || "").toLowerCase();
  const spec = DB_ENGINES[eng];
  if (!spec)
    return {
      ok: false,
      status: 400,
      error: `Unsupported engine "${engine}". Use: ${Object.keys(DB_ENGINES).join(", ")}`,
    };
  const dbName = String(name || "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(dbName))
    return {
      ok: false,
      status: 400,
      error: "name must start with a letter and contain only a-z, 0-9 and _ (max 41 chars)",
    };
  if (!db.prepare("SELECT 1 FROM projects WHERE name=?").get(project))
    return { ok: false, status: 404, error: `Project '${project}' not found` };
  if (db.prepare("SELECT 1 FROM managed_dbs WHERE name=?").get(dbName))
    return { ok: false, status: 409, error: `A database named '${dbName}' already exists` };
  if (!(await selfHeal.probeDockerDaemon()))
    return {
      ok: false,
      status: 503,
      error: "Docker daemon is offline — cannot start a database container",
    };

  const id = "mdb_" + crypto.randomBytes(6).toString("hex");
  const password = crypto.randomBytes(18).toString("hex");
  const containerName = `hx_db_${dbName}`;
  const volume = `hx_dbvol_${dbName}`;
  const hostPort = await findFreeDbPort(spec.port);

  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--restart",
    "unless-stopped",
    "-v",
    `${volume}:${spec.dataDir}`,
    "-p",
    `127.0.0.1:${hostPort}:${spec.port}`,
  ];
  let conn;
  let internal;
  const user = "hx";
  if (eng === "postgres") {
    args.push(
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${dbName}`,
      spec.image,
    );
    conn = `postgresql://${user}:${password}@127.0.0.1:${hostPort}/${dbName}`;
  } else if (eng === "mysql" || eng === "mariadb") {
    const pfx = eng === "mysql" ? "MYSQL" : "MARIADB";
    args.push(
      "-e",
      `${pfx}_ROOT_PASSWORD=${password}`,
      "-e",
      `${pfx}_USER=${user}`,
      "-e",
      `${pfx}_PASSWORD=${password}`,
      "-e",
      `${pfx}_DATABASE=${dbName}`,
      spec.image,
    );
    conn = `mysql://${user}:${password}@127.0.0.1:${hostPort}/${dbName}`;
  } else if (eng === "mongodb") {
    args.push(
      "-e",
      `MONGO_INITDB_ROOT_USERNAME=${user}`,
      "-e",
      `MONGO_INITDB_ROOT_PASSWORD=${password}`,
      spec.image,
    );
    conn = `mongodb://${user}:${password}@127.0.0.1:${hostPort}/${dbName}?authSource=admin`;
  } else {
    args.push(
      "-e",
      `REDIS_PASSWORD=${password}`,
      spec.image,
      "redis-server",
      "--requirepass",
      password,
      "--appendonly",
      "yes",
    );
    conn = `redis://:${password}@127.0.0.1:${hostPort}`;
  }
  internal = conn.replace("@127.0.0.1:" + hostPort, "@host.docker.internal:" + hostPort);

  const run = await dockerCli(args, 180000);
  if (!run.ok) {
    return {
      ok: false,
      status: 500,
      error: `docker run failed: ${run.stderr.split("\n").pop() || run.stderr}`,
    };
  }
  db.prepare(
    "INSERT INTO managed_dbs (id, project, name, engine, size_mb, status, connection_string, created_at, port) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(id, project, dbName, eng, Number(sizeMb) || 1024, "running", conn, Date.now(), hostPort);
  return {
    ok: true,
    id,
    name: dbName,
    engine: eng,
    status: "running",
    port: hostPort,
    container: containerName,
    connection_string: conn,
    internal_connection_string: internal,
  };
}

async function removeManagedDatabase(row) {
  await dockerCli(["rm", "-f", `hx_db_${row.name}`], 30000);
  await dockerCli(["volume", "rm", "-f", `hx_dbvol_${row.name}`], 30000);
  db.prepare("DELETE FROM backups WHERE database_name=?").run(row.name);
  db.prepare("DELETE FROM managed_dbs WHERE id=?").run(row.id);
}

const catalogApi = createCatalogApi({ db, HOME, readBody });

const selfHeal = new SelfHealEngine({
  db,
  dockerApi,
  servers: {
    statusOf: (serverId) => {
      const s = serverManager.getServer(serverId);
      return s ? { name: s.name, ready: s.ready, error: s.last_error } : null;
    },
    dockerApiFor: (serverId) => dockerApiForServer(serverId),
    readyRemoteIds: () =>
      serverManager
        .listServers()
        .filter((s) => s.type === "remote" && s.ready)
        .map((s) => s.id),
  },
  publish: (project, msg) => {
    const dep = db
      .prepare("SELECT id FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
      .get(project);
    if (dep?.id) publish(dep.id, msg);
  },
  restartService: (project) => restartService(project),
  rollbackService: async (project, targetDeployId) => {
    const targetDeploy = db.prepare("SELECT * FROM deployments WHERE id=?").get(targetDeployId);
    if (!targetDeploy) return;
    await runDeployment(project, rollbackOptions(targetDeploy, "self-heal-auto-rollback"));
  },
  HOME,
});

selfHeal.onEvent = (e) => notifier.fromEvent(e);

let s3Storage = null;
try {
  const s3StorageRow = db.prepare("SELECT * FROM s3_config LIMIT 1").get();
  if (s3StorageRow) s3Storage = new S3StorageClient(s3StorageRow);
} catch {}

const mcpServer = new MCPServer({
  db,
  backupManager,
  cronManager,
  serverManager,
  s3Storage,
  edgeManager,
  tlsManager,
  selfHeal,
  projectsApi,
  runDeployment,
  applyRoute,
  catalogApps: catalogAppsList,
  emailManager,
  webhookManager,
  orgManager,
  lifecycle,
  provisionDatabase,
  diagnoseProject: (name) => aiOpsManager.diagnoseProject(name),
});

const aiOpsManager = new AIOpsManager({
  db,
  projectsApi,
  gpuManager,
  scaleToZero: scaleToZeroManager,
  backupManager,
  s3Storage,
  edgeManager,
  tlsManager,
  selfHeal,
  cronManager,
  serverManager,
  orgManager,
  webhookManager,
  emailManager,
  metricsManager,
  dockerApi,
  lifecycle,
  provisionDatabase,
  runDeployment,
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health" || url.pathname === "/api/health")
    return json(res, 200, { ok: true, version: ENGINE_VERSION });
  // Rate limit: 120 req/min for auth endpoints, 600/min for others
  const isAuthEndpoint = url.pathname.startsWith("/api/auth");
  if (rateLimit(req, isAuthEndpoint ? 20 : 600)) {
    return json(res, 429, { error: "too many requests" });
  }
  // ── public sign-in surface: password login, SSO, and what this engine offers ──
  if (url.pathname === "/api/auth/providers" && req.method === "GET") {
    const hasUsers = accounts.hasUsers();
    return json(res, 200, {
      setupRequired: !hasUsers,
      password: hasUsers,
      sso: oidc ? { name: oidcConfig.name } : null,
    });
  }
  if (url.pathname === "/api/auth/oidc/login" && req.method === "GET") {
    const back = (location) => {
      res.writeHead(302, { location });
      res.end();
    };
    if (!oidc) return json(res, 404, { error: "single sign-on is not configured" });
    try {
      return back(await oidc.begin());
    } catch (e) {
      return back(`/auth?sso_error=${encodeURIComponent(e.message)}`);
    }
  }
  if (url.pathname === "/api/auth/oidc/callback" && req.method === "GET") {
    const back = (location) => {
      res.writeHead(302, {
        location,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      res.end();
    };
    const fail = (message) => back(`/auth?sso_error=${encodeURIComponent(message)}`);
    if (!oidc) return fail("single sign-on is not configured");
    const idpError = url.searchParams.get("error");
    if (idpError) return fail(url.searchParams.get("error_description") || idpError);
    try {
      const identity = await oidc.complete({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      });
      const r = accounts.loginWithIdentity(identity, {
        defaultRole: oidcConfig.defaultRole,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"],
      });
      // the session travels in the URL fragment: it is never sent to a server or logged in a Referer
      return back(`/auth#session=${r.token}`);
    } catch (e) {
      const message =
        e instanceof OidcError || e instanceof AccountError ? e.message : "single sign-on failed";
      accounts.record("login_failed", { ip: clientIp(req), detail: `sso: ${message}` });
      return fail(message);
    }
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    let b = {};
    try {
      b = await readBody(req);
    } catch {}
    if (b.email !== undefined || b.password !== undefined) {
      try {
        const r = accounts.login({
          email: b.email,
          password: b.password,
          code: b.code,
          ip: clientIp(req),
          userAgent: req.headers["user-agent"],
        });
        return json(res, 200, { ok: true, token: r.token, expiresAt: r.expiresAt, user: r.user });
      } catch (e) {
        return authFail(res, e);
      }
    }
    // legacy: exchange an API token for itself
    const scopes = b.token
      ? db.prepare("SELECT scopes_json FROM tokens WHERE token=?").get(hashToken(b.token))
      : null;
    if (scopes) {
      return json(res, 200, {
        ok: true,
        user: { id: "admin-local", email: b.email || "admin@hosterax.local", role: "admin" },
        token: b.token,
      });
    }
    return json(res, 401, {
      ok: false,
      error: "invalid token — sign in with the engine token printed at first start",
    });
  }

  // Reverse proxy for *.sslip.io, *.nip.io, *.traefik.me, *.ipq.co, *.fdns.uk and *.localhost subdomains
  const rawHost = (req.headers.host || "").toLowerCase();
  const hostname = rawHost.split(":")[0];
  const MAGIC_DNS_SUFFIXES = [".sslip.io", ".nip.io", ".traefik.me", ".ipq.co", ".fdns.uk"];
  const isMagicDns =
    MAGIC_DNS_SUFFIXES.some((s) => hostname.includes(s)) ||
    (hostname.endsWith(".localhost") && hostname !== "localhost");
  if (
    isMagicDns &&
    !url.pathname.startsWith("/api") &&
    !url.pathname.startsWith("/health") &&
    !url.pathname.startsWith("/webhooks")
  ) {
    const sub = hostname.split(".")[0];
    const route = db
      .prepare(
        "SELECT * FROM routes WHERE LOWER(project)=LOWER(?) OR LOWER(hostname) LIKE LOWER(?)",
      )
      .get(sub, `%${sub}%`);
    const proj = db
      .prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)")
      .get(sub, sub);
    const upstreamPort = route?.upstream_port || proj?.port;
    if (upstreamPort) {
      const proxyReq = http.request(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: rawHost },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", () => {
        json(res, 502, {
          error: `Bad Gateway: App '${sub}' (port ${upstreamPort}) is not reachable yet. Please ensure the app is running.`,
        });
      });
      req.pipe(proxyReq);
      return;
    }
  }

  // Git provider webhooks — public, but every request must carry a valid HMAC signature.
  if (
    (url.pathname === "/webhooks/github" || url.pathname.startsWith("/webhooks/github/")) &&
    req.method === "POST"
  ) {
    const project = decodeURIComponent(url.pathname.split("/")[3] || "") || null;
    let raw;
    try {
      raw = await readRawBody(req, 5 * 1024 * 1024);
    } catch {
      return json(res, 413, { error: "payload too large" });
    }
    const event = String(req.headers["x-github-event"] || "push");
    const signatureHeader = String(req.headers["x-hub-signature-256"] || "");
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {}
    try {
      // Webhooks configured through POST /api/projects/:n/webhook (explicit secret + branch)
      const legacy = project
        ? db.prepare("SELECT * FROM webhooks WHERE project=?").get(project)
        : null;
      if (legacy) {
        const expected =
          "sha256=" + crypto.createHmac("sha256", legacy.secret).update(raw).digest("hex");
        const a = Buffer.from(signatureHeader);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
          return json(res, 401, { error: "bad signature" });
        if (event === "ping") return json(res, 200, { ok: true, message: "Pong! Webhook active." });
        const branch = String(payload.ref || "").replace("refs/heads/", "");
        if (branch !== legacy.branch) return json(res, 200, { skipped: true, branch });
        const r = await runDeployment(project, { trigger: "git" });
        return json(res, 200, { deployed: r.id });
      }
      const result = await webhookManager.handleGitHubWebhook({
        event,
        payload,
        rawBodyText: raw,
        signatureHeader,
        projectName: project,
        requireSignature: true,
      });
      return json(res, 200, result);
    } catch (e) {
      return json(res, e.status || 500, { error: e.message });
    }
  }

  if (!authOk(req)) return json(res, 401, { error: "unauthorized" });

  // Enforce token scopes globally: read < deploy < admin.
  {
    const scopes = callerScopes(req) || [];
    if (scopesLevel(scopes) < requiredLevel(req.method, url.pathname)) {
      return json(res, 403, { error: "forbidden: token scope is too narrow for this endpoint" });
    }
  }

  if (url.pathname === "/api/openapi.json" && req.method === "GET") {
    try {
      const spec = fs.readFileSync(path.join(__dirname, "openapi.json"), "utf8");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      return res.end(spec);
    } catch {
      return json(res, 404, { error: "openapi.json is not bundled with this build" });
    }
  }

  if (await catalogApi(req, res, url.pathname)) return;

  if ((url.pathname === "/api/system" || url.pathname === "/api/stats") && req.method === "GET") {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPct = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = Math.round(((totalTick - totalIdle) / totalTick) * 100) || 5;

    let diskTotalGb = 500;
    let diskFreeGb = 350;
    let diskUsedGb = 150;
    let diskPct = 30;
    try {
      if (typeof fs.statfsSync === "function") {
        const stat = fs.statfsSync(HOME);
        const tBytes = stat.blocks * stat.bsize;
        const fBytes = stat.bfree * stat.bsize;
        const uBytes = tBytes - fBytes;
        diskTotalGb = Math.round((tBytes / 1073741824) * 10) / 10;
        diskFreeGb = Math.round((fBytes / 1073741824) * 10) / 10;
        diskUsedGb = Math.round((uBytes / 1073741824) * 10) / 10;
        diskPct = Math.round((uBytes / tBytes) * 100);
      }
    } catch {}

    let contCount = 0;
    try {
      const dCount = spawnSync("docker", ["ps", "-q"], {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
      });
      if (dCount.stdout) {
        contCount = dCount.stdout.trim().split("\n").filter(Boolean).length;
      }
    } catch {}

    const projCount = db.prepare("SELECT count(*) as count FROM projects").get()?.count || 0;
    const routeCount = db.prepare("SELECT count(*) as count FROM routes").get()?.count || 0;
    let depCount = 0;
    try {
      depCount = db.prepare("SELECT count(*) as count FROM deployments").get()?.count || 0;
    } catch {}
    let dbCount = 0;
    try {
      dbCount = db.prepare("SELECT count(*) as count FROM databases").get()?.count || 0;
    } catch {}

    const systemInfo = {
      cpu: {
        cores: cpus.length,
        percent: cpuUsage,
        model: cpus[0]?.model || "Host Processor",
      },
      memory: {
        total_mb: Math.round(totalMem / 1048576),
        used_mb: Math.round(usedMem / 1048576),
        free_mb: Math.round(freeMem / 1048576),
        percent: memPct,
      },
      disk: {
        total_gb: diskTotalGb,
        used_gb: diskUsedGb,
        free_gb: diskFreeGb,
        percent: diskPct,
      },
      docker: {
        containers_count: contCount,
        running: Boolean(selfHeal?.daemonHealthy),
        version: selfHeal?.daemonVersion || null,
        error: !selfHeal?.daemonHealthy ? "Docker Desktop is offline or unreachable" : null,
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptime: Math.round(os.uptime()),
      },
    };

    return json(res, 200, {
      ...systemInfo,
      system: systemInfo,
      projects: projCount,
      deployments: { total: depCount },
      databases: dbCount,
      routes: routeCount,
      stats: {
        projects: projCount,
        routes: routeCount,
        deployments: depCount,
        databases: dbCount,
      },
    });
  }

  // ── Real-Time Metrics & Log Analytics API Endpoints ──
  if (url.pathname === "/api/metrics" && req.method === "GET") {
    return json(res, 200, {
      system: metricsManager.getSystemMetrics(),
      ...metricsManager.getServiceMetrics(),
    });
  }

  if (url.pathname.startsWith("/api/metrics/") && req.method === "GET") {
    const proj = url.pathname.replace("/api/metrics/", "").trim();
    return json(res, 200, metricsManager.getServiceMetrics(proj));
  }

  if (url.pathname === "/api/logs/search" && req.method === "GET") {
    const proj = url.searchParams.get("project") || "";
    const query = url.searchParams.get("query") || "";
    const level = url.searchParams.get("level") || "all";
    const limit = Number(url.searchParams.get("limit") || 100);
    return json(
      res,
      200,
      runOnServer(serverOf(proj), () => metricsManager.searchLogs(proj, { query, level, limit })),
    );
  }

  if (url.pathname === "/api/alerts" && req.method === "GET") {
    const proj = url.searchParams.get("project");
    return json(res, 200, {
      activeAlerts: metricsManager.listActiveAlerts(),
      rules: metricsManager.listAlertRules(proj),
    });
  }

  if (url.pathname === "/api/alerts/rule" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.project) return json(res, 400, { error: "project is required" });
    const rule = metricsManager.setAlertRule(
      b.project,
      b.metricType || "memory",
      b.threshold || 85,
    );
    return json(res, 200, { ok: true, rule });
  }

  // ── Native Docker Engine REST API Endpoints ──
  if (url.pathname === "/api/docker/containers" && req.method === "GET") {
    try {
      const all = url.searchParams.get("all") !== "0";
      const list = await dockerApi.listContainers({ all });
      return json(res, 200, list);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname.startsWith("/api/docker/containers/") && req.method === "GET") {
    const parts = url.pathname.split("/").filter(Boolean);
    const nameOrId = parts[3];
    const subAction = parts[4];

    try {
      if (!subAction || subAction === "inspect") {
        const inspectData = await dockerApi.inspectContainer(nameOrId);
        return json(res, 200, inspectData);
      }
      if (subAction === "stats") {
        const stats = await dockerApi.getContainerStats(nameOrId);
        return json(res, 200, stats);
      }
      if (subAction === "top") {
        const psArgs = url.searchParams.get("ps_args") || "-ef";
        const top = await dockerApi.getContainerTop(nameOrId, psArgs);
        return json(res, 200, top);
      }
      if (subAction === "changes") {
        const changes = await dockerApi.getContainerChanges(nameOrId);
        return json(res, 200, changes);
      }
      if (subAction === "logs") {
        const tail = Number(url.searchParams.get("tail") || 100);
        const logs = await dockerApi.getContainerLogs(nameOrId, { tail });
        return json(res, 200, { name: nameOrId, logs });
      }
    } catch (err) {
      return json(res, err.statusCode || 500, { error: err.message });
    }
  }

  if (url.pathname.startsWith("/api/docker/containers/") && req.method === "POST") {
    const parts = url.pathname.split("/").filter(Boolean);
    const nameOrId = parts[3];
    const subAction = parts[4];
    const b = await readBody(req);

    try {
      if (subAction === "start") {
        await dockerApi.startContainer(nameOrId);
        return json(res, 200, { ok: true, action: "started", container: nameOrId });
      }
      if (subAction === "stop") {
        await dockerApi.stopContainer(nameOrId, b.timeout || 10);
        return json(res, 200, { ok: true, action: "stopped", container: nameOrId });
      }
      if (subAction === "restart") {
        await dockerApi.restartContainer(nameOrId, b.timeout || 10);
        return json(res, 200, { ok: true, action: "restarted", container: nameOrId });
      }
      if (subAction === "update") {
        const result = await dockerApi.updateContainer(nameOrId, b.resources || b);
        return json(res, 200, { ok: true, action: "updated", container: nameOrId, result });
      }
      if (subAction === "exec") {
        if (!b.cmd) return json(res, 400, { error: "cmd is required for in-container exec" });
        const result = await dockerApi.execCommand(nameOrId, b.cmd, {
          workingDir: b.workingDir,
          env: b.env,
        });
        return json(res, 200, result);
      }
    } catch (err) {
      return json(res, err.statusCode || 500, { error: err.message });
    }
  }

  if (url.pathname.startsWith("/api/docker/containers/") && req.method === "DELETE") {
    const parts = url.pathname.split("/").filter(Boolean);
    const nameOrId = parts[3];
    try {
      await dockerApi.removeContainer(nameOrId, { force: true });
      return json(res, 200, { ok: true, action: "removed", container: nameOrId });
    } catch (err) {
      return json(res, err.statusCode || 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/images" && req.method === "GET") {
    try {
      const list = await dockerApi.listImages();
      return json(res, 200, list);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/images/pull" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.image) return json(res, 400, { error: "image tag is required" });
    try {
      const result = await dockerApi.pullImage(b.image);
      return json(res, 200, { ok: true, image: b.image, result });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/images/prune" && req.method === "POST") {
    try {
      const result = await dockerApi.pruneImages();
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/volumes" && req.method === "GET") {
    try {
      const list = await dockerApi.listVolumes();
      return json(res, 200, list);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/volumes/create" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.name) return json(res, 400, { error: "volume name is required" });
    try {
      const result = await dockerApi.createVolume(b.name, { driver: b.driver, labels: b.labels });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/networks" && req.method === "GET") {
    try {
      const list = await dockerApi.listNetworks();
      return json(res, 200, list);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/system/df" && req.method === "GET") {
    try {
      const df = await dockerApi.getDiskUsage();
      return json(res, 200, df);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/docker/system/prune" && req.method === "POST") {
    try {
      const result = await dockerApi.pruneAll();
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  try {
    let m;

    if (url.pathname === "/api/system" && req.method === "GET") {
      return json(res, 200, getSystemMetrics());
    }

    // ────────── Self-Healing API ──────────
    if (url.pathname === "/api/self-heal/status" && req.method === "GET") {
      return json(res, 200, selfHeal.getStatusSummary());
    }
    if (url.pathname === "/api/self-heal/events" && req.method === "GET") {
      const proj = url.searchParams.get("project") || "all";
      const limit = Number(url.searchParams.get("limit") || 50);
      return json(res, 200, selfHeal.getProjectEvents(proj, limit));
    }
    if (url.pathname === "/api/self-heal/probe" && req.method === "POST") {
      await selfHeal.runReconciliationLoop();
      return json(res, 200, selfHeal.getStatusSummary());
    }
    if (url.pathname === "/api/self-heal/prune" && req.method === "POST") {
      selfHeal.runAutoPrune();
      return json(res, 200, { ok: true, message: "AutoPrune triggered" });
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|restart)$/)) &&
      req.method === "POST"
    ) {
      const r = await lifecycle[m[2]](decodeURIComponent(m[1]));
      return json(res, r.ok ? 200 : r.error?.includes("not found") ? 404 : 500, r);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/heal$/)) && req.method === "POST") {
      const p = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      await selfHeal.probeProject(p);
      return json(res, 200, selfHeal.getStatusSummary().projects[m[1]] || { status: "unknown" });
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/reset-circuit$/)) &&
      req.method === "POST"
    ) {
      const p = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      const result = selfHeal.resetCircuit(m[1]);
      return json(res, 200, result);
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/pipeline-audit$/)) &&
      req.method === "POST"
    ) {
      try {
        const audit = await selfHeal.runFullPipelineAudit(m[1]);
        return json(res, 200, audit);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/chaos-test$/)) &&
      req.method === "POST"
    ) {
      try {
        const body = await readBody(req);
        const result = await selfHeal.simulateChaos(m[1], body.type || "kill");
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/auto-remediate-image$/)) &&
      req.method === "POST"
    ) {
      try {
        const result = await selfHeal.autoRemediateCrashLoop(m[1]);
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/reset-circuit$/)) &&
      req.method === "POST"
    ) {
      try {
        const result = selfHeal.resetCircuit(m[1]);
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/health-config$/)) &&
      req.method === "GET"
    ) {
      return json(res, 200, selfHeal.getHealthConfig(m[1]));
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/health-config$/)) &&
      req.method === "POST"
    ) {
      const body = await readBody(req);
      const updated = selfHeal.setHealthConfig(m[1], body);
      return json(res, 200, updated);
    }

    // ────────── Projects API (Universal Management Surface) ──────────
    if (await projectsApi.handle(req, res, url)) return;

    // ────────── projects (legacy engine surface) ──────────
    if (url.pathname === "/api/projects" && req.method === "GET")
      return json(
        res,
        200,
        db
          .prepare("SELECT * FROM projects ORDER BY created_at DESC")
          .all()
          .map(({ env_json: _env, ...row }) => row),
      );
    if (url.pathname === "/api/projects" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return json(res, 400, { error: "name required" });
      const current = db.prepare("SELECT * FROM projects WHERE name=?").get(b.name);
      db.prepare(
        "INSERT OR REPLACE INTO projects (name, source, build_cmd, start_cmd, env_json, target, created_at, cpu_limit, memory_mb_limit) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        b.name,
        b.source || "",
        b.buildCmd || "",
        b.startCmd || "",
        encryptJson(b.env || {}),
        b.target || "process",
        current?.created_at ?? Date.now(),
        current?.cpu_limit ?? null,
        current?.memory_mb_limit ?? null,
      );
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "DELETE") {
      const projName = m[1];
      const cleanName = projName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const removedServer = serverOf(projName);
      db.prepare("DELETE FROM projects WHERE name=?").run(projName);
      db.prepare("DELETE FROM deployments WHERE project=?").run(projName);
      db.prepare("DELETE FROM domains WHERE project=?").run(projName);
      db.prepare("DELETE FROM managed_dbs WHERE project=?").run(projName);
      selfHeal.untrack(projName);
      try {
        runOnServer(removedServer, () =>
          spawnSync("docker", ["rm", "-f", `hx_${cleanName}`], { timeout: 5000 }),
        );
      } catch {}
      if (removedServer) serverManager.unforward(removedServer, projName).catch(() => {});
      gateManager.disable(projName).catch(() => {});
      const r = running.get(projName);
      if (r) {
        try {
          process.kill(r.pid);
        } catch {}
        running.delete(projName);
      }
      return json(res, 200, { ok: true });
    }

    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/quotas$/)) && req.method === "POST") {
      const b = await readBody(req);
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });

      const maxCpus = os.cpus().length;
      const maxMem = os.totalmem() / 1048576;

      if (b.cpu_limit !== null && b.cpu_limit > maxCpus) {
        return json(res, 400, {
          error: `CPU limit cannot exceed host capacity (${maxCpus} cores)`,
        });
      }
      if (b.memory_mb_limit !== null && b.memory_mb_limit > maxMem) {
        return json(res, 400, {
          error: `Memory limit cannot exceed host capacity (${Math.round(maxMem)} MB)`,
        });
      }

      db.prepare("UPDATE projects SET cpu_limit=?, memory_mb_limit=? WHERE name=?").run(
        b.cpu_limit ?? null,
        b.memory_mb_limit ?? null,
        m[1],
      );
      return json(res, 200, {
        ok: true,
        cpu_limit: b.cpu_limit,
        memory_mb_limit: b.memory_mb_limit,
      });
    }

    // ────────── project metrics (including docker stats & process stats) ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/)) && req.method === "GET") {
      const projectName = m[1];
      const p = db
        .prepare("SELECT * FROM projects WHERE name=? OR slug=?")
        .get(projectName, projectName);
      if (!p) return json(res, 404, { error: "project not found" });

      const dockerMetrics = await getContainerMetrics(p.name);
      const proc = running.get(p.name);
      const sys = getSystemMetrics();

      return json(res, 200, {
        project: p.name,
        target: p.target,
        status: proc ? "running" : dockerMetrics ? "running" : "stopped",
        docker: dockerMetrics,
        process: proc
          ? {
              pid: proc.child?.pid,
              started_at: proc.startedAt,
              cmd: proc.cmd,
              policy: proc.policy,
              uptime_seconds: Math.floor((Date.now() - (proc.startedAt || Date.now())) / 1000),
            }
          : null,
        system: sys,
      });
    }

    // ────────── deployments ──────────
    if (url.pathname === "/api/deployments" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 100);
      return json(
        res,
        200,
        db.prepare("SELECT * FROM deployments ORDER BY started_at DESC LIMIT ?").all(limit),
      );
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/deployments$/)) && req.method === "GET")
      return json(
        res,
        200,
        db
          .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 100")
          .all(m[1]),
      );
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/)) && req.method === "POST") {
      const b = await readBody(req);
      const r = await runDeployment(m[1], { trigger: b.trigger });
      return json(res, 200, r);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env$/)) && req.method === "POST") {
      // Legacy shape: { env: {...} } replaces everything, { key, value } upserts one variable.
      const b = await readBody(req);
      if (!db.prepare("SELECT 1 FROM projects WHERE name=?").get(m[1]))
        return json(res, 404, { error: "project not found" });
      try {
        if (b.env && typeof b.env === "object") projectsApi.putEnv(m[1], b.env, { replace: true });
        else if (b.key) projectsApi.putEnv(m[1], { [b.key]: b.value ?? "" });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      return json(res, 200, { ok: true, env: projectsApi.readEnv(m[1]) });
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      if (!db.prepare("SELECT 1 FROM projects WHERE name=?").get(m[1]))
        return json(res, 404, { error: "project not found" });
      projectsApi.removeEnv(m[1], decodeURIComponent(m[2]));
      return json(res, 200, { ok: true, env: projectsApi.readEnv(m[1]) });
    }
    if (
      (m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/)) &&
      req.method === "POST"
    ) {
      const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      if (!d) return json(res, 404, { error: "not found" });
      const r = await runDeployment(d.project, rollbackOptions(d));
      return json(res, 200, r);
    }
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)$/)) && req.method === "GET") {
      const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      if (!d) return json(res, 404, { error: "deployment not found" });
      const { snapshot_json, ...safe } = d;
      return json(res, 200, safe);
    }
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/)) && req.method === "GET") {
      const text = readDeploymentLog(m[1]);
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      return res.end(text);
    }

    // ────────── deployment diff ──────────
    if (
      (m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/diff\/([^/]+)$/)) &&
      req.method === "GET"
    ) {
      const d1 = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      const d2 = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[2]);
      if (!d1 || !d2) return json(res, 404, { error: "deployment not found" });
      // load project env for each
      const p1 = db.prepare("SELECT env_json FROM projects WHERE name=?").get(d1.project);
      const p2 = db.prepare("SELECT env_json FROM projects WHERE name=?").get(d2.project);
      const env1 = p1 ? decryptJson(p1.env_json) : {};
      const env2 = p2 ? decryptJson(p2.env_json) : {};
      const allKeys = [...new Set([...Object.keys(env1), ...Object.keys(env2)])];
      const envDiff = allKeys
        .map((k) => ({
          key: k,
          base: env1[k] ?? null,
          target: env2[k] ?? null,
          change:
            env1[k] === env2[k]
              ? "unchanged"
              : !env1[k]
                ? "added"
                : !env2[k]
                  ? "removed"
                  : "modified",
        }))
        .filter((d) => d.change !== "unchanged");

      return json(res, 200, {
        base: {
          id: d1.id,
          version: d1.version,
          phase: d1.phase,
          trigger: d1.trigger,
          started_at: d1.started_at,
          finished_at: d1.finished_at,
          exit_code: d1.exit_code,
        },
        target: {
          id: d2.id,
          version: d2.version,
          phase: d2.phase,
          trigger: d2.trigger,
          started_at: d2.started_at,
          finished_at: d2.finished_at,
          exit_code: d2.exit_code,
        },
        env_diff: envDiff,
        duration_diff_ms:
          (d2.finished_at ?? 0) -
          (d2.started_at ?? 0) -
          ((d1.finished_at ?? 0) - (d1.started_at ?? 0)),
      });
    }

    // ────────── metrics ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/)) && req.method === "GET") {
      const p = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      const sys = getSystemMetrics();
      const deployCount = db
        .prepare("SELECT COUNT(*) c FROM deployments WHERE project=?")
        .get(m[1]).c;
      const lastDeploy = db
        .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
        .get(m[1]);
      const proc = running.get(m[1]);
      return json(res, 200, {
        project: m[1],
        process_running: !!proc && !proc.killed,
        pid: proc?.pid ?? null,
        deploy_count: deployCount,
        last_deploy: lastDeploy ?? null,
        system: sys,
      });
    }
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      return json(res, 200, getSystemMetrics());
    }

    // ────────── stats ──────────
    if (url.pathname === "/api/stats" && req.method === "GET") {
      const totalProjects = db.prepare("SELECT COUNT(*) c FROM projects").get().c;
      const totalDeploys = db.prepare("SELECT COUNT(*) c FROM deployments").get().c;
      const successDeploys = db
        .prepare("SELECT COUNT(*) c FROM deployments WHERE phase='ready'")
        .get().c;
      const failedDeploys = db
        .prepare("SELECT COUNT(*) c FROM deployments WHERE phase='failed'")
        .get().c;
      const avgDuration = db
        .prepare(
          "SELECT AVG(finished_at - started_at) a FROM deployments WHERE finished_at IS NOT NULL",
        )
        .get().a;
      const totalDomains = db.prepare("SELECT COUNT(*) c FROM domains").get().c;
      const totalDbs = db.prepare("SELECT COUNT(*) c FROM managed_dbs").get().c;
      const totalBackups = db.prepare("SELECT COUNT(*) c FROM backups").get().c;
      const runningProcs = [...running.entries()].filter(([, p]) => !p.killed).length;
      return json(res, 200, {
        projects: totalProjects,
        deployments: {
          total: totalDeploys,
          success: successDeploys,
          failed: failedDeploys,
          success_rate:
            totalDeploys > 0 ? ((successDeploys / totalDeploys) * 100).toFixed(1) : "0.0",
        },
        avg_duration_ms: Math.round(avgDuration ?? 0),
        domains: totalDomains,
        databases: totalDbs,
        backups: totalBackups,
        running_processes: runningProcs,
        system: getSystemMetrics(),
      });
    }

    // ────────── Magic DNS settings ──────────
    // ── public access: tunnels ──
    if (url.pathname === "/api/tunnels/providers" && req.method === "GET") {
      return json(res, 200, tunnelManager.providers());
    }
    // ────────── Password gate ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/gate$/))) {
      const gateProject = decodeURIComponent(m[1]);
      if (!db.prepare("SELECT 1 FROM projects WHERE name=?").get(gateProject))
        return json(res, 404, { error: "project not found" });
      if (req.method === "GET") return json(res, 200, gateManager.status(gateProject));
      if (req.method === "PUT") {
        const b = await readBody(req);
        try {
          await gateManager.enable(gateProject, b.password);
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
        return json(res, 200, {
          ...gateManager.status(gateProject),
          note: "Routes and public addresses now go through the password page. If the app is already running, redeploy it so its own port stops being reachable from the network.",
        });
      }
      if (req.method === "DELETE") {
        await gateManager.disable(gateProject);
        return json(res, 200, { enabled: false });
      }
    }

    // ────────── Notifications ──────────
    if (url.pathname === "/api/notifications" && req.method === "GET") {
      return json(res, 200, {
        channels: notifier.list(),
        events: EVENT_KINDS,
        types: CHANNEL_TYPES,
        recent: notifier.recentLog(30),
      });
    }
    if (url.pathname === "/api/notifications" && req.method === "POST") {
      try {
        return json(res, 201, notifier.create(await readBody(req)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/notifications\/([^/]+)\/test$/)) &&
      req.method === "POST"
    ) {
      try {
        return json(res, 200, await notifier.test(m[1]));
      } catch (err) {
        return json(res, 404, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/notifications\/([^/]+)$/)) && req.method === "PATCH") {
      try {
        return json(res, 200, notifier.update(m[1], await readBody(req)));
      } catch (err) {
        return json(res, /not found/.test(err.message) ? 404 : 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/notifications\/([^/]+)$/)) && req.method === "DELETE") {
      return notifier.remove(m[1])
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "Notification channel not found" });
    }

    if (url.pathname === "/api/tunnels" && req.method === "GET") {
      return json(res, 200, tunnelManager.list());
    }
    if (url.pathname === "/api/tunnels" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 201, tunnelManager.create(b));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/tunnels\/([^/]+)$/)) && req.method === "GET") {
      const t = tunnelManager.get(m[1]);
      return t ? json(res, 200, t) : json(res, 404, { error: "tunnel not found" });
    }
    if ((m = url.pathname.match(/^\/api\/tunnels\/([^/]+)$/)) && req.method === "DELETE") {
      return tunnelManager.remove(m[1])
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "tunnel not found" });
    }
    if ((m = url.pathname.match(/^\/api\/tunnels\/([^/]+)\/logs$/)) && req.method === "GET") {
      const lines = tunnelManager.logs(m[1]);
      return lines ? json(res, 200, { lines }) : json(res, 404, { error: "tunnel not found" });
    }
    if (
      (m = url.pathname.match(/^\/api\/tunnels\/([^/]+)\/(start|stop|restart)$/)) &&
      req.method === "POST"
    ) {
      const t =
        m[2] === "start"
          ? tunnelManager.enable(m[1])
          : m[2] === "stop"
            ? tunnelManager.disable(m[1])
            : tunnelManager.restart(m[1]);
      return t ? json(res, 200, t) : json(res, 404, { error: "tunnel not found" });
    }
    // what this machine's public address is, and whether it can be reached without a tunnel
    if (url.pathname === "/api/expose/public-ip" && req.method === "GET") {
      const configured = getServerIp();
      const found = await detectPublicIp();
      if (!found)
        return json(res, 200, {
          ip: null,
          configured,
          error: "could not reach any address-lookup service (is this machine offline?)",
        });
      const assignedToThisMachine = edgeManager.getLocalIps().includes(found.ip);
      return json(res, 200, {
        ip: found.ip,
        source: found.source,
        configured,
        configuredMatches: configured === found.ip,
        assignedToThisMachine,
        advice: assignedToThisMachine
          ? "This machine has a public address of its own. Apps are reachable on it once ports 80 and 443 are open in the firewall."
          : "This machine is behind a router or carrier NAT, so people on the internet cannot reach this address directly. Use a tunnel, or forward ports 80 and 443 on your router.",
      });
    }
    if (url.pathname === "/api/expose/public-ip" && req.method === "POST") {
      const b = await readBody(req);
      let ip = b.ip ? String(b.ip).trim() : "";
      if (!ip) {
        const found = await detectPublicIp();
        if (!found) return json(res, 502, { error: "could not detect the public address" });
        ip = found.ip;
      }
      const octets = ip.split(".").map(Number);
      if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
        return json(res, 400, { error: "give an IPv4 address such as 203.0.113.9" });
      if (isPrivateAddress(ip))
        return json(res, 400, {
          error: `${ip} is a private address; the internet cannot reach it`,
        });
      setSetting("server_public_ip", ip);
      return json(res, 200, { ok: true, ip });
    }
    // expose every deployed project automatically (off by default)
    if (url.pathname === "/api/expose/auto" && req.method === "GET") {
      return json(res, 200, {
        enabled: getSetting("tunnels_auto_expose", "0") === "1",
        provider: getSetting("tunnels_auto_provider", "auto"),
      });
    }
    if (url.pathname === "/api/expose/auto" && req.method === "PUT") {
      const b = await readBody(req);
      if (b.provider !== undefined) {
        const def = TUNNEL_PROVIDERS[b.provider];
        const ok =
          b.provider === "auto" ||
          (def && !def.custom && !def.targetOnly && !def.options.some((o) => o.required));
        if (!ok)
          return json(res, 400, {
            error:
              "automatic exposure needs auto or a provider that requires no account or settings",
          });
        setSetting("tunnels_auto_provider", b.provider);
      }
      if (b.enabled !== undefined) setSetting("tunnels_auto_expose", b.enabled ? "1" : "0");
      return json(res, 200, {
        enabled: getSetting("tunnels_auto_expose", "0") === "1",
        provider: getSetting("tunnels_auto_provider", "auto"),
      });
    }
    if (url.pathname === "/api/settings/magic-dns" && req.method === "GET") {
      const activeProvider = getSetting("magic_dns_provider", "sslip.io");
      const list = Object.entries(MAGIC_DNS_PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        badge: p.badge || "Active",
        description: p.description,
        status: p.status,
        example: p.format("my-app"),
        suffix: p.suffix,
        isActive: id === activeProvider,
      }));
      return json(res, 200, {
        activeProvider,
        activeHostFormat:
          MAGIC_DNS_PROVIDERS[activeProvider]?.format("app-name") || `${activeProvider}`,
        providers: list,
      });
    }

    if (url.pathname === "/api/settings/magic-dns" && req.method === "POST") {
      const b = await readBody(req);
      const prov = b.provider;
      if (!prov || !MAGIC_DNS_PROVIDERS[prov]) {
        return json(res, 400, {
          error: `Invalid provider "${prov}". Must be one of: ${Object.keys(MAGIC_DNS_PROVIDERS).join(", ")}`,
        });
      }
      setSetting("magic_dns_provider", prov);
      // Update default route hostnames for active routes if project has no custom primary domain
      try {
        const routes = db.prepare("SELECT * FROM routes").all();
        for (const r of routes) {
          const hasPrimary = db
            .prepare("SELECT 1 FROM domains WHERE project=? AND is_primary=1")
            .get(r.project);
          if (!hasPrimary) {
            const newDefaultHost = getMagicDnsHost(r.project);
            db.prepare("UPDATE routes SET hostname=? WHERE project=?").run(
              newDefaultHost,
              r.project,
            );
          }
        }
      } catch {}
      return json(res, 200, {
        ok: true,
        activeProvider: prov,
        message: `Default wildcard DNS switched to ${prov}`,
      });
    }

    // ────────── edge management ──────────
    if (url.pathname === "/api/edge/status" && req.method === "GET") {
      const status = await edgeManager.getStatus();
      return json(res, 200, status);
    }
    if (url.pathname === "/api/edge/settings" && req.method === "GET") {
      return json(res, 200, edgeManager.getSettings());
    }
    if (url.pathname === "/api/edge/settings" && req.method === "POST") {
      const b = await readBody(req);
      let updated;
      try {
        updated = edgeManager.updateSettings(b);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { ok: true, settings: updated });
    }
    if (url.pathname === "/api/edge/sync" && req.method === "POST") {
      const r = await edgeManager.syncRoutes();
      return json(res, 200, r);
    }
    if (url.pathname === "/api/edge/ca-certificate" && req.method === "GET") {
      const caCert = await edgeManager.getRootCaCertificate();
      if (!caCert) return json(res, 404, { error: "Root CA certificate not available" });
      res.writeHead(200, {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="HosteraX-Local-Root-CA.crt"',
      });
      return res.end(caCert);
    }
    if (url.pathname === "/api/edge/check-domain" && req.method === "GET") {
      const domainToCheck = url.searchParams.get("domain");
      const allowed = edgeManager.isDomainAllowed(domainToCheck);
      if (allowed) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("Domain Allowed");
      } else {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Domain Not Allowed");
      }
    }

    // ────────── Database Backups & Instant Restore Subsystem ──────────
    if (url.pathname === "/api/backups/targets" && req.method === "GET") {
      const targets = await backupManager.detectTargets();
      return json(res, 200, targets);
    }
    if (url.pathname === "/api/backups" && req.method === "GET") {
      const dbFilter = url.searchParams.get("database");
      const projFilter = url.searchParams.get("project");
      const backups = backupManager.listBackups({
        database_name: dbFilter,
        project_name: projFilter,
      });
      return json(res, 200, backups);
    }
    if (url.pathname === "/api/backups/create" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const bkp = await backupManager.createBackup({
          databaseName: b.databaseName,
          dbType: b.dbType,
          projectName: b.projectName,
          containerName: b.containerName,
          encrypt: Boolean(b.encrypt),
        });
        return json(res, 200, bkp);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/)) && req.method === "POST") {
      const b = await readBody(req);
      try {
        const result = await backupManager.restoreBackup(m[1], b?.targetContainer);
        return json(res, 200, result);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/download$/)) && req.method === "GET") {
      const bkp = backupManager.getBackup(m[1]);
      if (!bkp || !fs.existsSync(bkp.file_path)) {
        return json(res, 404, { error: "Backup file not found" });
      }
      // Encrypted archives are served decrypted: the download is a normal .sql.gz/.tar.gz anyone can open.
      let readStream;
      try {
        readStream = await backupManager.openBackupStream(bkp);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
      const filename = path.basename(bkp.file_path).replace(/\.enc$/, "");
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        ...(bkp.encrypted ? {} : { "Content-Length": fs.statSync(bkp.file_path).size }),
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      return readStream.pipe(res);
    }
    if (url.pathname === "/api/backups/s3-config" && req.method === "GET") {
      return json(res, 200, backupManager.getS3Config());
    }
    if (url.pathname === "/api/backups/s3-config" && req.method === "POST") {
      const b = await readBody(req);
      const updated = backupManager.saveS3Config(b);
      return json(res, 200, { ok: true, config: updated });
    }
    if (url.pathname === "/api/backups/s3-test" && req.method === "POST") {
      const b = await readBody(req);
      const testRes = await backupManager.testS3Connection(b?.bucket ? b : null);
      return json(res, 200, testRes);
    }
    if (url.pathname === "/api/backups/remote-s3" && req.method === "GET") {
      const list = await backupManager.listRemoteS3Backups();
      return json(res, 200, list);
    }
    if (url.pathname === "/api/backups/remote-s3" && req.method === "DELETE") {
      const s3Key = url.searchParams.get("key");
      if (!s3Key) return json(res, 400, { error: "key required" });
      const ok = await backupManager.deleteRemoteS3Backup(s3Key);
      return json(res, 200, { ok });
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/sync-s3$/)) && req.method === "POST") {
      try {
        const syncRes = await backupManager.syncBackupToS3(m[1]);
        return json(res, 200, syncRes);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    // ── schedules, verification and restore drills ──
    if (url.pathname === "/api/backups/schedules" && req.method === "GET") {
      return json(res, 200, backupScheduler.list());
    }
    if (url.pathname === "/api/backups/schedules" && req.method === "POST") {
      const b = await readBody(req);
      if (b.managedDatabase) {
        // "back up this managed database": fill in its engine, project and container
        const mdb = db
          .prepare("SELECT * FROM managed_dbs WHERE id=? OR name=?")
          .get(b.managedDatabase, b.managedDatabase);
        if (!mdb) return json(res, 404, { error: "database not found" });
        Object.assign(b, {
          databaseName: mdb.name,
          dbType: mdb.engine,
          projectName: mdb.project,
          containerName: `hx_db_${mdb.name}`,
        });
      }
      try {
        return json(res, 201, backupScheduler.create(b));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/backups\/schedules\/([^/]+)$/)) &&
      req.method === "PATCH"
    ) {
      const b = await readBody(req);
      try {
        const updated = backupScheduler.update(m[1], b);
        return updated ? json(res, 200, updated) : json(res, 404, { error: "schedule not found" });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/backups\/schedules\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      return backupScheduler.remove(m[1])
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "schedule not found" });
    }
    if (
      (m = url.pathname.match(/^\/api\/backups\/schedules\/([^/]+)\/run$/)) &&
      req.method === "POST"
    ) {
      if (!backupScheduler.get(m[1])) return json(res, 404, { error: "schedule not found" });
      if (backupScheduler.active.has(m[1]))
        return json(res, 409, { error: "this schedule is already running" });
      // Dumps and drills take minutes: start the run and let the caller poll the schedule's status.
      backupScheduler.runNow(m[1]).catch(() => {});
      return json(res, 202, { ok: true, started: true });
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/verify$/)) && req.method === "POST") {
      if (!backupManager.getBackup(m[1])) return json(res, 404, { error: "Backup not found" });
      try {
        return json(res, 200, await backupManager.verifyBackup(m[1]));
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/drill$/)) && req.method === "POST") {
      if (!backupManager.getBackup(m[1])) return json(res, 404, { error: "Backup not found" });
      if (drillsInFlight.has(m[1]))
        return json(res, 409, { error: "a restore drill is already running for this backup" });
      drillsInFlight.add(m[1]);
      backupManager
        .restoreDrill(m[1])
        .catch((err) =>
          console.warn(`[backup] restore drill for ${m[1]} could not run: ${err.message}`),
        )
        .finally(() => drillsInFlight.delete(m[1]));
      return json(res, 202, { ok: true, started: true });
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)$/)) && req.method === "GET") {
      const bkp = backupManager.getBackup(m[1]);
      if (!bkp) return json(res, 404, { error: "Backup not found" });
      return json(res, 200, bkp);
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)$/)) && req.method === "DELETE") {
      const result = backupManager.deleteBackup(m[1]);
      return json(res, 200, result);
    }

    // ────────── Scheduled Cron Jobs Subsystem ──────────
    if (url.pathname === "/api/jobs" && req.method === "GET") {
      return json(res, 200, cronManager.listJobs());
    }
    if (url.pathname === "/api/jobs" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const job = cronManager.createJob(b);
        return json(res, 201, job);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)) && req.method === "GET") {
      const job = cronManager.getJob(m[1]);
      if (!job) return json(res, 404, { error: "Job not found" });
      return json(res, 200, job);
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        const updated = cronManager.updateJob(m[1], b);
        return json(res, 200, updated);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)) && req.method === "DELETE") {
      const ok = cronManager.deleteJob(m[1]);
      return json(res, 200, { ok });
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/([^/]+)\/run$/)) && req.method === "POST") {
      try {
        const runRes = await cronManager.executeJob(m[1], "manual");
        return json(res, 200, runRes);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/([^/]+)\/runs$/)) && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 50);
      return json(res, 200, cronManager.listJobRuns(m[1], limit));
    }
    if (url.pathname === "/api/jobs-runs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 50);
      return json(res, 200, cronManager.listJobRuns(null, limit));
    }
    if ((m = url.pathname.match(/^\/api\/jobs\/runs\/([^/]+)$/)) && req.method === "GET") {
      const run = cronManager.getJobRun(m[1]);
      if (!run) return json(res, 404, { error: "Run record not found" });
      return json(res, 200, run);
    }

    // ────────── Model Context Protocol (MCP) for AI Agents ──────────
    if ((url.pathname === "/api/mcp" || url.pathname === "/mcp") && req.method === "POST") {
      const b = await readBody(req);
      const rpcRes = await mcpServer.handleJsonRpc(b, {
        level: scopesLevel(callerScopes(req) || []),
      });
      return json(res, 200, rpcRes);
    }
    if ((url.pathname === "/api/mcp" || url.pathname === "/mcp") && req.method === "GET") {
      return json(res, 200, {
        mcp: "2024-11-05",
        server: "HosteraX Autonomous Engine",
        version: ENGINE_VERSION,
        endpoint: "/api/mcp",
        transport: "JSON-RPC 2.0 (HTTP POST)",
        capabilities: { tools: true, resources: true, prompts: true },
        toolsCount: mcpServer.tools.length,
      });
    }

    // ────────── Multi-Node Compute Infrastructure (Servers) ──────────
    if (url.pathname === "/api/servers" && req.method === "GET") {
      return json(res, 200, serverManager.listServers());
    }
    if (url.pathname === "/api/servers" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const srv = serverManager.createServer(b);
        return json(res, 201, srv);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)\/test$/)) && req.method === "POST") {
      try {
        const testRes = await serverManager.testServerConnection(m[1]);
        return json(res, 200, testRes);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)\/host-key$/)) && req.method === "GET") {
      try {
        return json(res, 200, await serverManager.scanHostKey(m[1]));
      } catch (err) {
        return json(res, err.code === "no_ssh_client" ? 501 : 502, {
          error: err.message,
          code: err.code,
        });
      }
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)\/host-key$/)) && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(
          res,
          200,
          await serverManager.pinHostKey(m[1], {
            fingerprint: b.fingerprint,
            replace: b.replace === true,
          }),
        );
      } catch (err) {
        return json(res, err.code === "fingerprint_mismatch" ? 409 : 400, {
          error: err.message,
          code: err.code,
        });
      }
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)\/bootstrap$/)) && req.method === "GET") {
      const script = serverManager.getBootstrapScript(m[1]);
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(script);
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)$/)) && req.method === "GET") {
      const srv = serverManager.getServer(m[1]);
      if (!srv) return json(res, 404, { error: "Server not found" });
      return json(res, 200, srv);
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        const updated = serverManager.updateServer(m[1], b);
        return json(res, 200, updated);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/servers\/([^/]+)$/)) && req.method === "DELETE") {
      try {
        const ok = serverManager.deleteServer(m[1]);
        return json(res, 200, { ok });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // ────────── GitHub Webhooks & Ephemeral PR Previews ──────────
    if (
      (url.pathname === "/api/webhooks/github" ||
        (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhooks\/github$/))) &&
      req.method === "POST"
    ) {
      const projectName = m ? m[1] : null;
      const event = req.headers["x-github-event"] || "push";
      const sig = req.headers["x-hub-signature-256"] || "";
      const rawText = await readRawBody(req);

      let payload = {};
      try {
        payload = JSON.parse(rawText);
      } catch {}

      try {
        const result = await webhookManager.handleGitHubWebhook({
          event,
          payload,
          rawBodyText: rawText,
          signatureHeader: sig,
          projectName,
        });
        return json(res, 200, result);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook-config$/)) &&
      req.method === "GET"
    ) {
      const cfg = webhookManager.getProjectWebhookConfig(m[1]);
      return json(res, 200, cfg);
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook-config$/)) &&
      req.method === "POST"
    ) {
      const b = await readBody(req);
      const updated = webhookManager.updateProjectWebhookConfig(m[1], b);
      return json(res, 200, updated);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/previews$/)) && req.method === "GET") {
      return json(res, 200, webhookManager.listPreviews(m[1]));
    }
    if (url.pathname === "/api/previews" && req.method === "GET") {
      return json(res, 200, webhookManager.listPreviews());
    }
    if ((m = url.pathname.match(/^\/api\/previews\/([^/]+)$/)) && req.method === "DELETE") {
      const ok = webhookManager.deletePreview(m[1]);
      return json(res, 200, { ok });
    }

    // ────────── Multi-Tenant Organizations & RBAC ──────────
    if (url.pathname === "/api/orgs" && req.method === "GET") {
      return json(res, 200, orgManager.listOrganizations());
    }
    if (url.pathname === "/api/orgs" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const org = orgManager.createOrganization(b);
        return json(res, 201, org);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/members$/)) && req.method === "GET") {
      return json(res, 200, orgManager.listMembers(m[1]));
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/members$/)) && req.method === "POST") {
      const b = await readBody(req);
      try {
        const updated = orgManager.addMember(m[1], b);
        return json(res, 201, updated);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)$/)) &&
      req.method === "PATCH"
    ) {
      const b = await readBody(req);
      try {
        const updated = orgManager.updateMemberRole(m[1], m[2], b.role);
        return json(res, 200, updated);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      try {
        const ok = orgManager.removeMember(m[1], m[2]);
        return json(res, 200, { ok });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/invites$/)) && req.method === "POST") {
      const b = await readBody(req);
      try {
        const proto = req.headers["x-forwarded-proto"] || "http";
        const invite = orgManager.createInvite(m[1], b, `${proto}://${req.headers.host}`);
        return json(res, 201, invite);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/invites\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      const ok = orgManager.revokeInvite(m[1], m[2]);
      return json(res, 200, { ok });
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)$/)) && req.method === "GET") {
      const org = orgManager.getOrganization(m[1]);
      if (!org) return json(res, 404, { error: "Organization not found" });
      return json(res, 200, org);
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        const updated = orgManager.updateOrganization(m[1], b);
        return json(res, 200, updated);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/orgs\/([^/]+)$/)) && req.method === "DELETE") {
      try {
        const ok = orgManager.deleteOrganization(m[1]);
        return json(res, 200, { ok });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // ────────── Self-Hosted Email Stack & Webmail ──────────
    if (url.pathname === "/api/email/domains" && req.method === "GET") {
      return json(res, 200, emailManager.listDomains());
    }
    if (url.pathname === "/api/email/domains" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.domain) return json(res, 400, { error: "domain required" });
      const dom = emailManager.addDomain(b.domain);
      return json(res, 201, dom);
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/domains\/([^/]+)\/verify-dns$/)) &&
      req.method === "POST"
    ) {
      try {
        const dom = await emailManager.verifyLiveDns(m[1]);
        return json(res, 200, dom);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/email\/domains\/([^/]+)$/)) && req.method === "GET") {
      const dom = emailManager.getDomain(m[1]);
      if (!dom) return json(res, 404, { error: "Domain not found" });
      return json(res, 200, dom);
    }
    if ((m = url.pathname.match(/^\/api\/email\/domains\/([^/]+)$/)) && req.method === "DELETE") {
      try {
        const ok = emailManager.deleteDomain(m[1]);
        return json(res, 200, { ok });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (url.pathname === "/api/email/mailboxes" && req.method === "GET") {
      const domId = url.searchParams.get("domain_id");
      return json(res, 200, emailManager.listMailboxes(domId));
    }
    if (url.pathname === "/api/email/mailboxes" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const mbox = emailManager.createMailbox(b);
        return json(res, 201, mbox);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/email\/mailboxes\/([^/]+)$/)) && req.method === "DELETE") {
      const ok = emailManager.deleteMailbox(m[1]);
      return json(res, 200, { ok });
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/mailboxes\/([^/]+)\/messages$/)) &&
      req.method === "GET"
    ) {
      const folder = url.searchParams.get("folder") || "inbox";
      return json(res, 200, emailManager.listMessages(m[1], folder));
    }
    if (url.pathname === "/api/email/send" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const msg = await emailManager.sendMessage(b);
        return json(res, 201, msg);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/messages\/([^/]+)\/read$/)) &&
      req.method === "PATCH"
    ) {
      const b = await readBody(req);
      const ok = emailManager.markMessageRead(m[1], b.is_read !== false);
      return json(res, 200, { ok });
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/messages\/([^/]+)\/star$/)) &&
      req.method === "POST"
    ) {
      const resData = emailManager.toggleMessageStar(m[1]);
      return json(res, 200, resData);
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/messages\/([^/]+)\/move$/)) &&
      req.method === "POST"
    ) {
      const b = await readBody(req);
      const ok = emailManager.moveMessage(m[1], b.folder || "trash");
      return json(res, 200, { ok });
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/mailboxes\/([^/]+)\/stats$/)) &&
      req.method === "GET"
    ) {
      const stats = emailManager.getMailboxStats(m[1]);
      return json(res, 200, stats);
    }
    if ((m = url.pathname.match(/^\/api\/email\/messages\/([^/]+)$/)) && req.method === "DELETE") {
      const ok = emailManager.deleteMessage(m[1]);
      return json(res, 200, { ok });
    }

    // ────────── Email Aliases & Inbound Forwarding ──────────
    if (url.pathname === "/api/email/aliases" && req.method === "GET") {
      const domId = url.searchParams.get("domain_id");
      return json(res, 200, emailManager.listAliases(domId));
    }
    if (url.pathname === "/api/email/aliases" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const alias = emailManager.createAlias(b);
        return json(res, 201, alias);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/aliases\/([^/]+)\/test$/)) &&
      req.method === "POST"
    ) {
      try {
        const testRes = await emailManager.testWebhookAlias(m[1]);
        return json(res, 200, testRes);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/email\/aliases\/([^/]+)$/)) && req.method === "DELETE") {
      const ok = emailManager.deleteAlias(m[1]);
      return json(res, 200, { ok });
    }

    // ────────── Outbound SMTP Relays ──────────
    if (url.pathname === "/api/email/smtp-relays" && req.method === "GET") {
      return json(res, 200, emailManager.listSmtpRelays());
    }
    if (url.pathname === "/api/email/smtp-relays" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const relay = emailManager.saveSmtpRelay(b);
        return json(res, 200, relay);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/email\/smtp-relays\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      const ok = emailManager.deleteSmtpRelay(m[1]);
      return json(res, 200, { ok });
    }
    if (url.pathname === "/api/email/smtp-relays/test" && req.method === "POST") {
      const b = await readBody(req);
      let relayConfig = b;
      if (b.id) {
        const stored = emailManager.db
          .prepare("SELECT * FROM email_smtp_relays WHERE id=?")
          .get(b.id);
        if (stored) {
          relayConfig = {
            ...stored,
            ...b,
            password: b.password && !b.password.includes("••") ? b.password : stored.password,
          };
        }
      }
      const testRes = await emailManager.testSmtpRelay(relayConfig);
      return json(res, 200, testRes);
    }

    // ────────── AI Container Crash Diagnostics & 1-Click Fixer ──────────
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/diagnostics$/)) &&
      req.method === "GET"
    ) {
      const proj = db.prepare("SELECT * FROM projects WHERE name=? OR id=?").get(m[1], m[1]);
      if (!proj) return json(res, 404, { error: "Project not found" });

      let logs = "";
      try {
        const logRes = runOnServer(serverOf(proj.name), () =>
          spawnSync("docker", ["logs", "--tail", "60", `hx_${proj.name}`], {
            encoding: "utf8",
          }),
        );
        logs = (logRes.stdout || "") + (logRes.stderr || "");
      } catch {}

      let faultType = "NONE";
      let severity = "low";
      let rootCause = "No active faults detected. Container status is healthy.";
      let suggestedAction = "Monitor application performance";
      let suggestedCommand = "";

      if (logs.includes("EADDRINUSE") || logs.includes("port is already allocated")) {
        faultType = "PORT_COLLISION";
        severity = "critical";
        rootCause = `Port ${proj.port || 3000} is already bound by another container or process on this host.`;
        suggestedAction =
          "Change the container upstream port in Settings to an unused port (e.g. 3001+) and redeploy.";
        suggestedCommand = `hx projects update ${proj.name} --port 3001 && hx deploy ${proj.name}`;
      } else if (
        logs.includes("DATABASE_URL") ||
        logs.includes("connect ECONNREFUSED") ||
        logs.includes("P1001")
      ) {
        faultType = "DATABASE_UNREACHABLE";
        severity = "high";
        rootCause = "Application failed to connect to its target database connection string.";
        suggestedAction =
          "Verify the DATABASE_URL environment variable and ensure the PostgreSQL / MySQL container is running.";
        suggestedCommand = `hx db list && hx deploy ${proj.name}`;
      } else if (
        logs.includes("ENOMEM") ||
        logs.includes("JavaScript heap out of memory") ||
        logs.includes("killed")
      ) {
        faultType = "OOM_KILLED";
        severity = "critical";
        rootCause = "Container was terminated by kernel due to exceeding memory resource limits.";
        suggestedAction =
          "Increase memory allocation in container resource quotas or optimize memory leaks.";
        suggestedCommand = `hx projects update ${proj.name} --memory 1024mb`;
      } else if (logs.includes("Cannot find module") || logs.includes("MODULE_NOT_FOUND")) {
        faultType = "MISSING_DEPENDENCY";
        severity = "high";
        rootCause =
          "Application failed to boot due to a missing Node.js npm package in container bundle.";
        suggestedAction =
          "Ensure package.json includes all runtime dependencies and rebuild image.";
        suggestedCommand = `hx deploy ${proj.name} --rebuild`;
      }

      return json(res, 200, {
        project: proj.name,
        container: `hx_${proj.name}`,
        fault_type: faultType,
        severity,
        root_cause: rootCause,
        suggested_action: suggestedAction,
        suggested_command: suggestedCommand,
        analyzed_lines: logs.split("\n").filter(Boolean).length,
        timestamp: Date.now(),
      });
    }

    // ────────── 1-Click Rollback ──────────
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/rollback\/([^/]+)$/)) &&
      req.method === "POST"
    ) {
      const proj = db.prepare("SELECT * FROM projects WHERE name=? OR id=?").get(m[1], m[1]);
      if (!proj) return json(res, 404, { error: "Project not found" });

      const targetDep = db
        .prepare("SELECT * FROM deployments WHERE id=? AND project=?")
        .get(m[2], proj.name);
      if (!targetDep) return json(res, 404, { error: "Target deployment revision not found" });

      const r = await runDeployment(proj.name, rollbackOptions(targetDep));
      return json(res, 200, {
        ok: true,
        message: `Rolling ${proj.name} back to revision ${targetDep.version} (${targetDep.id})`,
        deployment_id: r.id,
      });
    }

    // ────────── domains & tls ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/domains$/)) && req.method === "GET") {
      return json(
        res,
        200,
        db.prepare("SELECT * FROM domains WHERE project=? ORDER BY created_at DESC").all(m[1]),
      );
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/domains$/)) && req.method === "POST") {
      const b = await readBody(req);
      if (!b.hostname) return json(res, 400, { error: "hostname required" });
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      let hostname;
      try {
        hostname = normalizeDomain(b.hostname);
        assertDomainAvailable(db, hostname, m[1]);
      } catch (e) {
        return json(res, e.status || 400, { error: e.message });
      }
      const id = "dom_" + crypto.randomBytes(6).toString("hex");
      const challenge = "hosterax-verify-" + crypto.randomBytes(12).toString("hex");
      db.prepare(
        `INSERT INTO domains (id, project, hostname, verified, is_primary, ssl_status, ssl_expires_at, challenge_token, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(hostname) DO NOTHING`,
      ).run(id, m[1], hostname, 0, 0, "none", null, challenge, Date.now());
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { id, hostname, challenge_token: challenge });
    }
    if (url.pathname === "/api/domains" && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM domains ORDER BY created_at DESC").all());
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM domains WHERE id=?").run(m[1]);
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/verify$/)) && req.method === "POST") {
      try {
        const vResult = await tlsManager.verifyDomainDns(m[1]);
        await edgeManager.syncRoutes().catch(() => {});
        return json(res, 200, vResult);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/ssl$/)) && req.method === "POST") {
      try {
        const edgeSettings = edgeManager.getSettings();
        const sslRes = await tlsManager.provisionAcmeSsl(m[1], edgeSettings.provider);
        await edgeManager.syncRoutes().catch(() => {});
        return json(res, 200, sslRes);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (
      (m = url.pathname.match(/^\/api\/domains\/([^/]+)\/custom-ssl$/)) &&
      req.method === "POST"
    ) {
      try {
        const b = await readBody(req);
        const certRes = await tlsManager.applyCustomCertificate(m[1], b.cert_pem, b.key_pem);
        await edgeManager.syncRoutes().catch(() => {});
        return json(res, 200, certRes);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/security$/)) && req.method === "POST") {
      const b = await readBody(req);
      db.prepare("UPDATE domains SET force_https=?, hsts_enabled=? WHERE id=?").run(
        b.force_https ? 1 : 0,
        b.hsts_enabled ? 1 : 0,
        m[1],
      );
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/primary$/)) && req.method === "POST") {
      const dom = db.prepare("SELECT * FROM domains WHERE id=?").get(m[1]);
      if (!dom) return json(res, 404, { error: "domain not found" });
      db.prepare("UPDATE domains SET is_primary=0 WHERE project=?").run(dom.project);
      db.prepare("UPDATE domains SET is_primary=1 WHERE id=?").run(m[1]);
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { ok: true });
    }

    // ────────── managed databases ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/databases$/)) && req.method === "GET") {
      return json(
        res,
        200,
        db.prepare("SELECT * FROM managed_dbs WHERE project=? ORDER BY created_at DESC").all(m[1]),
      );
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/databases$/)) &&
      req.method === "POST"
    ) {
      const b = await readBody(req);
      if (!b.name || !b.engine) return json(res, 400, { error: "name and engine required" });
      const r = await provisionDatabase({
        project: m[1],
        name: b.name,
        engine: b.engine,
        sizeMb: b.size_mb,
      });
      return json(res, r.ok ? 200 : r.status || 500, r);
    }
    if (url.pathname === "/api/databases" && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM managed_dbs ORDER BY created_at DESC").all());
    }
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)$/)) && req.method === "DELETE") {
      const mdb = db.prepare("SELECT * FROM managed_dbs WHERE id=?").get(m[1]);
      if (!mdb) return json(res, 404, { error: "database not found" });
      await removeManagedDatabase(mdb);
      return json(res, 200, { ok: true });
    }

    // ────────── backups ──────────
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)\/backup$/)) && req.method === "POST") {
      const mdb = db.prepare("SELECT * FROM managed_dbs WHERE id=? OR name=?").get(m[1], m[1]);
      if (!mdb) return json(res, 404, { error: "database not found" });
      try {
        const backupResult = await backupManager.createBackup({
          databaseName: mdb.name,
          dbType: mdb.engine,
          projectName: mdb.project,
          containerName: `hx_db_${mdb.name}`,
        });
        return json(res, 200, backupResult);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    // ────────── who am I ──────────
    if (url.pathname === "/api/auth/me" && req.method === "GET") {
      const scopes = callerScopes(req) || [];
      const t = bearerFrom(req);
      const row = t ? db.prepare("SELECT name FROM tokens WHERE token=?").get(hashToken(t)) : null;
      return json(res, 200, {
        ok: true,
        role: aiRoleFor(req),
        scopes,
        local: !t && isTrustedLocalRequest(req, PORT),
        tokenName: row?.name || null,
        user: sessionOf(req)?.user ?? null,
      });
    }

    // ────────── accounts: first-run setup, self-service, user management ──────────
    // (sign-in itself, SSO and /api/auth/providers are public and live above the auth gate)
    if (url.pathname === "/api/auth/setup" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const user = accounts.bootstrapOwner({
          email: b.email,
          name: b.name,
          password: b.password,
        });
        const s = accounts.sessionForUser(user.id, {
          ip: clientIp(req),
          userAgent: req.headers["user-agent"],
          method: "setup",
        });
        return json(res, 201, { ok: true, user, token: s.token, expiresAt: s.expiresAt });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const t = bearerFrom(req);
      if (t.startsWith("hxs_")) accounts.revokeSession(t);
      return json(res, 200, { ok: true });
    }
    const needSession = () =>
      sessionOf(req)
        ? null
        : json(res, 400, { ok: false, error: "sign in with a user account to use this" });
    if (url.pathname === "/api/auth/password" && req.method === "POST") {
      if (needSession()) return;
      const b = await readBody(req);
      try {
        const ses = sessionOf(req);
        return json(res, 200, {
          ok: true,
          ...accounts.changePassword(ses.user.id, b.current, b.next, {
            keepSessionId: ses.sessionId,
          }),
        });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if (url.pathname === "/api/auth/2fa/setup" && req.method === "POST") {
      if (needSession()) return;
      try {
        return json(res, 200, { ok: true, ...accounts.beginTwoFactor(sessionOf(req).user.id) });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if (url.pathname === "/api/auth/2fa/enable" && req.method === "POST") {
      if (needSession()) return;
      const b = await readBody(req);
      try {
        return json(res, 200, {
          ok: true,
          ...accounts.enableTwoFactor(sessionOf(req).user.id, b.code),
        });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if (url.pathname === "/api/auth/2fa/disable" && req.method === "POST") {
      if (needSession()) return;
      const b = await readBody(req);
      try {
        accounts.disableTwoFactor(sessionOf(req).user.id, { password: b.password, code: b.code });
        return json(res, 200, { ok: true });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if (url.pathname === "/api/auth/events" && req.method === "GET") {
      return json(res, 200, accounts.listEvents(Number(url.searchParams.get("limit")) || 100));
    }
    if (url.pathname === "/api/users" && req.method === "GET") {
      return json(res, 200, accounts.listUsers());
    }
    if (url.pathname === "/api/users" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(
          res,
          201,
          accounts.createUser(actorOf(req), {
            email: b.email,
            name: b.name,
            role: b.role,
            password: b.password,
          }),
        );
      } catch (e) {
        return authFail(res, e);
      }
    }
    if ((m = url.pathname.match(/^\/api\/users\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        const patch = {};
        for (const k of ["name", "role", "disabled", "password"])
          if (b[k] !== undefined) patch[k] = b[k];
        return json(res, 200, accounts.updateUser(actorOf(req), m[1], patch));
      } catch (e) {
        return authFail(res, e);
      }
    }
    if ((m = url.pathname.match(/^\/api\/users\/([^/]+)$/)) && req.method === "DELETE") {
      try {
        accounts.deleteUser(actorOf(req), m[1]);
        return json(res, 200, { ok: true });
      } catch (e) {
        return authFail(res, e);
      }
    }
    if ((m = url.pathname.match(/^\/api\/users\/([^/]+)\/2fa-reset$/)) && req.method === "POST") {
      try {
        accounts.resetTwoFactor(actorOf(req), m[1]);
        return json(res, 200, { ok: true });
      } catch (e) {
        return authFail(res, e);
      }
    }

    // ────────── tokens ──────────
    if (url.pathname === "/api/tokens" && req.method === "GET") {
      const rows = db
        .prepare("SELECT token, name, created_at, scopes_json, prefix, last_used_at FROM tokens")
        .all();
      return json(
        res,
        200,
        rows.map((r) => ({
          id: r.token,
          name: r.name,
          prefix: r.prefix || "",
          created_at: r.created_at,
          last_used_at: r.last_used_at || null,
          scopes: (() => {
            try {
              return JSON.parse(r.scopes_json || '["*"]');
            } catch {
              return ["*"];
            }
          })(),
        })),
      );
    }
    if (url.pathname === "/api/tokens" && req.method === "POST") {
      const b = await readBody(req);
      const allowed = new Set(["*", "read", "deploy", "admin"]);
      const requested =
        Array.isArray(b.scopes) && b.scopes.length
          ? b.scopes.filter((x) => allowed.has(x))
          : ["read"];
      if (!requested.length)
        return json(res, 400, { error: "scopes must be read, deploy or admin" });
      // A caller can never mint a token more powerful than itself.
      if (scopesLevel(requested) > scopesLevel(callerScopes(req) || []))
        return json(res, 403, { error: "cannot grant scopes above your own" });
      const t = generateToken();
      db.prepare(
        "INSERT INTO tokens (token, name, created_at, scopes_json, prefix) VALUES (?,?,?,?,?)",
      ).run(
        hashToken(t),
        String(b.name || "token").slice(0, 80),
        Date.now(),
        JSON.stringify(requested),
        tokenPrefix(t),
      );
      return json(res, 200, { token: t, scopes: requested });
    }
    if ((m = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)) && req.method === "DELETE") {
      const remaining = db.prepare("SELECT COUNT(*) c FROM tokens WHERE token<>?").get(m[1]).c;
      if (remaining === 0)
        return json(res, 409, { error: "cannot revoke the last token — create another first" });
      db.prepare("DELETE FROM tokens WHERE token=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

    // ────────── github webhooks (config) ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook$/)) && req.method === "GET") {
      const wh = db
        .prepare("SELECT id, project, provider, branch, created_at FROM webhooks WHERE project=?")
        .get(m[1]);
      return json(res, 200, wh || null);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook$/)) && req.method === "POST") {
      const b = await readBody(req);
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      db.prepare("DELETE FROM webhooks WHERE project=?").run(m[1]);
      const id = "wh_" + crypto.randomBytes(6).toString("hex");
      const secret = crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO webhooks VALUES (?,?,?,?,?,?)").run(
        id,
        m[1],
        "github",
        secret,
        b.branch || "main",
        Date.now(),
      );
      return json(res, 200, {
        id,
        secret,
        branch: b.branch || "main",
        url: `/webhooks/github/${m[1]}`,
      });
    }

    // ────────── one-click apps (via docker) ──────────
    if (url.pathname === "/api/apps" && req.method === "GET")
      return json(
        res,
        200,
        db.prepare("SELECT * FROM installed_apps ORDER BY created_at DESC").all(),
      );
    if (url.pathname === "/api/apps" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.slug || !b.image) return json(res, 400, { error: "slug and image required" });
      const id = "app_" + crypto.randomBytes(6).toString("hex");
      const port = b.port || null;
      db.prepare("INSERT INTO installed_apps VALUES (?,?,?,?,?,?,?)").run(
        id,
        b.slug,
        b.name || b.slug,
        null,
        port,
        "installing",
        Date.now(),
      );
      // spawn docker run detached; if docker missing, mark failed
      const cname = `hx_app_${String(b.slug)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")}_${id.slice(-6)}`;
      let safeImage;
      try {
        safeImage = assertSafeImageRef(b.image);
      } catch (e) {
        db.prepare("UPDATE installed_apps SET status='failed' WHERE id=?").run(id);
        return json(res, 400, { error: e.message });
      }
      const portNum = Number(port);
      const runArgs = ["run", "-d", "--name", cname];
      if (Number.isInteger(portNum) && portNum > 0 && portNum < 65536)
        runArgs.push("-p", `${BIND_HOST}:${portNum}:${portNum}`);
      runArgs.push(safeImage);
      const child = spawn("docker", runArgs);
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
      child.on("close", (code) => {
        const status = code === 0 ? "running" : "failed";
        // Store the (stable) container name, never raw docker output.
        db.prepare("UPDATE installed_apps SET status=?, container_id=? WHERE id=?").run(
          status,
          code === 0 ? cname : null,
          id,
        );
      });
      child.on("error", () => {
        db.prepare("UPDATE installed_apps SET status='failed' WHERE id=?").run(id);
      });
      return json(res, 200, { id, slug: b.slug });
    }
    if ((m = url.pathname.match(/^\/api\/apps\/([^/]+)$/)) && req.method === "DELETE") {
      const app = db.prepare("SELECT * FROM installed_apps WHERE id=?").get(m[1]);
      if (app?.container_id) {
        try {
          if (isSafeContainerName(app.container_id)) {
            const c = spawn("docker", ["rm", "-f", app.container_id]);
            c.on("error", () => {});
          }
        } catch {}
      }
      db.prepare("DELETE FROM installed_apps WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/network/interfaces" && req.method === "GET") {
      const interfaces = os.networkInterfaces();
      const list = [];
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === "IPv4" && !iface.internal) {
            list.push({
              name,
              address: iface.address,
              netmask: iface.netmask,
              mac: iface.mac,
            });
          }
        }
      }
      return json(res, 200, {
        ok: true,
        primaryIp: list[0]?.address || "127.0.0.1",
        interfaces: list,
      });
    }

    // GET /api/system/gpu - Live NVIDIA GPU and VRAM Telemetry
    if (url.pathname === "/api/system/gpu" && req.method === "GET") {
      const data = await gpuManager.getGpuMetrics();
      return json(res, 200, data);
    }

    // POST /api/ai/vram-check - Pre-flight VRAM estimation for AI models
    if (url.pathname === "/api/ai/vram-check" && req.method === "POST") {
      const b = await readBody(req);
      const data = await gpuManager.checkVramRequirement(
        b.modelName || "",
        b.customRequirementMb || null,
      );
      return json(res, 200, data);
    }

    // Scale-to-Zero Configuration
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/scale-to-zero$/))) {
      const projectName = decodeURIComponent(m[1]);
      if (req.method === "GET") {
        const cfg = scaleToZeroManager.getConfig(projectName);
        return json(res, 200, cfg);
      }
      if (req.method === "POST") {
        if (serverOf(projectName)) return json(res, 400, { error: SCALE_TO_ZERO_REMOTE });
        const b = await readBody(req);
        const cfg = scaleToZeroManager.setConfig(projectName, {
          enabled: Boolean(b.enabled),
          idleTimeoutMinutes: Number(b.idleTimeoutMinutes) || 15,
        });
        return json(res, 200, cfg);
      }
    }

    // Manual Sleep & Wake
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/sleep$/)) && req.method === "POST") {
      const projectName = decodeURIComponent(m[1]);
      if (serverOf(projectName)) return json(res, 400, { error: SCALE_TO_ZERO_REMOTE });
      const r = await scaleToZeroManager.sleepProject(projectName);
      return json(res, r.ok ? 200 : 400, r);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/wake$/)) && req.method === "POST") {
      const projectName = decodeURIComponent(m[1]);
      if (serverOf(projectName)) return json(res, 400, { error: SCALE_TO_ZERO_REMOTE });
      const r = await scaleToZeroManager.wakeProject(projectName);
      return json(res, r.ok ? 200 : 400, r);
    }

    // ────────── AIOps Conversational Platform Control & Diagnostics ──────────
    if (url.pathname === "/api/ai/chat" && req.method === "POST") {
      const b = await readBody(req);
      // The role comes from the caller's token — never from the request body.
      const userRole = aiRoleFor(req);
      const userEmail = String(b.userEmail || "admin@hosterax.local").slice(0, 120);
      const r = await aiOpsManager.handleChatTurn({
        prompt: b.prompt,
        conversationHistory: b.conversationHistory || [],
        userRole,
        userEmail,
        confirmedAction: b.confirmedAction || null,
      });
      return json(res, 200, r);
    }

    if (url.pathname === "/api/ai/diagnose" && req.method === "POST") {
      const b = await readBody(req);
      const r = await aiOpsManager.diagnoseProject(b.projectName);
      return json(res, 200, r);
    }

    if (url.pathname === "/api/ai/execute-fix" && req.method === "POST") {
      const b = await readBody(req);
      const userRole = aiRoleFor(req);
      if (!aiOpsManager.checkPermission(userRole, "write")) {
        return json(res, 403, {
          success: false,
          error:
            "RBAC Permission Denied: Only operators or admins can execute automated remediations.",
        });
      }
      const r = await aiOpsManager.executeAutoFix(b.projectName, b.fixType, b.parameters);
      return json(res, r.success ? 200 : 400, r);
    }

    if (url.pathname === "/api/ai/config") {
      if (req.method === "GET") {
        return json(res, 200, aiOpsManager.getConfig());
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        const cfg = aiOpsManager.updateConfig(b);
        return json(res, 200, cfg);
      }
    }

    if (await dashboard.handle(req, res, url.pathname)) return;
    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: String(e) });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("deployment");
  const token = url.searchParams.get("token");
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return ws.close();
  // Auth check: require a valid token or a genuinely local, same-origin client
  const isValidToken = String(token || "").startsWith("hxs_")
    ? !!accounts.resolveSession(token)
    : !!db.prepare("SELECT 1 FROM tokens WHERE token=?").get(hashToken(token || ""));
  if (!isValidToken && !isTrustedLocalRequest(req, PORT)) return ws.close();
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(ws);
  // replay
  const p = path.join(LOGDIR, id + ".log");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n").filter(Boolean)) {
      try {
        ws.send(JSON.stringify({ deploymentId: id, ts: Date.now(), stream: "replay", text: line }));
      } catch {}
    }
  }
  ws.on("close", () => subscribers.get(id)?.delete(ws));
});

server.listen(PORT, () => {
  console.log(`HosteraX engine listening on http://localhost:${PORT}`);
  selfHeal.start();
  backupScheduler.start();
  tunnelManager.start();
  serverManager.start();
  gateManager.start().catch(() => {});
});

// ── Global Process Resilience & Crash Traps ──
process.on("uncaughtException", (err) => {
  console.error(`[hosterax-engine][CRITICAL] Uncaught Exception:`, err);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[hosterax-engine][WARN] Unhandled Rejection:`, reason);
});

// ── Graceful Shutdown Handler ──
function handleGracefulShutdown(signal) {
  console.log(`\n[hosterax-engine] Received ${signal}. Starting graceful shutdown...`);
  try {
    selfHeal?.stop?.();
    scaleToZeroManager?.stop?.();
    backupScheduler.stop();
    tunnelManager.stop();
    serverManager.stop().catch(() => {});
    gateManager.stop().catch(() => {});
    dashboard.close();
    server.close(() => {
      console.log("[hosterax-engine] HTTP server closed.");
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
        db.close();
        console.log("[hosterax-engine] Database safely flushed and closed.");
      } catch {}
      process.exit(0);
    });
    setTimeout(() => {
      console.warn("[hosterax-engine] Forced shutdown after timeout.");
      process.exit(0);
    }, 5000).unref();
  } catch (err) {
    console.error("[hosterax-engine] Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
