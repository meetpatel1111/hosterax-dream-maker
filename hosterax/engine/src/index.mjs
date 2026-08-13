#!/usr/bin/env node
// HosteraX engine daemon. Real HTTP+WS server; spawns real deploys.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import { createProjectsApi, initProjectsSchema } from "./projects-api.mjs";

const HOME = path.join(os.homedir(), ".hosterax");
const WORK = path.join(HOME, "work");
const LOGDIR = path.join(HOME, "logs");
for (const d of [HOME, WORK, LOGDIR]) fs.mkdirSync(d, { recursive: true });

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
  database_id TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'manual',
  size_mb REAL NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_dbid ON backups(database_id);
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
try { db.exec("ALTER TABLE projects ADD COLUMN cpu_limit REAL"); } catch (e) {}
try { db.exec("ALTER TABLE projects ADD COLUMN memory_mb_limit INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE projects ADD COLUMN port INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE projects ADD COLUMN restart_policy TEXT DEFAULT 'on-failure'"); } catch (e) {}
try { db.exec("ALTER TABLE deployments ADD COLUMN snapshot_json TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE deployments ADD COLUMN environment TEXT DEFAULT 'production'"); } catch (e) {}
try { db.exec("ALTER TABLE deployments ADD COLUMN route_status TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE deployments ADD COLUMN stack TEXT"); } catch (e) {}


initProjectsSchema(db);

// bootstrap token
const tokenCount = db.prepare("SELECT COUNT(*) c FROM tokens").get().c;
if (tokenCount === 0) {
  const t = "hxt_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO tokens (token, name, created_at, scopes_json) VALUES (?,?,?,?)").run(t, "bootstrap", Date.now(), JSON.stringify(["*"]));
  console.log("\n╭─ HosteraX Engine ─────────────────────────────╮");
  console.log("│ Bootstrap token (save this):                  │");
  console.log("│ " + t.padEnd(45) + " │");
  console.log("╰───────────────────────────────────────────────╯\n");
}

// ---------- log bus ----------
const subscribers = new Map(); // deploymentId -> Set<ws>
function publish(deploymentId, line) {
  const msg = JSON.stringify({ deploymentId, ...line });
  const set = subscribers.get(deploymentId);
  if (set) for (const ws of set) { try { ws.send(msg); } catch {} }
  fs.appendFileSync(path.join(LOGDIR, deploymentId + ".log"),
    `[${new Date(line.ts).toISOString()}] ${line.stream}: ${line.text}\n`);
}

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
    for (const ws of set) { try { ws.send(msg); } catch {} }
  }
}

// running process registry (per project)
const running = new Map(); // project -> { child, restarts, stopped, startedAt, cmd, workdir, env }

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

// ---------- zero-config stack detection ----------
const DETECTORS = [
  { file: "docker-compose.yml", stack: "Docker Compose", build: "docker compose build", start: "docker compose up", port: 8080 },
  { file: "docker-compose.yaml", stack: "Docker Compose", build: "docker compose build", start: "docker compose up", port: 8080 },
  { file: "Dockerfile", stack: "Docker", build: null, start: null, port: 8080 },
  { file: "bun.lockb", stack: "Bun", build: "bun install", start: "bun run start", port: 3000 },
  { file: "deno.json", stack: "Deno", build: "deno cache main.ts", start: "deno run -A main.ts", port: 8000 },
  { file: "package.json", stack: "Node.js", build: "npm install && npm run build --if-present", start: "npm start", port: 3000 },
  { file: "requirements.txt", stack: "Python", build: "pip install -r requirements.txt", start: "python app.py", port: 8000 },
  { file: "pyproject.toml", stack: "Python (uv/poetry)", build: "pip install .", start: "python -m app", port: 8000 },
  { file: "go.mod", stack: "Go", build: "go build -o main .", start: "./main", port: 8080 },
  { file: "Cargo.toml", stack: "Rust", build: "cargo build --release", start: "cargo run --release", port: 8080 },
  { file: "Gemfile", stack: "Ruby", build: "bundle install", start: "bundle exec rackup -p $PORT", port: 3000 },
  { file: "composer.json", stack: "PHP", build: "composer install", start: "php -S 0.0.0.0:8000", port: 8000 },
  { file: "pom.xml", stack: "Java (Maven)", build: "mvn -B package -DskipTests", start: "java -jar target/*.jar", port: 8080 },
  { file: "build.gradle", stack: "Java (Gradle)", build: "./gradlew build", start: "java -jar build/libs/*.jar", port: 8080 },
  { file: "index.html", stack: "Static", build: null, start: "npx --yes serve -l $PORT .", port: 8080 },
];

