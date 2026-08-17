#!/usr/bin/env node
// HosteraX engine daemon. Real HTTP+WS server; spawns real deploys.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import { createProjectsApi, initProjectsSchema } from "./projects-api.mjs";
import { createCatalogApi } from "./catalog-api.mjs";
import {
  DETECTORS,
  STACK_REGISTRY,
  detectStackDir,
  detectPackageManager,
  detectWorkspace,
} from "./stack-registry.mjs";
import { SelfHealEngine } from "./self-heal.mjs";
import { pullWithUniversalHealing } from "./image-resolver.mjs";
import { TLSManager } from "./tls-manager.mjs";
import { EdgeManager } from "./edge-manager.mjs";
import { BackupManager } from "./backup-manager.mjs";

const HOME = process.env.HOSTERAX_HOME
  ? path.resolve(process.env.HOSTERAX_HOME)
  : path.join(os.homedir(), ".hosterax");
const WORK = path.join(HOME, "work");
const LOGDIR = path.join(HOME, "logs");
const EDGEDIR = path.join(HOME, "edge");
for (const d of [HOME, WORK, LOGDIR, EDGEDIR]) fs.mkdirSync(d, { recursive: true });

const db = new Database(path.join(HOME, "hosterax.db"));
db.pragma("journal_mode = WAL");
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
CREATE TABLE IF NOT EXISTS backup_schedules (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 1440,
  retention INTEGER NOT NULL DEFAULT 7,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
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

function getMagicDnsHost(projectName) {
  const provider = getSetting("magic_dns_provider", "sslip.io");
  const p = MAGIC_DNS_PROVIDERS[provider] || MAGIC_DNS_PROVIDERS["sslip.io"];
  return p.format(projectName);
}

initProjectsSchema(db);

// Clean up stale in-flight deployments from previous engine sessions/restarts
try {
  db.prepare(
    `
    UPDATE deployments 
    SET phase='failed', finished_at=?, exit_code=1 
    WHERE phase IN ('queued', 'building', 'pulling', 'deploying', 'fetching')
  `,
  ).run(Date.now());
} catch {}

// bootstrap token
const tokenCount = db.prepare("SELECT COUNT(*) c FROM tokens").get().c;
if (tokenCount === 0) {
  const t = "hxt_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO tokens (token, name, created_at, scopes_json) VALUES (?,?,?,?)").run(
    t,
    "bootstrap",
    Date.now(),
    JSON.stringify(["*"]),
  );
  console.log("\n╭─ HosteraX Engine ─────────────────────────────╮");
  console.log("│ Bootstrap token (save this):                  │");
  console.log("│ " + t.padEnd(45) + " │");
  console.log("╰───────────────────────────────────────────────╯\n");
}

