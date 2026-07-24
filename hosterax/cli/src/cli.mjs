#!/usr/bin/env node
// hosterax CLI — talks to the engine over HTTP/WS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "undici";

const CFG = path.join(os.homedir(), ".hosterax", "cli.json");
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG, "utf8")); } catch { return { url: "http://localhost:7777", token: "" }; } }
function saveCfg(c) { fs.mkdirSync(path.dirname(CFG), { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(c, null, 2)); }

const cfg = loadCfg();
async function api(method, pathname, body) {
  const r = await fetch(cfg.url + pathname, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  if (!r.ok) { console.error("error:", data); process.exit(1); }
  return data;
}

const [, , cmd, ...args] = process.argv;

function help() {
  console.log(`hosterax <command>

  login <token> [--url http://host:7777]   save engine URL + token
  status                                    engine health
  projects                                  list projects
  create <name> --source <path|url> [--build "..."] [--start "..."]
  deploy <name> [--trigger manual]          trigger deploy
  logs <deploymentId> [--follow]            stream logs
  history <name>                            deployments for project
  rollback <deploymentId>                   redeploy that version
  env <name> KEY=val KEY2=val               replace env vars
  rm <name>                                 delete project
  tokens                                    list tokens
  token:new <label>                         mint token
`);
}

function flag(name) { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : undefined; }
function has(name) { return args.includes("--" + name); }

try {
  switch (cmd) {
    case "login": {
      cfg.token = args[0]; if (flag("url")) cfg.url = flag("url"); saveCfg(cfg);
      console.log("saved →", cfg.url); break;
    }
    case "status": { console.log(await (await fetch(cfg.url + "/health")).json()); break; }
    case "projects": { console.table(await api("GET", "/api/projects")); break; }
    case "create": {
      const name = args[0];
      const source = flag("source"); const build = flag("build") || ""; const start = flag("start") || "";
      await api("POST", "/api/projects", { name, source, buildCmd: build, startCmd: start });
      console.log("created", name); break;
    }
    case "deploy": {
      let name = args[0]; let source;
      if (name && fs.existsSync(name)) { source = path.resolve(name); name = path.basename(source); await api("POST", "/api/projects", { name, source }); }
      const r = await api("POST", `/api/projects/${name}/deploy`, { trigger: flag("trigger") || "cli" });
      console.log("deployment", r.id, r.version);
      if (has("follow") || true) await follow(r.id);
      break;
    }
    case "logs": { await follow(args[0], has("follow")); break; }
    case "history": { console.table(await api("GET", `/api/projects/${args[0]}/deployments`)); break; }
    case "rollback": { const r = await api("POST", `/api/deployments/${args[0]}/rollback`); console.log(r); await follow(r.id); break; }
    case "env": {
      const name = args[0]; const env = {};
      for (const kv of args.slice(1)) { const i = kv.indexOf("="); if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1); }
      await api("POST", `/api/projects/${name}/env`, { env }); console.log("updated"); break;
    }
    case "rm": { await api("DELETE", `/api/projects/${args[0]}`); console.log("removed"); break; }
    case "tokens": { console.table(await api("GET", "/api/tokens")); break; }
    case "token:new": { console.log((await api("POST", "/api/tokens", { name: args[0] })).token); break; }
    default: help();
  }
} catch (e) { console.error(e); process.exit(1); }

async function follow(id, keepOpen = true) {
  const wsUrl = cfg.url.replace(/^http/, "ws") + "/ws?deployment=" + id;
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (ev) => {
    try { const m = JSON.parse(ev.data); console.log(`[${m.stream}] ${m.text}`); if (/exit \d+/.test(m.text) && !keepOpen) ws.close(); } catch {}
  });
  ws.addEventListener("error", (e) => console.error("ws error", e));
  await new Promise((r) => ws.addEventListener("close", r));
}
