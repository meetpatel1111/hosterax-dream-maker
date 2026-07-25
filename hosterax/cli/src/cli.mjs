#!/usr/bin/env node
// hosterax CLI — talks to the engine over HTTP/WS with full feature parity.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "undici";

const CFG = path.join(os.homedir(), ".hosterax", "cli.json");
function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(CFG, "utf8"));
  } catch {
    return { url: "http://localhost:7777", token: "" };
  }
}
function saveCfg(c) {
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
}

const cfg = loadCfg();
async function api(method, pathname, body) {
  const r = await fetch(cfg.url + pathname, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    data = txt;
  }
  if (!r.ok) {
    console.error("error:", data);
    process.exit(1);
  }
  return data;
}

const [, , cmd, ...args] = process.argv;

function help() {
  console.log(`hosterax <command>

  login <token> [--url http://host:7777]   Save engine URL & authorization token
  status                                    Engine & host machine health
  projects                                  List deployed projects
  create <name> --source <path|url> [--build "..."] [--start "..."]
  deploy <name> [--trigger manual]          Trigger build & deploy
  logs <deploymentId> [--follow]            Stream live execution logs
  history <name>                            Deployment release history for project
  diff <deployId1> <deployId2>              Compare specs & env diff between 2 releases
  metrics [name]                            Live CPU, RAM, Disk, and Network gauges
  rollback <deploymentId>                   Redeploy previous release snapshot
  env <name> KEY=val KEY2=val               Replace environment variables
  quotas <name> [--cpu <num>] [--memory <mb>] Configure instance quotas
  rm <name>                                 Delete project
  databases [name]                          List managed database instances
  backup:create <databaseId>                Trigger database snapshot backup
  backup:list                               List available database backups
  backup:restore <snapshotId>               Restore database snapshot
  domains <name>                            List custom domains for project
  domain:add <name> <hostname>              Add custom domain to project
  domain:verify <domainId>                  Verify domain ownership via DNS TXT
  domain:ssl <domainId>                     Provision SSL certificate via Let's Encrypt
  domain:primary <domainId>                 Set domain as primary
  stats                                     Aggregated deployment analytics
  tokens                                    List personal access tokens
  token:new <label>                         Mint personal access token
`);
}

