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
CREATE INDEX IF NOT EXISTS idx_deploy_project ON deployments(project);
`);

// bootstrap token
const tokenCount = db.prepare("SELECT COUNT(*) c FROM tokens").get().c;
if (tokenCount === 0) {
  const t = "hxt_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO tokens VALUES (?,?,?)").run(t, "bootstrap", Date.now());
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

// running process registry (per project)
const running = new Map(); // project -> child_process

// ---------- deploy engine ----------
function nextVersion(project) {
  const n = db.prepare("SELECT COUNT(*) c FROM deployments WHERE project=?").get(project).c;
  return `v0.${n + 1}.0`;
}

function runStep(deploymentId, cwd, cmd, env) {
  return new Promise((resolve) => {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: `$ ${cmd}` });
    const shell = process.platform === "win32" ? "cmd.exe" : "sh";
    const args = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
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
    ? `xcopy "${abs}" "${workdir}" /E /I /Y /Q`
    : `cp -R "${abs}/." "${workdir}/"`;
  return runStep(deploymentId, path.dirname(workdir), cmd, {});
}

async function startService(deploymentId, project, workdir, cmd, env) {
  // kill previous
  const prev = running.get(project);
  if (prev && !prev.killed) {
    publish(deploymentId, { ts: Date.now(), stream: "system", text: `stopping previous pid ${prev.pid}` });
    try { process.kill(prev.pid); } catch {}
  }
  if (!cmd) { publish(deploymentId, { ts: Date.now(), stream: "system", text: "no start command; skipping" }); return 0; }
  publish(deploymentId, { ts: Date.now(), stream: "system", text: `starting: ${cmd}` });
  const shell = process.platform === "win32" ? "cmd.exe" : "sh";
  const args = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
  const child = spawn(shell, args, { cwd: workdir, env: { ...process.env, ...env }, detached: true });
  child.stdout.on("data", (b) => publish(deploymentId, { ts: Date.now(), stream: "stdout", text: b.toString().trimEnd() }));
  child.stderr.on("data", (b) => publish(deploymentId, { ts: Date.now(), stream: "stderr", text: b.toString().trimEnd() }));
  running.set(project, child);
  child.on("close", (code) => publish(deploymentId, { ts: Date.now(), stream: "system", text: `service exited ${code}` }));
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
  db.prepare("INSERT INTO deployments VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, project, version, "queued", opts.trigger || "manual", Date.now(), null, null, workdir);
  const env = JSON.parse(p.env_json || "{}");

  (async () => {
    try {
      if (!opts.rollbackFrom) {
        setPhase(id, "fetching");
        const code = await fetchSource(id, p.source, workdir);
        if (code !== 0) { setPhase(id, "failed", { finished_at: Date.now(), exit_code: code }); return; }
        if (p.build_cmd) {
          setPhase(id, "building");
          const bc = await runStep(id, workdir, p.build_cmd, env);
          if (bc !== 0) { setPhase(id, "failed", { finished_at: Date.now(), exit_code: bc }); return; }
        }
      } else {
        publish(id, { ts: Date.now(), stream: "system", text: `rollback to ${version}` });
      }
      setPhase(id, "deploying");
      await startService(id, project, workdir, p.start_cmd, env);
      setPhase(id, "ready", { finished_at: Date.now(), exit_code: 0 });
    } catch (e) {
      publish(id, { ts: Date.now(), stream: "stderr", text: String(e) });
      setPhase(id, "failed", { finished_at: Date.now(), exit_code: 1 });
    }
  })();

  return { id, version };
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { ok: true, version: "0.1.0" });
  if (!authOk(req)) return json(res, 401, { error: "unauthorized" });

  try {
    // projects
    if (url.pathname === "/api/projects" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
    if (url.pathname === "/api/projects" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return json(res, 400, { error: "name required" });
      db.prepare("INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?,?)")
        .run(b.name, b.source || "", b.buildCmd || "", b.startCmd || "", JSON.stringify(b.env || {}), b.target || "process", Date.now());
      return json(res, 200, { ok: true });
    }
    let m;
    if ((m = url.pathname.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM projects WHERE name=?").run(m[1]);
      db.prepare("DELETE FROM deployments WHERE project=?").run(m[1]);
      const r = running.get(m[1]); if (r) { try { process.kill(r.pid); } catch {} running.delete(m[1]); }
      return json(res, 200, { ok: true });
    }
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
    // tokens
    if (url.pathname === "/api/tokens" && req.method === "GET")
      return json(res, 200, db.prepare("SELECT token, name, created_at FROM tokens").all());
    if (url.pathname === "/api/tokens" && req.method === "POST") {
      const b = await readBody(req);
      const t = "hxt_" + crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO tokens VALUES (?,?,?)").run(t, b.name || "token", Date.now());
      return json(res, 200, { token: t });
    }
    if ((m = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM tokens WHERE token=?").run(m[1]); return json(res, 200, { ok: true });
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