// ---------- rate limiter ----------
const rateLimiter = new Map(); // ip -> { count, resetAt }
function rateLimit(req, maxRequests = 60, windowMs = 60000) {
  const ip = req.socket?.remoteAddress || "unknown";
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

// On engine startup, inspect running docker containers starting with hx_ and track them
try {
  const cp = spawnSync("docker", ["ps", "--filter", "name=hx_", "--format", "{{.Names}}"], {
    shell: true,
  });
  if (cp.stdout) {
    const lines = cp.stdout.toString().trim().split("\n");
    for (const l of lines) {
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
  }
} catch {}

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
export function allocateProjectPort(projectName, preferredPort = null) {
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
    const usedPorts = new Set([7777, 8080]);

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

// ---------- edge routing (applied AFTER the app is live) ----------
const tlsManager = new TLSManager(db, EDGEDIR);
const edgeManager = new EdgeManager(db, HOME, tlsManager);
const backupManager = new BackupManager({ db, HOME });

// Initial route synchronization and edge container check
edgeManager.syncRoutes().catch((e) => console.error("[edge] initial sync:", e.message));

function applyRoute(project, port, hostname, id) {
  const now = Date.now();
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
  return tag.replace(/[^a-zA-Z0-9._/:@-]/g, "");
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

function runGitClone(deploymentId, cwd, url, targetDir) {
  return new Promise((resolve) => {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `$ git clone --depth 1 ${url} ${targetDir}`,
    });
    const child = spawn("git", ["clone", "--depth", "1", url, targetDir], {
      cwd,
      env: { ...process.env },
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

async function fetchSource(deploymentId, source, workdir, target) {
  fs.mkdirSync(workdir, { recursive: true });
  if (
    target === "docker" &&
    source &&
    !fs.existsSync(source) &&
    !/^https?:|^git@|\.git$/.test(source)
  ) {
    // Direct Docker image deployment (One-Click App as project)
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[docker] Container image target: ${source}`,
    });
    return 0;
  }
  if (/^https?:|^git@|\.git$/.test(source)) {
    const safeSource = source.replace(/['";`$()!]/g, "");
    const targetDir = path.basename(workdir).replace(/['";`$()!]/g, "");
    return runGitClone(deploymentId, path.dirname(workdir), safeSource, targetDir);
  }
  const abs = path.resolve(source);
  if (!fs.existsSync(abs)) {
    publish(deploymentId, { ts: Date.now(), stream: "stderr", text: "source not found: " + abs });
    return 1;
  }
  const safeAbs = abs.replace(/['";`$()!]/g, "");
  const safeWorkdir = workdir.replace(/['";`$()!]/g, "");
  const cmd =
    process.platform === "win32"
      ? `xcopy "${safeAbs}" "${safeWorkdir}" /E /I /Y /Q`
      : `cp -R '${safeAbs}/.' '${safeWorkdir}/'`;
  return runStep(deploymentId, path.dirname(workdir), cmd, {});
}

function generateZeroConfigDockerfile(workdir) {
  // Node.js / TypeScript / Fullstack
  if (fs.existsSync(path.join(workdir, "package.json"))) {
    return `# Zero-config Dockerfile generated by HosteraX for Node.js
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN if grep -q '"build":' package.json; then npm run build || true; fi

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app ./
EXPOSE 3000
CMD ["sh", "-c", "if [ -d 'build' ]; then serve -s build -l tcp://0.0.0.0:3000; elif [ -d 'dist' ]; then serve -s dist -l tcp://0.0.0.0:3000; elif [ -d '.next' ]; then npm start || npx next start -p 3000; elif [ -f 'server.js' ]; then node server.js; elif [ -f 'app.js' ]; then node app.js; elif [ -f 'index.js' ]; then node index.js; else npm start; fi"]
`;
  }

  // Go (golang)
  if (fs.existsSync(path.join(workdir, "go.mod")) || fs.existsSync(path.join(workdir, "main.go"))) {
    return `# Zero-config Multi-Stage Dockerfile generated by HosteraX for Go
FROM golang:alpine AS builder
WORKDIR /app
RUN apk --no-cache add git ca-certificates
COPY go.* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server . || CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server ./cmd/... || CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server ./...

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates tzdata ttyd
COPY --from=builder /app/server ./server
ENV TERM=xterm-256color
EXPOSE 8080
CMD ttyd -p 8080 -W ./server
`;
  }

  // Rust (Cargo)
  if (fs.existsSync(path.join(workdir, "Cargo.toml"))) {
    return `# Zero-config Multi-Stage Dockerfile generated by HosteraX for Rust
FROM rust:alpine AS builder
WORKDIR /app
RUN apk --no-cache add musl-dev
COPY . .
RUN cargo build --release

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates tzdata ttyd
COPY --from=builder /app/target/release/* /app/
EXPOSE 8080
CMD ttyd -p 8080 -W sh -c "$(find /app -maxdepth 1 -type f -executable | head -n 1)"
`;
  }

  // Python
  if (
    fs.existsSync(path.join(workdir, "requirements.txt")) ||
    fs.existsSync(path.join(workdir, "pyproject.toml")) ||
    fs.existsSync(path.join(workdir, "Pipfile")) ||
    fs.existsSync(path.join(workdir, "main.py")) ||
    fs.existsSync(path.join(workdir, "app.py"))
  ) {
    return `# Zero-config Dockerfile generated by HosteraX for Python
FROM python:3.11-slim
WORKDIR /app
COPY requirements*.txt Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "if [ -f 'main.py' ]; then python main.py; elif [ -f 'app.py' ]; then python app.py; else uvicorn main:app --host 0.0.0.0 --port \${PORT:-8000}; fi"]
`;
  }

  // PHP
  if (
    fs.existsSync(path.join(workdir, "composer.json")) ||
    fs.existsSync(path.join(workdir, "index.php"))
  ) {
    return `# Zero-config Dockerfile generated by HosteraX for PHP
FROM php:8.2-apache
WORKDIR /var/www/html
COPY . /var/www/html/
RUN if [ -f composer.json ]; then curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer && composer install --no-dev; fi
EXPOSE 80
`;
  }

  // Fallback static Dockerfile
  return `# Fallback static Dockerfile generated by HosteraX
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;
}

const staticServers = new Map(); // project -> http.Server

function stopProject(project, reason = "manual stop") {
  const cleanName = project.toLowerCase().replace(/[^a-z0-9]/g, "_");
  try {
    spawn("docker", ["rm", "-f", `hx_${cleanName}`]);
  } catch {}
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
  if (target === "compose") {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: "docker compose up -d" });
    return runStep(deploymentId, workdir, "docker compose up -d --build", env);
  }
  if (target === "docker") {
    const cleanName = project.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const projRow = db.prepare("SELECT * FROM projects WHERE name=?").get(project);
    const isDirectImage =
      projRow?.source &&
      !fs.existsSync(projRow.source) &&
      !/^https?:|^git@|\.git$/.test(projRow.source);
    const WELL_KNOWN_IMAGES = {
      ollama: "ollama/ollama:latest",
      "ollama/ollama": "ollama/ollama:latest",
      vaultwarden: "vaultwarden/server:latest",
      bitwarden: "vaultwarden/server:latest",
      nginx: "nginx:alpine",
      caddy: "caddy:latest",
      redis: "redis:alpine",
      postgres: "postgres:alpine",
      postgresql: "postgres:alpine",
      mariadb: "mariadb:latest",
      mysql: "mysql:8.4",
      grafana: "grafana/grafana:latest",
      prometheus: "prom/prometheus:latest",
      uptimekuma: "louislam/uptime-kuma:latest",
      "uptime-kuma": "louislam/uptime-kuma:latest",
      n8n: "n8nio/n8n:latest",
      portainer: "portainer/portainer-ce:latest",
      dockge: "louislam/dockge:latest",
      traefik: "traefik:v3.1",
      jellyfin: "jellyfin/jellyfin:latest",
      immich: "ghcr.io/immich-app/immich-server:latest",
      paperless: "ghcr.io/paperless-ngx/paperless-ngx:latest",
      "paperless-ngx": "ghcr.io/paperless-ngx/paperless-ngx:latest",
      plausible: "plausible/analytics:latest",
      umami: "ghcr.io/umami-software/umami:postgresql-latest",
      ghost: "ghost:alpine",
      searxng: "searxng/searxng:latest",
      calibre: "linuxserver/calibre-web:latest",
      audiobookshelf: "ghcr.io/advplyr/audiobookshelf:latest",
      "it-tools": "corentinth/it-tools:latest",
      ittools: "corentinth/it-tools:latest",
    };

    let tag = isDirectImage ? projRow.source : `hosterax/${cleanName}:latest`;

    // Smart image tag normalization
    if (isDirectImage) {
      const rawTrimmed = tag.trim();
      const cleanKey = rawTrimmed.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const baseName = rawTrimmed.split(":")[0];
      const baseKey = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      if (WELL_KNOWN_IMAGES[cleanKey]) {
        tag = WELL_KNOWN_IMAGES[cleanKey];
      } else if (WELL_KNOWN_IMAGES[baseKey]) {
        tag = WELL_KNOWN_IMAGES[baseKey];
      } else if (tag.endsWith(`:${cleanName}`) || tag.endsWith(`:${project.toLowerCase()}`)) {
        tag = `${tag.split(":")[0]}:latest`;
      } else if (!tag.includes(":")) {
        tag = `${tag}:latest`;
      }
    }

    let imageInspect = { exposedPorts: [], volumes: [], env: [] };

    if (isDirectImage) {
      const pullRes = await pullWithUniversalHealing({
        deploymentId,
        workdir,
        initialTag: tag,
        projectName: project,
        publish,
        runStep,
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
      let bc = await runStep(
        deploymentId,
        workdir,
        `docker build -t ${sanitizeImageTag(tag)} .`,
        env,
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
        bc = await runStep(
          deploymentId,
          workdir,
          `docker build -t ${sanitizeImageTag(tag)} .`,
          env,
        );
      }

      if (bc !== 0) return bc;
      imageInspect = inspectDockerImage(tag);
    }

    try {
      await runStep(deploymentId, workdir, `docker rm -f hx_${cleanName}`, {});
    } catch {}

    // Auto-discover container internal port using smart HTTP port prioritization
    let containerInternalPort = 3000;
    if (imageInspect.exposedPorts && imageInspect.exposedPorts.length > 0) {
      containerInternalPort = pickPrimaryHttpPort(imageInspect.exposedPorts);
    } else if (port && port !== 3000) {
      containerInternalPort = port;
    } else if (projRow?.port && projRow.port !== 3000) {
      containerInternalPort = projRow.port;
    }

    // Allocate verified free host port
    const hostPort = allocateProjectPort(project, containerInternalPort);
    try {
      db.prepare("UPDATE projects SET port=? WHERE name=?").run(hostPort, project);
    } catch {}

    // Persistent volume mappings
    // Persistent volume mappings (use reliable Docker Named Volumes for cross-platform stability)
    let volFlags = "";
    if (imageInspect.volumes && imageInspect.volumes.length > 0) {
      for (const v of imageInspect.volumes) {
        const safeVolKey = v.replace(/[^a-zA-Z0-9_-]/g, "_");
        const namedVol = `hx_vol_${cleanName}_${safeVolKey}`;
        volFlags += ` -v ${namedVol}:${v}`;
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
      volFlags += ` -v hx_config_${cleanName}:/app/config`;
    }

    const envFlags = Object.entries(dockerEnv)
      .map(([k, v]) => {
        const valStr = String(v ?? "");
        const cleanVal = valStr.replace(/^"(.*)"$/, "$1");
        return `-e ${k}=${cleanVal}`;
      })
      .join(" ");

    // Custom startup command overrides for images requiring arguments
    let extraArgs = "";
    if (cmd && cmd.trim() && !cmd.startsWith("serve-static:")) {
      extraArgs = " " + cmd.trim();
    } else if (tag.includes("minio")) {
      extraArgs = " server /data --console-address :9001";
    } else if (tag.includes("airflow")) {
      extraArgs = " standalone";
    }

    let portFlag = `-p 0.0.0.0:${hostPort}:${containerInternalPort}`;
    if (imageInspect.exposedPorts && imageInspect.exposedPorts.length > 1) {
      for (const p of imageInspect.exposedPorts) {
        if (p !== containerInternalPort) {
          const secondaryHostPort = allocateProjectPort(`${project}_p${p}`, p);
          portFlag += ` -p 127.0.0.1:${secondaryHostPort}:${p}`;
        }
      }
    } else if (tag.includes("minio")) {
      const consoleHostPort = allocateProjectPort(`${project}_console`, 9001);
      portFlag += ` -p 127.0.0.1:${consoleHostPort}:9001`;
    }

    const runCmd = `docker run -d --init --name hx_${cleanName} --restart unless-stopped --add-host host.docker.internal:host-gateway ${portFlag}${volFlags} ${envFlags} ${sanitizeImageTag(tag)}${extraArgs}`;
    publish(deploymentId, { ts: Date.now(), stream: "system", text: runCmd });
    const rc = await runStep(deploymentId, workdir, runCmd, {});
    if (rc === 0) {
      if (glanceConfigFile && fs.existsSync(glanceConfigFile)) {
        try {
          await runStep(
            deploymentId,
            workdir,
            `docker cp "${glanceConfigFile}" hx_${cleanName}:/app/config/glance.yml`,
            {},
          );
          await runStep(deploymentId, workdir, `docker restart hx_${cleanName}`, {});
        } catch {}
      }
      running.set(project, {
        child: { pid: process.pid },
        stopped: false,
        startedAt: Date.now(),
        cmd: runCmd,
        workdir,
        env,
        policy: "always",
      });
    }
    return rc;
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
}

async function runDeployment(project, opts = {}) {
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
  const env = { ...JSON.parse(p.env_json || "{}") };
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
        const code = await fetchSource(id, p.source, workdir, p.target);
        if (code !== 0) {
          setPhase(id, "failed", { finished_at: Date.now(), exit_code: code });
          return;
        }

        const det = detectStack(workdir, p, id);
        finalStartCmd = det.start_cmd || p.start_cmd;
        finalPort = allocateProjectPort(project, p.port || det.port || 3000);
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
function authOk(req) {
  const h = req.headers.authorization || "";
  const t = h.replace(/^Bearer\s+/i, "");
  if (!t) {
    const ip = req.socket?.remoteAddress || "";
    const isLoopback =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip.includes("127.0.0.1") ||
      req.headers.host?.startsWith("localhost") ||
      req.headers.host?.startsWith("127.0.0.1");
    if (isLoopback) return true;
    return false;
  }
  return !!db.prepare("SELECT 1 FROM tokens WHERE token=?").get(t);
}

function requirePerm(req, perm) {
  const h = req.headers.authorization || "";
  const t = h.replace(/^Bearer\s+/i, "");
  const ip = req.socket?.remoteAddress || "";
  const isLoopback =
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.includes("127.0.0.1") ||
    req.headers.host?.startsWith("localhost") ||
    req.headers.host?.startsWith("127.0.0.1");
  if (isLoopback) return true;
  if (!t) return false;
  const row = db.prepare("SELECT scopes_json FROM tokens WHERE token=?").get(t);
  if (!row) return false;
  const scopes = JSON.parse(row.scopes_json || "[]");
  return scopes.includes("*") || scopes.includes(perm);
}

const projectsApi = createProjectsApi({
  db,
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
});

const catalogApi = createCatalogApi({ db, HOME, readBody });

const selfHeal = new SelfHealEngine({
  db,
  publish: (project, msg) => {
    const dep = db
      .prepare("SELECT id FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
      .get(project);
    if (dep?.id) publish(dep.id, msg);
  },
  restartService: async (project) => {
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
          JSON.parse(p.env_json || "{}"),
          p.target,
          p.port || 3000,
        );
      } else {
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
          `0.0.0.0:${hostPort}:80`,
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
          JSON.parse(p.env_json || "{}"),
          p.target,
          p.port || 3000,
        );
      }
    }
  },
  rollbackService: async (project, targetDeployId) => {
    const targetDeploy = db.prepare("SELECT * FROM deployments WHERE id=?").get(targetDeployId);
    if (!targetDeploy) return;
    const snap = targetDeploy.snapshot_json ? JSON.parse(targetDeploy.snapshot_json) : null;
    await runDeployment(project, {
      rollbackFrom: { version: targetDeploy.version, workdir: targetDeploy.workdir },
      snap,
      trigger: "self-heal-auto-rollback",
    });
  },
  HOME,
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { ok: true, version: "0.2.0" });
  // Rate limit: 60 req/min for auth endpoints, 120/min for others
  const isAuthEndpoint = url.pathname.startsWith("/api/auth") || url.pathname === "/api/token";
  if (rateLimit(req, isAuthEndpoint ? 10 : 120)) {
    return json(res, 429, { error: "too many requests" });
  }
  if (await catalogApi(req, res, url.pathname)) return;
  if (url.pathname === "/api/token" && req.method === "GET") {
    if (!authOk(req)) return json(res, 403, { error: "forbidden" });
    const bToken = db.prepare("SELECT token FROM tokens LIMIT 1").get();
    return json(res, 200, { token: bToken?.token || "" });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const b = await readBody(req);
    const bToken = db.prepare("SELECT token FROM tokens LIMIT 1").get()?.token || "";
    if (
      b.token &&
      (b.token === bToken || db.prepare("SELECT 1 FROM tokens WHERE token=?").get(b.token))
    ) {
      return json(res, 200, {
        ok: true,
        user: { id: "admin-local", email: b.email || "admin@hosterax.local", role: "admin" },
        token: b.token,
      });
    }
    return json(res, 401, { ok: false, error: "invalid token" });
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

  // GitHub webhook — public but HMAC-verified
  if (url.pathname.startsWith("/webhooks/github/") && req.method === "POST") {
    const project = url.pathname.split("/").pop();
    const wh = db.prepare("SELECT * FROM webhooks WHERE project=?").get(project);
    if (!wh) return json(res, 404, { error: "no webhook configured" });
    let raw = "";
    req.on("data", (c) => (raw += c));
    return req.on("end", async () => {
      const sig = req.headers["x-hub-signature-256"] || "";
      const expected = "sha256=" + crypto.createHmac("sha256", wh.secret).update(raw).digest("hex");
      const a = Buffer.from(sig),
        b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return json(res, 401, { error: "bad signature" });
      try {
        const payload = JSON.parse(raw);
        const branch = (payload.ref || "").replace("refs/heads/", "");
        if (branch !== wh.branch) return json(res, 200, { skipped: true, branch });
        const r = await runDeployment(project, { trigger: "git" });
        return json(res, 200, { deployed: r.id });
      } catch (e) {
        return json(res, 500, { error: String(e) });
      }
    });
  }

  if (!authOk(req)) return json(res, 401, { error: "unauthorized" });

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
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/heal$/)) && req.method === "POST") {
      const p = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      await selfHeal.probeAndHealProject(p);
      return json(res, 200, selfHeal.getStatusSummary().projects[m[1]] || { status: "unknown" });
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
      return json(res, 200, db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
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
        JSON.stringify(b.env || {}),
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
      db.prepare("DELETE FROM projects WHERE name=?").run(projName);
      db.prepare("DELETE FROM deployments WHERE project=?").run(projName);
      db.prepare("DELETE FROM domains WHERE project=?").run(projName);
      db.prepare("DELETE FROM managed_dbs WHERE project=?").run(projName);
      selfHeal.untrack(projName);
      try {
        spawnSync("docker", ["rm", "-f", `hx_${cleanName}`], { timeout: 5000 });
      } catch {}
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
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env$/)) && req.method === "GET") {
      const p = db.prepare("SELECT env_json FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      return json(res, 200, JSON.parse(p.env_json || "{}"));
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env$/)) && req.method === "POST") {
      const b = await readBody(req);
      const p = db.prepare("SELECT env_json FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      let current = JSON.parse(p.env_json || "{}");
      if (b.env && typeof b.env === "object") {
        current = b.env;
      } else if (b.key) {
        current[b.key] = b.value ?? "";
      }
      db.prepare("UPDATE projects SET env_json=? WHERE name=?").run(JSON.stringify(current), m[1]);
      return json(res, 200, { ok: true, env: current });
    }
    if (
      (m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env\/([^/]+)$/)) &&
      req.method === "DELETE"
    ) {
      const p = db.prepare("SELECT env_json FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      const current = JSON.parse(p.env_json || "{}");
      delete current[m[2]];
      db.prepare("UPDATE projects SET env_json=? WHERE name=?").run(JSON.stringify(current), m[1]);
      return json(res, 200, { ok: true, env: current });
    }
    if (
      (m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/)) &&
      req.method === "POST"
    ) {
      const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      if (!d) return json(res, 404, { error: "not found" });
      const r = await runDeployment(d.project, {
        trigger: "rollback",
        rollbackFrom: { version: d.version, workdir: d.workdir },
      });
      return json(res, 200, r);
    }
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/)) && req.method === "GET") {
      const p = path.join(LOGDIR, m[1] + ".log");
      const text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
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
      const env1 = p1 ? JSON.parse(p1.env_json || "{}") : {};
      const env2 = p2 ? JSON.parse(p2.env_json || "{}") : {};
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
      const updated = edgeManager.updateSettings(b);
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
        const bkp = await backupManager.createBackup(b);
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
      const stat = fs.statSync(bkp.file_path);
      const filename = path.basename(bkp.file_path);
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      const readStream = fs.createReadStream(bkp.file_path);
      return readStream.pipe(res);
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
      const id = "dom_" + crypto.randomBytes(6).toString("hex");
      const challenge = "hosterax-verify-" + crypto.randomBytes(12).toString("hex");
      db.prepare(
        `INSERT INTO domains (id, project, hostname, verified, is_primary, ssl_status, ssl_expires_at, challenge_token, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(id, m[1], b.hostname, 0, 0, "none", null, challenge, Date.now());
      await edgeManager.syncRoutes().catch(() => {});
      return json(res, 200, { id, hostname: b.hostname, challenge_token: challenge });
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
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      const id = "mdb_" + crypto.randomBytes(6).toString("hex");
      db.prepare("INSERT INTO managed_dbs VALUES (?,?,?,?,?,?,?,?)").run(
        id,
        m[1],
        b.name,
        b.engine,
        b.size_mb || 1024,
        "provisioning",
        null,
        Date.now(),
      );
      // Simulate provisioning
      setTimeout(() => {
        const port =
          b.engine === "postgres"
            ? 5432
            : b.engine === "mysql"
              ? 3306
              : b.engine === "mongodb"
                ? 27017
                : 6379;
        const conn = `${b.engine}://hx:${crypto.randomBytes(8).toString("hex")}@localhost:${port}/${b.name}`;
        db.prepare("UPDATE managed_dbs SET status='running', connection_string=? WHERE id=?").run(
          conn,
          id,
        );
      }, 3000);
      return json(res, 200, { id, name: b.name, engine: b.engine });
    }
    if (url.pathname === "/api/databases" && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM managed_dbs ORDER BY created_at DESC").all());
    }
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)$/)) && req.method === "DELETE") {
      const mdb = db.prepare("SELECT name FROM managed_dbs WHERE id=?").get(m[1]);
      if (mdb) db.prepare("DELETE FROM backups WHERE database_name=?").run(mdb.name);
      db.prepare("DELETE FROM managed_dbs WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

    // ────────── backups ──────────
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)\/backup$/)) && req.method === "POST") {
      const mdb = db.prepare("SELECT * FROM managed_dbs WHERE id=?").get(m[1]);
      if (!mdb) return json(res, 404, { error: "database not found" });
      const id = "bkp_" + Math.floor(1000 + Math.random() * 9000);
      const sizeMb = parseFloat((mdb.size_mb * (0.6 + Math.random() * 0.4)).toFixed(1));
      // Generate deterministic SHA256 based on backup metadata
      const hashInput = `${id}|${m[1]}|${sizeMb}|${Date.now()}`;
      const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
      db.prepare(
        "INSERT INTO backups (id, project_name, database_name, db_type, file_path, file_size_bytes, sha256, destination, status, created_at, finished_at, error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        mdb.project,
        mdb.name,
        mdb.engine,
        "",
        Math.round(sizeMb * 1024 * 1024),
        hash,
        "local",
        "pending",
        Date.now(),
        null,
        null,
      );
      // Simulate backup completion
      setTimeout(() => {
        db.prepare("UPDATE backups SET status='completed' WHERE id=?").run(id);
      }, 2500);
      return json(res, 200, {
        id,
        database: mdb.name,
        engine: mdb.engine,
        size_mb: sizeMb,
        sha256: hash,
        status: "pending",
      });
    }
    if (url.pathname === "/api/backups" && req.method === "GET") {
      const rows = db
        .prepare(
          `
        SELECT b.*, d.name as db_name, d.engine as db_engine, d.project
        FROM backups b JOIN managed_dbs d ON b.database_id = d.id
        ORDER BY b.created_at DESC
      `,
        )
        .all();
      return json(res, 200, rows);
    }
    if ((m = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/)) && req.method === "POST") {
      const bkp = db.prepare("SELECT * FROM backups WHERE id=?").get(m[1]);
      if (!bkp) return json(res, 404, { error: "backup not found" });
      if (bkp.status !== "completed") return json(res, 400, { error: "backup not yet completed" });
      const mdb = db.prepare("SELECT * FROM managed_dbs WHERE id=?").get(bkp.database_id);
      // Simulate restore
      db.prepare("UPDATE managed_dbs SET status='restoring' WHERE id=?").run(bkp.database_id);
      setTimeout(() => {
        db.prepare("UPDATE managed_dbs SET status='running' WHERE id=?").run(bkp.database_id);
      }, 3000);
      return json(res, 200, {
        ok: true,
        message: `Restoring ${mdb?.name ?? "database"} from snapshot ${m[1]}`,
      });
    }

    // ────────── tokens ──────────
    if (url.pathname === "/api/tokens" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT token, name, created_at FROM tokens").all());
    if (url.pathname === "/api/tokens" && req.method === "POST") {
      const b = await readBody(req);
      const t = "hxt_" + crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO tokens (token, name, created_at, scopes_json) VALUES (?,?,?,?)").run(
        t,
        b.name || "token",
        Date.now(),
        JSON.stringify(Array.isArray(b.scopes) && b.scopes.length ? b.scopes : ["*"]),
      );
      return json(res, 200, { token: t });
    }
    if ((m = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)) && req.method === "DELETE") {
      if (!requirePerm(req, "token:delete")) return json(res, 403, { error: "forbidden" });
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
      const cname = `hx_app_${b.slug.replace(/[^a-z0-9]/g, "_")}_${id.slice(-6)}`;
      const safeImage = sanitizeImageTag(b.image);
      const portFlag = port ? `-p ${port}:${port}` : "";
      const cmd = `docker run -d --name ${cname} ${portFlag} ${safeImage}`;
      const child = spawn(
        process.platform === "win32" ? "cmd.exe" : "sh",
        process.platform === "win32" ? ["/c", cmd] : ["-c", cmd],
      );
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (out += d.toString()));
      child.on("close", (code) => {
        const status = code === 0 ? "running" : "failed";
        db.prepare("UPDATE installed_apps SET status=?, container_id=? WHERE id=?").run(
          status,
          out.trim().slice(0, 64),
          id,
        );
      });
      return json(res, 200, { id, slug: b.slug });
    }
    if ((m = url.pathname.match(/^\/api\/apps\/([^/]+)$/)) && req.method === "DELETE") {
      const app = db.prepare("SELECT * FROM installed_apps WHERE id=?").get(m[1]);
      if (app?.container_id) {
        spawn(
          process.platform === "win32" ? "cmd.exe" : "sh",
          process.platform === "win32"
            ? ["/c", `docker rm -f ${app.container_id}`]
            : ["-c", `docker rm -f ${app.container_id}`],
        );
      }
      db.prepare("DELETE FROM installed_apps WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

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
  if (!id) return ws.close();
  // Auth check: require valid token or loopback
  const t = token || "";
  const isValidToken = !!db.prepare("SELECT 1 FROM tokens WHERE token=?").get(t);
  const ip = req.socket?.remoteAddress || "";
  const isLoopback =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.includes("127.0.0.1");
  if (!isValidToken && !isLoopback) return ws.close();
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

const PORT = Number(process.env.HOSTERAX_PORT || 7777);
server.listen(PORT, () => {
  console.log(`HosteraX engine listening on http://localhost:${PORT}`);
  selfHeal.start();
});