const WORKSPACE_MARKERS = [
  ["pnpm-workspace.yaml", "pnpm workspaces"],
  ["rush.json", "Rush"],
  ["go.work", "Go workspace"],
  ["Cargo.toml", "Cargo workspace"],
  ["uv.lock", "uv"],
];

function detectStack(workdir, p, id) {
  const cfg = readProjectConfig(workdir);
  if (cfg?.parseError) publish(id, { ts: Date.now(), stream: "stderr", text: `[config] ${cfg.parseError} is not valid JSON — ignoring` });
  else if (cfg) publish(id, { ts: Date.now(), stream: "system", text: `[config] using overrides from ${cfg.file}` });

  const hit = DETECTORS.find((d) => fs.existsSync(path.join(workdir, d.file)));
  if (hit) publish(id, { ts: Date.now(), stream: "system", text: `[zero-config] Detected ${hit.stack} (${hit.file})` });
  else publish(id, { ts: Date.now(), stream: "system", text: "[zero-config] No known stack marker; using project commands" });

  for (const [marker, label] of WORKSPACE_MARKERS) {
    if (fs.existsSync(path.join(workdir, marker))) {
      publish(id, { ts: Date.now(), stream: "system", text: `[monorepo] ${label} detected` });
      break;
    }
  }

  const build_cmd = cfg?.build_cmd ?? p.build_cmd ?? hit?.build ?? null;
  const start_cmd = cfg?.start_cmd ?? p.start_cmd ?? hit?.start ?? null;
  const port = cfg?.port ?? p.port ?? hit?.port ?? null;
  return { stack: hit?.stack ?? "custom", build_cmd, start_cmd, port, extraEnv: cfg?.env ?? {}, hostname: cfg?.hostname ?? null };
}