function flag(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(name) {
  return args.includes("--" + name);
}

try {
  switch (cmd) {
    case "login": {
      cfg.token = args[0];
      if (flag("url")) cfg.url = flag("url");
      saveCfg(cfg);
      console.log("saved →", cfg.url);
      break;
    }
    case "status": {
      const health = await (await fetch(cfg.url + "/health")).json();
      console.log("Engine:", health.ok ? "✓ online" : "✗ offline", `(${cfg.url})`);
      console.log("Version:", health.version);
      try {
        const sys = await api("GET", "/api/metrics");
        console.log(`CPU: ${sys.cpu.percent}% (${sys.cpu.cores} cores)`);
        console.log(`Memory: ${sys.memory.used_mb} MB / ${sys.memory.total_mb} MB (${sys.memory.percent}%)`);
        console.log(`Uptime: ${Math.floor(sys.uptime_seconds / 3600)}h ${Math.floor((sys.uptime_seconds % 3600) / 60)}m`);
        console.log(`Host: ${sys.hostname} (${sys.platform})`);
      } catch {}
      break;
    }
    case "projects": {
      console.table(await api("GET", "/api/projects"));
      break;
    }
    case "create": {
      const name = args[0];
      const source = flag("source");
      const build = flag("build") || "";
      const start = flag("start") || "";
      await api("POST", "/api/projects", { name, source, buildCmd: build, startCmd: start });
      console.log("created", name);
      break;
    }
    case "deploy": {
      let name = args[0];
      let source;
      if (name && fs.existsSync(name)) {
        source = path.resolve(name);
        name = path.basename(source);
        await api("POST", "/api/projects", { name, source });
      }
      const r = await api("POST", `/api/projects/${name}/deploy`, { trigger: flag("trigger") || "cli" });
      console.log("deployment", r.id, r.version);
      if (has("follow") || true) await follow(r.id);
      break;
    }
    case "logs": {
      await follow(args[0], has("follow"));
      break;
    }
    case "history": {
      console.table(await api("GET", `/api/projects/${args[0]}/deployments`));
      break;
    }
    case "diff": {
      const d1 = args[0];
      const d2 = args[1];
      if (!d1 || !d2) { console.error("Usage: hosterax diff <deployId1> <deployId2>"); process.exit(1); }
      const diff = await api("GET", `/api/deployments/${d1}/diff/${d2}`);
      console.log(`\n╭─ Deployment Diff ─────────────────────────────╮`);
      console.log(`│ Base:   ${diff.base.id.padEnd(38)} │`);
      console.log(`│ Target: ${diff.target.id.padEnd(38)} │`);
      console.log(`╰───────────────────────────────────────────────╯\n`);
      console.table([
        { Metric: "Version", Base: diff.base.version, Target: diff.target.version },
        { Metric: "Phase", Base: diff.base.phase, Target: diff.target.phase },
        { Metric: "Trigger", Base: diff.base.trigger, Target: diff.target.trigger },
        { Metric: "Exit Code", Base: diff.base.exit_code ?? "—", Target: diff.target.exit_code ?? "—" },
      ]);
      if (diff.env_diff.length > 0) {
        console.log("Environment changes:");
        console.table(diff.env_diff.map((d) => ({
          Key: d.key,
          Change: d.change.toUpperCase(),
          Base: d.base ?? "—",
          Target: d.target ?? "—",
        })));
      } else {
        console.log("No environment variable changes.");
      }
      console.log(`Duration delta: ${diff.duration_diff_ms > 0 ? "+" : ""}${diff.duration_diff_ms}ms`);
      break;
    }
    case "metrics": {
      const name = args[0];
      if (name) {
        const m = await api("GET", `/api/projects/${name}/metrics`);
        console.log(`\n╭─ Resource Metrics: ${name.padEnd(28)} ╮`);
        console.log(`│ Process:  ${m.process_running ? "✓ running" : "✗ stopped"}${m.pid ? ` (pid ${m.pid})` : ""}`.padEnd(48) + " │");
        console.log(`│ Deploys:  ${String(m.deploy_count).padEnd(36)} │`);
        console.log(`╰───────────────────────────────────────────────╯`);
        console.log(`\nSystem Resources:`);
        console.table({
          "CPU Load": `${m.system.cpu.percent}% (${m.system.cpu.cores} cores)`,
          "RAM": `${m.system.memory.used_mb} MB / ${m.system.memory.total_mb} MB (${m.system.memory.percent}%)`,
          "Uptime": `${Math.floor(m.system.uptime_seconds / 3600)}h ${Math.floor((m.system.uptime_seconds % 3600) / 60)}m`,
          "Load Avg": m.system.load_avg.join(", "),
        });
      } else {
        const m = await api("GET", "/api/metrics");
        console.log(`\nSystem Metrics (${m.hostname}):`);
        console.table({
          "CPU": `${m.cpu.percent}% (${m.cpu.cores} × ${m.cpu.model})`,
          "RAM": `${m.memory.used_mb} MB / ${m.memory.total_mb} MB (${m.memory.percent}%)`,
          "Uptime": `${Math.floor(m.uptime_seconds / 3600)}h ${Math.floor((m.uptime_seconds % 3600) / 60)}m`,
          "Load Avg": m.load_avg.join(", "),
          "Platform": m.platform,
        });
      }
      break;
    }
    case "rollback": {
      const r = await api("POST", `/api/deployments/${args[0]}/rollback`);
      console.log(r);
      await follow(r.id);
      break;
    }
    case "env": {
      const name = args[0];
      const env = {};
      for (const kv of args.slice(1)) {
        const i = kv.indexOf("=");
        if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
      }
      await api("POST", `/api/projects/${name}/env`, { env });
      console.log("updated env");
      break;
    }
    case "quotas": {
      const name = args[0];
      const cpu = flag("cpu");
      const memory = flag("memory");
      if (!name) { console.error("Usage: hosterax quotas <project> [--cpu <cores>] [--memory <mb>]"); process.exit(1); }
      const r = await api("POST", `/api/projects/${name}/quotas`, {
        cpu_limit: cpu ? parseFloat(cpu) : null,
        memory_mb_limit: memory ? parseInt(memory, 10) : null
      });
      console.log(`updated quotas for ${name}`);
      console.log(`  CPU: ${r.cpu_limit ?? 'Unlimited'}`);
      console.log(`  Memory: ${r.memory_mb_limit ? r.memory_mb_limit + ' MB' : 'Unlimited'}`);
      break;
    }
    case "rm": {
      await api("DELETE", `/api/projects/${args[0]}`);
      console.log("removed", args[0]);
      break;
    }
    // ────────── databases ──────────
    case "databases": {
      const name = args[0];
      if (name) {
        const dbs = await api("GET", `/api/projects/${name}/databases`);
        if (dbs.length === 0) { console.log(`No databases attached to ${name}.`); break; }
        console.table(dbs.map((d) => ({
          ID: d.id,
          Name: d.name,
          Engine: d.engine,
          Size: `${d.size_mb} MB`,
          Status: d.status,
          Connection: d.connection_string ? d.connection_string.replace(/:[^:@]+@/, ":••••@") : "—",
        })));
      } else {
        const dbs = await api("GET", "/api/databases");
        if (dbs.length === 0) { console.log("No databases provisioned."); break; }
        console.table(dbs.map((d) => ({
          ID: d.id,
          Project: d.project,
          Name: d.name,
          Engine: d.engine,
          Size: `${d.size_mb} MB`,
          Status: d.status,
        })));
      }
      break;
    }
    case "backup:create": {
      const dbId = args[0];
      if (!dbId) { console.error("Usage: hosterax backup:create <databaseId>"); process.exit(1); }
      const r = await api("POST", `/api/databases/${dbId}/backup`);
      console.log(`✓ Snapshot ${r.id} created for ${r.database} (${r.engine})`);
      console.log(`  Size: ${r.size_mb} MB | SHA256: ${r.sha256.slice(0, 16)}…`);
      break;
    }
    case "backup:list": {
      const backups = await api("GET", "/api/backups");
      if (backups.length === 0) { console.log("No backups available."); break; }
      console.table(backups.map((b) => ({
        ID: b.id,
        Database: b.db_name,
        Engine: b.db_engine,
        Project: b.project,
        Size: `${b.size_mb} MB`,
        Status: b.status,
        Type: b.snapshot_type,
        Created: new Date(b.created_at).toISOString(),
      })));
      break;
    }
    case "backup:restore": {
      const snapId = args[0];
      if (!snapId) { console.error("Usage: hosterax backup:restore <snapshotId>"); process.exit(1); }
      const r = await api("POST", `/api/backups/${snapId}/restore`);
      console.log(`✓ ${r.message}`);
      break;
    }
    // ────────── domains ──────────
    case "domains": {
      const name = args[0];
      if (!name) { console.error("Usage: hosterax domains <projectName>"); process.exit(1); }
      const doms = await api("GET", `/api/projects/${name}/domains`);
      if (doms.length === 0) { console.log(`No custom domains for ${name}.`); break; }
      console.table(doms.map((d) => ({
        ID: d.id,
        Hostname: d.hostname,
        Verified: d.verified ? "✓" : "✗",
        Primary: d.is_primary ? "★" : "",
        SSL: d.ssl_status,
        Expires: d.ssl_expires ?? "—",
      })));
      break;
    }
    case "domain:add": {
      const name = args[0];
      const hostname = args[1];
      if (!name || !hostname) { console.error("Usage: hosterax domain:add <project> <hostname>"); process.exit(1); }
      const r = await api("POST", `/api/projects/${name}/domains`, { hostname });
      console.log(`✓ Domain ${hostname} added (id: ${r.id})`);
      console.log(`  To verify, add a DNS TXT record:`);
      console.log(`  _hosterax-challenge.${hostname} → ${r.challenge_token}`);
      break;
    }
    case "domain:verify": {
      const domId = args[0];
      if (!domId) { console.error("Usage: hosterax domain:verify <domainId>"); process.exit(1); }
      const r = await api("POST", `/api/domains/${domId}/verify`);
      if (r.verified) {
        console.log(`✓ Domain ${r.hostname} verified successfully.`);
      } else {
        console.log(`✗ Verification failed for ${r.hostname}.`);
        console.log(`  Ensure TXT record exists: _hosterax-challenge.${r.hostname} → ${r.challenge_token}`);
      }
      break;
    }
    case "domain:ssl": {
      const domId = args[0];
      if (!domId) { console.error("Usage: hosterax domain:ssl <domainId>"); process.exit(1); }
      const r = await api("POST", `/api/domains/${domId}/ssl`);
      console.log(`✓ ${r.message}`);
      break;
    }
    case "domain:primary": {
      const domId = args[0];
      if (!domId) { console.error("Usage: hosterax domain:primary <domainId>"); process.exit(1); }
      await api("POST", `/api/domains/${domId}/primary`);
      console.log("✓ Primary domain updated.");
      break;
    }
    // ────────── stats ──────────
    case "stats": {
      const s = await api("GET", "/api/stats");
      console.log(`\n╭─ HosteraX Control Plane Stats ─────────────────╮`);
      console.log(`│ Projects:       ${String(s.projects).padEnd(30)} │`);
      console.log(`│ Deployments:    ${String(s.deployments.total).padEnd(30)} │`);
      console.log(`│ Success rate:   ${(s.deployments.success_rate + "%").padEnd(30)} │`);
      console.log(`│ Avg duration:   ${(s.avg_duration_ms + "ms").padEnd(30)} │`);
      console.log(`│ Domains:        ${String(s.domains).padEnd(30)} │`);
      console.log(`│ Databases:      ${String(s.databases).padEnd(30)} │`);
      console.log(`│ Backups:        ${String(s.backups).padEnd(30)} │`);
      console.log(`│ Running procs:  ${String(s.running_processes).padEnd(30)} │`);
      console.log(`╰────────────────────────────────────────────────╯`);
      console.log(`\nSystem: ${s.system.hostname} | CPU: ${s.system.cpu.percent}% | RAM: ${s.system.memory.percent}%`);
      break;
    }
    // ────────── tokens ──────────
    case "tokens": {
      console.table(await api("GET", "/api/tokens"));
      break;
    }
    case "token:new": {
      console.log((await api("POST", "/api/tokens", { name: args[0] })).token);
      break;
    }
    default:
      help();
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}

async function follow(id, keepOpen = true) {
  const wsUrl = cfg.url.replace(/^http/, "ws") + "/ws?deployment=" + id;
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (ev) => {
    try {
      const m = JSON.parse(ev.data);
      console.log(`[${m.stream}] ${m.text}`);
      if (/exit \d+/.test(m.text) && !keepOpen) ws.close();
    } catch {}
  });
  ws.addEventListener("error", (e) => console.error("ws error", e));
  await new Promise((r) => ws.addEventListener("close", r));
}