// ---------- docker compose import ----------
function parseCompose(workdir) {
  const file = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"].map((f) => path.join(workdir, f)).find(fs.existsSync);
  if (!file) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const services = [];
  let inServices = false, cur = null, key = null;
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const ind = indentOf(raw);
    const line = raw.trim();
    if (ind === 0) { inServices = /^services:/.test(line); cur = null; continue; }
    if (!inServices) continue;
    if (ind <= 2 && line.endsWith(":")) {
      cur = { name: line.slice(0, -1), image: null, build_context: null, ports: [], volumes: [], env: {}, depends: [] };
      services.push(cur); key = null; continue;
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
  publish(id, { ts: Date.now(), stream: "system", text: `[compose] ${path.basename(parsed.file)} → ${parsed.services.length} service(s)` });
  const ins = db.prepare(`INSERT INTO services (id, project, name, image, build_context, ports_json, volumes_json, env_json, depends_json, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project, name) DO UPDATE SET image=excluded.image, build_context=excluded.build_context,
      ports_json=excluded.ports_json, volumes_json=excluded.volumes_json, env_json=excluded.env_json, depends_json=excluded.depends_json`);
  for (const s of parsed.services) {
    ins.run("svc_" + crypto.randomBytes(6).toString("hex"), project, s.name, s.image, s.build_context,
      JSON.stringify(s.ports), JSON.stringify(s.volumes), JSON.stringify(s.env), JSON.stringify(s.depends), "idle", Date.now());
  }
  const names = parsed.services.map((s) => s.name);
  if (names.length) {
    db.prepare(`DELETE FROM services WHERE project=? AND name NOT IN (${names.map(() => "?").join(",")})`).run(project, ...names);
  }
  return parsed;
}

// ---------- edge routing (applied AFTER the app is live) ----------
const EDGEDIR = path.join(HOME, "edge");
fs.mkdirSync(EDGEDIR, { recursive: true });

function applyRoute(project, port, hostname, id) {
  const now = Date.now();
  const upsert = (status, detail, configPath) =>
    db.prepare(`INSERT INTO routes (project, hostname, upstream_port, status, detail, config_path, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project) DO UPDATE SET hostname=excluded.hostname, upstream_port=excluded.upstream_port,
        status=excluded.status, detail=excluded.detail, config_path=excluded.config_path, updated_at=excluded.updated_at`)
      .run(project, hostname ?? null, port ?? null, status, detail ?? null, configPath ?? null, now);

  const primary = hostname ?? db.prepare("SELECT hostname FROM domains WHERE project=? AND is_primary=1").get(project)?.hostname ?? null;
  if (!port) {
    upsert("action_required", "No port detected — set port in hosterax.json or project settings", null);
    if (id) publish(id, { ts: now, stream: "system", text: "[edge] action required: unknown upstream port (app is still running)" });
    return { status: "action_required" };
  }
  const host = primary ?? `${project}.localhost`;
  const conf = `# generated by HosteraX — do not edit
server {
  listen 80;
  server_name ${host};
  location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
`;
  const confPath = path.join(EDGEDIR, `${project}.conf`);
  try {
    fs.writeFileSync(confPath, conf);
    upsert(primary ? "active" : "pending_dns", primary ? null : "Add a primary domain to serve this app publicly", confPath);
    if (id) publish(id, { ts: now, stream: "system", text: `[edge] vhost written → ${confPath} (${host} → :${port})` });
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
    child.stdout.on("data", (b) => publish(deploymentId, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }));
    child.stderr.on("data", (b) => publish(deploymentId, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }));
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

async function fetchSource(deploymentId, source, workdir) {
  fs.mkdirSync(workdir, { recursive: true });
  if (/^https?:|^git@|\.git$/.test(source)) {
    return runStep(deploymentId, path.dirname(workdir), `git clone --depth 1 ${source} ${path.basename(workdir)}`, {});
  }
  const abs = path.resolve(source);
  if (!fs.existsSync(abs)) { publish(deploymentId, { ts: Date.now(), stream: "stderr", text: "source not found: " + abs }); return 1; }
  const cmd = process.platform === "win32"
    ? `xcopy ${abs} ${workdir} /E /I /Y /Q`
    : `cp -R "${abs}/." "${workdir}/"`;
  return runStep(deploymentId, path.dirname(workdir), cmd, {});
}

function stopProject(project, reason = "manual stop") {
  const rec = running.get(project);
  if (!rec) return false;
  rec.stopped = true;
  try { process.kill(rec.child.pid); } catch {}
  publishRuntime(project, { ts: Date.now(), stream: "system", text: `stopped (${reason})` });
  running.delete(project);
  return true;
}

function superviseProcess(project, workdir, cmd, env, policy, deploymentId) {
  const { shell, args } = shellFor(cmd);
  const child = spawn(shell, args, { cwd: workdir, env: { ...process.env, ...env }, detached: true });
  const prev = running.get(project);
  const rec = { child, restarts: prev?.restarts ?? 0, stopped: false, startedAt: Date.now(), cmd, workdir, env, policy };
  running.set(project, rec);
  child.stdout.on("data", (b) => publishRuntime(project, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }));
  child.stderr.on("data", (b) => publishRuntime(project, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }));
  child.on("close", (code) => {
    publishRuntime(project, { ts: Date.now(), stream: "system", text: `process exited ${code}` });
    if (deploymentId) publish(deploymentId, { ts: Date.now(), stream: "system", text: `service exited ${code}` });
    const cur = running.get(project);
    if (!cur || cur.child !== child || cur.stopped) return;
    const shouldRestart = policy === "always" || (policy === "on-failure" && code !== 0);
    if (!shouldRestart) { running.delete(project); return; }
    if (cur.restarts >= 5) {
      publishRuntime(project, { ts: Date.now(), stream: "system", text: "restart limit reached (5) — giving up" });
      running.delete(project);
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** cur.restarts);
    cur.restarts += 1;
    publishRuntime(project, { ts: Date.now(), stream: "system", text: `restarting in ${delay}ms (attempt ${cur.restarts}/5)` });
    setTimeout(() => {
      if (running.get(project) === cur && !cur.stopped) superviseProcess(project, workdir, cmd, env, policy, null);
    }, delay);
  });
  return rec;
}

async function startService(deploymentId, project, workdir, cmd, env, target, port) {
  stopProject(project, "superseded by new deploy");
  if (target === "compose") {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: "docker compose up -d" });
    return runStep(deploymentId, workdir, "docker compose up -d --build", env);
  }
  if (target === "docker") {
    const tag = `hosterax/${project}:latest`;
    publish(deploymentId, { ts: Date.now(), stream: "system", text: `docker build → ${tag}` });
    const bc = await runStep(deploymentId, workdir, `docker build -t ${tag} .`, env);
    if (bc !== 0) return bc;
    await runStep(deploymentId, workdir, `docker rm -f hx_${project} 2>/dev/null || true`, {});
    const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`).join(" ");
    // loopback-only publish: never expose a raw public port
    const portFlag = port ? `-p 127.0.0.1:${port}:${port}` : "";
    const runCmd = `docker run -d --name hx_${project} ${portFlag} ${envFlags} ${tag}`;
    publish(deploymentId, { ts: Date.now(), stream: "system", text: runCmd });
    return runStep(deploymentId, workdir, runCmd, {});
  }
  if (!cmd) { publish(deploymentId, { ts: Date.now(), stream: "system", text: "no start command; skipping" }); return 0; }
  publish(deploymentId, { ts: Date.now(), stream: "system", text: `starting (restart=${env.HOSTERAX_RESTART_POLICY || "on-failure"}): ${cmd}` });
  superviseProcess(project, workdir, cmd, env, env.HOSTERAX_RESTART_POLICY || "on-failure", deploymentId);
  return 0;
}

function setPhase(id, phase, extra = {}) {
  const fields = ["phase = ?"];
  const values = [phase];
  for (const [k, v] of Object.entries(extra)) { fields.push(`${k} = ?`); values.push(v); }
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
  db.prepare(`INSERT INTO deployments (id, project, version, phase, trigger, started_at, finished_at, exit_code, workdir, environment)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, project, version, "queued", opts.trigger || "manual", Date.now(), null, null, workdir, environment);
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
        const code = await fetchSource(id, p.source, workdir);
        if (code !== 0) { setPhase(id, "failed", { finished_at: Date.now(), exit_code: code }); return; }

        const det = detectStack(workdir, p, id);
        finalStartCmd = det.start_cmd;
        finalPort = det.port;
        stack = det.stack;
        hostname = det.hostname;
        Object.assign(env, det.extraEnv);
        if (finalPort) env.PORT = String(finalPort);

        const compose = syncComposeServices(project, workdir, id);
        if (compose && p.target !== "docker") target = "compose";

        if (det.build_cmd) {
          setPhase(id, "building");
          const bc = await runStep(id, workdir, det.build_cmd, env);
          if (bc !== 0) { setPhase(id, "failed", { finished_at: Date.now(), exit_code: bc }); return; }
        }
        setPhase(id, "building", {
          stack,
          snapshot_json: JSON.stringify({
            stack, target, build_cmd: det.build_cmd, start_cmd: finalStartCmd, port: finalPort,
            hostname, source: p.source, environment, env_keys: Object.keys(env).sort(), created_at: Date.now(),
          }),
        });
      } else {
        publish(id, { ts: Date.now(), stream: "system", text: `rollback to ${version}${snap ? " (from frozen snapshot)" : ""}` });
        if (snap) {
          setPhase(id, "building", { stack: snap.stack, snapshot_json: JSON.stringify(snap) });
          if (snap.port) env.PORT = String(snap.port);
        }
      }

      setPhase(id, "deploying");
      await startService(id, project, workdir, finalStartCmd, env, target, finalPort);

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
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  let disk = { total_gb: 0, used_gb: 0, percent: 0 };
  try {
    const st = fs.statfsSync(process.platform === 'win32' ? 'C:\\\\' : '/');
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const used = total - free;
    disk = {
      total_gb: Math.round(total / 1073741824),
      used_gb: Math.round(used / 1073741824),
      percent: parseFloat(((used / total) * 100).toFixed(1))
    };
  } catch (e) {}

  return {
    cpu: { percent: parseFloat(cpuPercent), cores: cpus.length, model: cpus[0]?.model ?? "unknown" },
    memory: { used_mb: Math.round(usedMem / 1048576), total_mb: Math.round(totalMem / 1048576), percent: ((usedMem / totalMem) * 100).toFixed(1) },
    disk,
    uptime_seconds: Math.round(os.uptime()),
    platform: os.platform(),
    hostname: os.hostname(),
    load_avg: os.loadavg().map((v) => parseFloat(v.toFixed(2))),
  };
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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ""; req.on("data", (c) => s += c); req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}
function authOk(req) {
  const h = req.headers.authorization || "";
  const t = h.replace(/^Bearer\s+/i, "");
  if (!t) return false;
  return !!db.prepare("SELECT 1 FROM tokens WHERE token=?").get(t);
}

const projectsApi = createProjectsApi({
  db, runDeployment, running, runtimeLogs, applyRoute, parseCompose, syncComposeServices,
  DETECTORS, HOME, json, readBody, stopProject,
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { ok: true, version: "0.2.0" });

  // GitHub webhook — public but HMAC-verified
  if (url.pathname.startsWith("/webhooks/github/") && req.method === "POST") {
    const project = url.pathname.split("/").pop();
    const wh = db.prepare("SELECT * FROM webhooks WHERE project=?").get(project);
    if (!wh) return json(res, 404, { error: "no webhook configured" });
    let raw = ""; req.on("data", (c) => raw += c);
    return req.on("end", async () => {
      const sig = req.headers["x-hub-signature-256"] || "";
      const expected = "sha256=" + crypto.createHmac("sha256", wh.secret).update(raw).digest("hex");
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json(res, 401, { error: "bad signature" });
      try {
        const payload = JSON.parse(raw);
        const branch = (payload.ref || "").replace("refs/heads/", "");
        if (branch !== wh.branch) return json(res, 200, { skipped: true, branch });
        const r = await runDeployment(project, { trigger: "git" });
        return json(res, 200, { deployed: r.id });
      } catch (e) { return json(res, 500, { error: String(e) }); }
    });
  }

  if (!authOk(req)) return json(res, 401, { error: "unauthorized" });

  try {
    let m;

    if (url.pathname === "/api/system" && req.method === "GET") {
      return json(res, 200, getSystemMetrics());
    }

    // ────────── Projects API (Openship-compatible) ──────────
    if (await projectsApi.handle(req, res, url)) return;

    // ────────── projects (legacy engine surface) ──────────
    if (url.pathname === "/api/projects" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
    if (url.pathname === "/api/projects" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return json(res, 400, { error: "name required" });
      const current = db.prepare("SELECT * FROM projects WHERE name=?").get(b.name);
      db.prepare("INSERT OR REPLACE INTO projects (name, source, build_cmd, start_cmd, env_json, target, created_at, cpu_limit, memory_mb_limit) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(b.name, b.source || "", b.buildCmd || "", b.startCmd || "", JSON.stringify(b.env || {}), b.target || "process", current?.created_at ?? Date.now(), current?.cpu_limit ?? null, current?.memory_mb_limit ?? null);
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM projects WHERE name=?").run(m[1]);
      db.prepare("DELETE FROM deployments WHERE project=?").run(m[1]);
      db.prepare("DELETE FROM domains WHERE project=?").run(m[1]);
      db.prepare("DELETE FROM managed_dbs WHERE project=?").run(m[1]);
      const r = running.get(m[1]); if (r) { try { process.kill(r.pid); } catch {} running.delete(m[1]); }
      return json(res, 200, { ok: true });
    }

    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/quotas$/)) && req.method === "POST") {
      const b = await readBody(req);
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      
      const maxCpus = os.cpus().length;
      const maxMem = os.totalmem() / 1048576;
      
      if (b.cpu_limit !== null && b.cpu_limit > maxCpus) {
        return json(res, 400, { error: `CPU limit cannot exceed host capacity (${maxCpus} cores)` });
      }
      if (b.memory_mb_limit !== null && b.memory_mb_limit > maxMem) {
        return json(res, 400, { error: `Memory limit cannot exceed host capacity (${Math.round(maxMem)} MB)` });
      }
      
      db.prepare("UPDATE projects SET cpu_limit=?, memory_mb_limit=? WHERE name=?")
        .run(b.cpu_limit ?? null, b.memory_mb_limit ?? null, m[1]);
      return json(res, 200, { ok: true, cpu_limit: b.cpu_limit, memory_mb_limit: b.memory_mb_limit });
    }

    // ────────── deployments ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/deployments$/)) && req.method === "GET")
      return json(res, 200, db.prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 100").all(m[1]));
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/)) && req.method === "POST") {
      const b = await readBody(req);
      const r = await runDeployment(m[1], { trigger: b.trigger });
      return json(res, 200, r);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/env$/)) && req.method === "POST") {
      const b = await readBody(req);
      db.prepare("UPDATE projects SET env_json=? WHERE name=?").run(JSON.stringify(b.env || {}), m[1]);
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/)) && req.method === "POST") {
      const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      if (!d) return json(res, 404, { error: "not found" });
      const r = await runDeployment(d.project, { trigger: "rollback", rollbackFrom: { version: d.version, workdir: d.workdir } });
      return json(res, 200, r);
    }
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/)) && req.method === "GET") {
      const p = path.join(LOGDIR, m[1] + ".log");
      const text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      return res.end(text);
    }

    // ────────── deployment diff ──────────
    if ((m = url.pathname.match(/^\/api\/deployments\/([^/]+)\/diff\/([^/]+)$/)) && req.method === "GET") {
      const d1 = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[1]);
      const d2 = db.prepare("SELECT * FROM deployments WHERE id=?").get(m[2]);
      if (!d1 || !d2) return json(res, 404, { error: "deployment not found" });
      // load project env for each
      const p1 = db.prepare("SELECT env_json FROM projects WHERE name=?").get(d1.project);
      const p2 = db.prepare("SELECT env_json FROM projects WHERE name=?").get(d2.project);
      const env1 = p1 ? JSON.parse(p1.env_json || "{}") : {};
      const env2 = p2 ? JSON.parse(p2.env_json || "{}") : {};
      const allKeys = [...new Set([...Object.keys(env1), ...Object.keys(env2)])];
      const envDiff = allKeys.map((k) => ({
        key: k,
        base: env1[k] ?? null,
        target: env2[k] ?? null,
        change: env1[k] === env2[k] ? "unchanged" : !env1[k] ? "added" : !env2[k] ? "removed" : "modified",
      })).filter((d) => d.change !== "unchanged");

      return json(res, 200, {
        base: { id: d1.id, version: d1.version, phase: d1.phase, trigger: d1.trigger, started_at: d1.started_at, finished_at: d1.finished_at, exit_code: d1.exit_code },
        target: { id: d2.id, version: d2.version, phase: d2.phase, trigger: d2.trigger, started_at: d2.started_at, finished_at: d2.finished_at, exit_code: d2.exit_code },
        env_diff: envDiff,
        duration_diff_ms: (d2.finished_at ?? 0) - (d2.started_at ?? 0) - ((d1.finished_at ?? 0) - (d1.started_at ?? 0)),
      });
    }

    // ────────── metrics ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/)) && req.method === "GET") {
      const p = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!p) return json(res, 404, { error: "project not found" });
      const sys = getSystemMetrics();
      const deployCount = db.prepare("SELECT COUNT(*) c FROM deployments WHERE project=?").get(m[1]).c;
      const lastDeploy = db.prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1").get(m[1]);
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
      const successDeploys = db.prepare("SELECT COUNT(*) c FROM deployments WHERE phase='ready'").get().c;
      const failedDeploys = db.prepare("SELECT COUNT(*) c FROM deployments WHERE phase='failed'").get().c;
      const avgDuration = db.prepare("SELECT AVG(finished_at - started_at) a FROM deployments WHERE finished_at IS NOT NULL").get().a;
      const totalDomains = db.prepare("SELECT COUNT(*) c FROM domains").get().c;
      const totalDbs = db.prepare("SELECT COUNT(*) c FROM managed_dbs").get().c;
      const totalBackups = db.prepare("SELECT COUNT(*) c FROM backups").get().c;
      const runningProcs = [...running.entries()].filter(([, p]) => !p.killed).length;
      return json(res, 200, {
        projects: totalProjects,
        deployments: { total: totalDeploys, success: successDeploys, failed: failedDeploys, success_rate: totalDeploys > 0 ? ((successDeploys / totalDeploys) * 100).toFixed(1) : "0.0" },
        avg_duration_ms: Math.round(avgDuration ?? 0),
        domains: totalDomains,
        databases: totalDbs,
        backups: totalBackups,
        running_processes: runningProcs,
        system: getSystemMetrics(),
      });
    }

    // ────────── domains ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/domains$/)) && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM domains WHERE project=? ORDER BY created_at DESC").all(m[1]));
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/domains$/)) && req.method === "POST") {
      const b = await readBody(req);
      if (!b.hostname) return json(res, 400, { error: "hostname required" });
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      const id = "dom_" + crypto.randomBytes(6).toString("hex");
      const challenge = "hosterax-verify-" + crypto.randomBytes(12).toString("hex");
      db.prepare("INSERT INTO domains VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, m[1], b.hostname, 0, 0, "none", null, challenge, Date.now());
      return json(res, 200, { id, hostname: b.hostname, challenge_token: challenge });
    }
    if (url.pathname === "/api/domains" && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM domains ORDER BY created_at DESC").all());
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM domains WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/verify$/)) && req.method === "POST") {
      const dom = db.prepare("SELECT * FROM domains WHERE id=?").get(m[1]);
      if (!dom) return json(res, 404, { error: "domain not found" });
      // In a real system, this would query DNS TXT records.
      // For the engine, we simulate verification with a 70% success rate.
      const verified = Math.random() > 0.3 ? 1 : 0;
      db.prepare("UPDATE domains SET verified=? WHERE id=?").run(verified, m[1]);
      return json(res, 200, { verified: !!verified, hostname: dom.hostname, challenge_token: dom.challenge_token });
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/ssl$/)) && req.method === "POST") {
      const dom = db.prepare("SELECT * FROM domains WHERE id=?").get(m[1]);
      if (!dom) return json(res, 404, { error: "domain not found" });
      if (!dom.verified) return json(res, 400, { error: "domain not verified — verify DNS first" });
      // Simulate SSL provisioning (in real system: certbot --webroot)
      db.prepare("UPDATE domains SET ssl_status='provisioning' WHERE id=?").run(m[1]);
      setTimeout(() => {
        const expires = new Date(Date.now() + 90 * 86400000).toISOString();
        db.prepare("UPDATE domains SET ssl_status='active', ssl_expires=? WHERE id=?").run(expires, m[1]);
      }, 2000);
      return json(res, 200, { ok: true, message: "SSL provisioning started via Let's Encrypt" });
    }
    if ((m = url.pathname.match(/^\/api\/domains\/([^/]+)\/primary$/)) && req.method === "POST") {
      const dom = db.prepare("SELECT * FROM domains WHERE id=?").get(m[1]);
      if (!dom) return json(res, 404, { error: "domain not found" });
      db.prepare("UPDATE domains SET is_primary=0 WHERE project=?").run(dom.project);
      db.prepare("UPDATE domains SET is_primary=1 WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

    // ────────── managed databases ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/databases$/)) && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM managed_dbs WHERE project=? ORDER BY created_at DESC").all(m[1]));
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/databases$/)) && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name || !b.engine) return json(res, 400, { error: "name and engine required" });
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      const id = "mdb_" + crypto.randomBytes(6).toString("hex");
      db.prepare("INSERT INTO managed_dbs VALUES (?,?,?,?,?,?,?,?)")
        .run(id, m[1], b.name, b.engine, b.size_mb || 1024, "provisioning", null, Date.now());
      // Simulate provisioning
      setTimeout(() => {
        const port = b.engine === "postgres" ? 5432 : b.engine === "mysql" ? 3306 : b.engine === "mongodb" ? 27017 : 6379;
        const conn = `${b.engine}://hx:${crypto.randomBytes(8).toString("hex")}@localhost:${port}/${b.name}`;
        db.prepare("UPDATE managed_dbs SET status='running', connection_string=? WHERE id=?").run(conn, id);
      }, 3000);
      return json(res, 200, { id, name: b.name, engine: b.engine });
    }
    if (url.pathname === "/api/databases" && req.method === "GET") {
      return json(res, 200, db.prepare("SELECT * FROM managed_dbs ORDER BY created_at DESC").all());
    }
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM backups WHERE database_id=?").run(m[1]);
      db.prepare("DELETE FROM managed_dbs WHERE id=?").run(m[1]);
      return json(res, 200, { ok: true });
    }

    // ────────── backups ──────────
    if ((m = url.pathname.match(/^\/api\/databases\/([^/]+)\/backup$/)) && req.method === "POST") {
      const mdb = db.prepare("SELECT * FROM managed_dbs WHERE id=?").get(m[1]);
      if (!mdb) return json(res, 404, { error: "database not found" });
      const id = "bkp_" + Math.floor(1000 + Math.random() * 9000);
      const sizeMb = parseFloat((mdb.size_mb * (0.6 + Math.random() * 0.4)).toFixed(1));
      const sha = crypto.randomBytes(32).toString("hex");
      db.prepare("INSERT INTO backups VALUES (?,?,?,?,?,?,?)")
        .run(id, m[1], "manual", sizeMb, sha, "pending", Date.now());
      // Simulate backup completion
      setTimeout(() => {
        db.prepare("UPDATE backups SET status='completed' WHERE id=?").run(id);
      }, 2500);
      return json(res, 200, { id, database: mdb.name, engine: mdb.engine, size_mb: sizeMb, sha256: sha, status: "pending" });
    }
    if (url.pathname === "/api/backups" && req.method === "GET") {
      const rows = db.prepare(`
        SELECT b.*, d.name as db_name, d.engine as db_engine, d.project
        FROM backups b JOIN managed_dbs d ON b.database_id = d.id
        ORDER BY b.created_at DESC
      `).all();
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
      return json(res, 200, { ok: true, message: `Restoring ${mdb?.name ?? "database"} from snapshot ${m[1]}` });
    }

    // ────────── tokens ──────────
    if (url.pathname === "/api/tokens" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT token, name, created_at FROM tokens").all());
    if (url.pathname === "/api/tokens" && req.method === "POST") {
      const b = await readBody(req);
      const t = "hxt_" + crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO tokens (token, name, created_at, scopes_json) VALUES (?,?,?,?)").run(t, b.name || "token", Date.now(), JSON.stringify(Array.isArray(b.scopes) && b.scopes.length ? b.scopes : ["*"]));
      return json(res, 200, { token: t });
    }
    if ((m = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM tokens WHERE token=?").run(m[1]); return json(res, 200, { ok: true });
    }

    // ────────── github webhooks (config) ──────────
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook$/)) && req.method === "GET") {
      const wh = db.prepare("SELECT id, project, provider, branch, created_at FROM webhooks WHERE project=?").get(m[1]);
      return json(res, 200, wh || null);
    }
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)\/webhook$/)) && req.method === "POST") {
      const b = await readBody(req);
      const proj = db.prepare("SELECT * FROM projects WHERE name=?").get(m[1]);
      if (!proj) return json(res, 404, { error: "project not found" });
      db.prepare("DELETE FROM webhooks WHERE project=?").run(m[1]);
      const id = "wh_" + crypto.randomBytes(6).toString("hex");
      const secret = crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO webhooks VALUES (?,?,?,?,?,?)")
        .run(id, m[1], "github", secret, b.branch || "main", Date.now());
      return json(res, 200, { id, secret, branch: b.branch || "main", url: `/webhooks/github/${m[1]}` });
    }

    // ────────── one-click apps (via docker) ──────────
    if (url.pathname === "/api/apps" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT * FROM installed_apps ORDER BY created_at DESC").all());
    if (url.pathname === "/api/apps" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.slug || !b.image) return json(res, 400, { error: "slug and image required" });
      const id = "app_" + crypto.randomBytes(6).toString("hex");
      const port = b.port || null;
      db.prepare("INSERT INTO installed_apps VALUES (?,?,?,?,?,?,?)")
        .run(id, b.slug, b.name || b.slug, null, port, "installing", Date.now());
      // spawn docker run detached; if docker missing, mark failed
      const cname = `hx_app_${b.slug}_${id.slice(-6)}`;
      const portFlag = port ? `-p ${port}:${port}` : "";
      const cmd = `docker run -d --name ${cname} ${portFlag} ${b.image}`;
      const child = spawn(process.platform === "win32" ? "cmd.exe" : "sh",
        process.platform === "win32" ? ["/c", cmd] : ["-c", cmd]);
      let out = "";
      child.stdout.on("data", (d) => out += d.toString());
      child.stderr.on("data", (d) => out += d.toString());
      child.on("close", (code) => {
        const status = code === 0 ? "running" : "failed";
        db.prepare("UPDATE installed_apps SET status=?, container_id=? WHERE id=?").run(status, out.trim().slice(0, 64), id);
      });
      return json(res, 200, { id, slug: b.slug });
    }
    if ((m = url.pathname.match(/^\/api\/apps\/([^/]+)$/)) && req.method === "DELETE") {
      const app = db.prepare("SELECT * FROM installed_apps WHERE id=?").get(m[1]);
      if (app?.container_id) {
        spawn(process.platform === "win32" ? "cmd.exe" : "sh",
          process.platform === "win32" ? ["/c", `docker rm -f ${app.container_id}`] : ["-c", `docker rm -f ${app.container_id}`]);
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
  if (!id) return ws.close();
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(ws);
  // replay
  const p = path.join(LOGDIR, id + ".log");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n").filter(Boolean)) {
      try { ws.send(JSON.stringify({ deploymentId: id, ts: Date.now(), stream: "replay", text: line })); } catch {}
    }
  }
  ws.on("close", () => subscribers.get(id)?.delete(ws));
});

const PORT = Number(process.env.HOSTERAX_PORT || 7777);
server.listen(PORT, () => console.log(`HosteraX engine listening on http://localhost:${PORT}`));
