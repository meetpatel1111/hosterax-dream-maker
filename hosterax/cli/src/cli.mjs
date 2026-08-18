#!/usr/bin/env node
// hosterax CLI — talks to the engine over HTTP/WS with full platform feature parity.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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

  Workflow & Initialization:
    init                                      Auto-detect project stack & create .hosterax.json
    up [--port 7777]                          Launch engine daemon & open dashboard
    login <token> [--url http://host:7777]    Save engine URL & authorization token
    status                                    Engine & host machine health

  Projects & Deployments:
    projects [--target docker|process]        List deployed projects
    create <name> --source <path|url>         Create new project
    deploy <name|path> [--trigger manual]     Trigger zero-downtime blue/green build & deploy
    restart <name>                            Trigger container/service restart
    logs <deploymentId|name> [--follow]       Stream live execution logs
    history <name>                            Deployment release history for project
    diff <deployId1> <deployId2>              Compare specs & env diff between 2 releases
    metrics [name]                            Live CPU, RAM, Disk, and Network gauges
    rollback <deploymentId>                   Redeploy previous release snapshot
    env <name> [KEY=val ...]                  Get or update environment variables
    quotas <name> [--cpu <cores>] [--memory <mb>] Configure instance quotas
    diagnose <name>                           Run automated AI crash diagnostics
    rm <name>                                 Delete project and associated containers

  Databases & Backups:
    databases [name]                          List managed database instances
    db:create <project> <name> <engine>       Provision Postgres, MySQL, Mongo, or Redis
    backup:create <databaseId|name>           Trigger database snapshot backup
    backup:list [name]                        List available database backups
    backup:restore <snapshotId>               Restore database snapshot

  Domains & Edge Routing:
    domains <name>                            List custom domains for project
    domain:add <name> <hostname> [--primary]  Add custom domain to project
    domain:verify <domainId>                  Verify domain ownership via DNS TXT
    domain:ssl <domainId>                     Provision SSL certificate via Let's Encrypt
    domain:primary <domainId>                 Set domain as primary
    edge:status                               Inspect edge proxy (OpenResty/Caddy)

  Multi-Node Fleet & Cron:
    servers                                   List connected remote SSH server nodes
    server:test <serverId>                    Ping & test SSH connectivity to remote node
    cron:list                                 List scheduled background cron jobs
    cron:run <jobId>                          Trigger immediate execution of cron job
    s3:status                                 Check remote S3/R2 backup sync status
    s3:sync                                   Trigger remote backup sync to AWS S3/R2

  App Store & AI / MCP (Claude, Cursor, Devin, OpenAI, Gemini):
    ai "<prompt>" [--provider <name>] [--model <name>] Universal autonomous AI copilot (Claude, OpenAI, Ollama, Gemini)
    ai:key <apiKey> [--provider <name>]       Save AI provider API key in CLI config
    ai:model <modelName>                      Set default AI model (e.g. gemini-3.5-flash, gpt-4o, claude-3-5-sonnet)
    catalog:search <query> [--category <cat>] Search 2,502+ open-source template apps
    mcp:tools                                 List all 34 registered MCP tools
    mcp:call <toolName> [jsonArgs]            Execute MCP JSON-RPC tool directly
    mcp:config [cursor|claude|devin|windsurf] Output ready-to-use IDE MCP configuration JSON
    mcp:stdio                                 Run stdio MCP transport for IDEs (Cursor, Claude, Devin)
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
    // ────────── Workflow & Init ──────────
    case "init": {
      const cwd = process.cwd();
      const name = path
        .basename(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      let stack = "node";
      let buildCmd = "";
      let startCmd = "";
      let port = 3000;

      if (fs.existsSync(path.join(cwd, "package.json"))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
          if (pkg.dependencies?.next) {
            stack = "nextjs";
            buildCmd = "npm run build";
            startCmd = "npm start";
          } else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
            stack = "vite";
            buildCmd = "npm run build";
            startCmd = "serve-static:dist";
          } else if (pkg.dependencies?.express || pkg.dependencies?.fastify) {
            stack = "node";
            startCmd = "node index.js";
          }
        } catch {}
      } else if (
        fs.existsSync(path.join(cwd, "requirements.txt")) ||
        fs.existsSync(path.join(cwd, "pyproject.toml"))
      ) {
        stack = "python";
        if (fs.existsSync(path.join(cwd, "manage.py"))) {
          stack = "django";
          startCmd = "python manage.py runserver 0.0.0.0:8000";
          port = 8000;
        } else {
          startCmd = "uvicorn main:app --host 0.0.0.0 --port 8000";
          port = 8000;
        }
      } else if (fs.existsSync(path.join(cwd, "go.mod"))) {
        stack = "go";
        buildCmd = "go build -o app .";
        startCmd = "./app";
        port = 8080;
      } else if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
        stack = "rust";
        buildCmd = "cargo build --release";
        startCmd = "./target/release/app";
        port = 8080;
      } else if (fs.existsSync(path.join(cwd, "Dockerfile"))) {
        stack = "dockerfile";
      }

      const conf = {
        name,
        stack,
        source: cwd,
        buildCmd,
        startCmd,
        port,
        target: "docker",
        healthPath: "/",
      };

      fs.writeFileSync(path.join(cwd, ".hosterax.json"), JSON.stringify(conf, null, 2), "utf8");
      console.log(`✓ Initialized HosteraX project configuration (.hosterax.json)`);
      console.log(`  Project: ${name}`);
      console.log(`  Stack:   ${stack}`);
      console.log(`  Port:    ${port}`);
      console.log(`\nRun 'hosterax deploy' to deploy this project.`);
      break;
    }

    case "up": {
      const port = flag("port") || process.env.HOSTERAX_PORT || 7777;
      console.log(`Launching HosteraX engine on port ${port}...`);
      try {
        const health = await (await fetch(`http://localhost:${port}/health`)).json();
        if (health.ok) {
          console.log(
            `✓ Engine already running on http://localhost:${port} (version ${health.version})`,
          );
          break;
        }
      } catch {}

      const engineScript = path.resolve(__dirname, "../../engine/src/index.mjs");
      if (fs.existsSync(engineScript)) {
        spawn(process.execPath, [engineScript], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, HOSTERAX_PORT: String(port) },
        }).unref();
        console.log(`✓ HosteraX daemon started in background on http://localhost:${port}`);
      } else {
        console.log(`Starting engine at http://localhost:${port}`);
      }
      break;
    }

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
        const sys = await api("GET", "/api/system");
        if (sys.docker) {
          if (sys.docker.running) {
            console.log(`Docker: ✓ online (${sys.docker.version || "Engine daemon active"})`);
          } else {
            console.log(`Docker: ⚠️  offline (Start Docker Desktop to run container workloads)`);
          }
        }
        console.log(`CPU: ${sys.cpu.percent}% (${sys.cpu.cores} cores)`);
        console.log(
          `Memory: ${sys.memory.used_mb} MB / ${sys.memory.total_mb} MB (${sys.memory.percent}%)`,
        );
        console.log(
          `Uptime: ${Math.floor((sys.os?.uptime || 0) / 3600)}h ${Math.floor(((sys.os?.uptime || 0) % 3600) / 60)}m`,
        );
        console.log(`Host: ${os.hostname()} (${sys.os?.platform || process.platform})`);
      } catch {}
      break;
    }

    // ────────── Projects & Deployments ──────────
    case "projects": {
      const targetFilter = flag("target");
      const list = await api("GET", "/api/projects");
      const filtered = targetFilter ? list.filter((p) => p.target === targetFilter) : list;
      if (filtered.length === 0) {
        console.log("No projects found.");
        break;
      }
      console.table(
        filtered.map((p) => ({
          Name: p.name,
          Status: p.status || (p.enabled ? "active" : "stopped"),
          Target: p.target || "docker",
          Port: p.port ?? "—",
          HealthPath: p.health_path || "/",
          SleepMode: p.sleep_mode || "auto_sleep",
          Created: p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : "—",
        })),
      );
      break;
    }

    case "create": {
      const name = args[0];
      const source = flag("source");
      const build = flag("build") || "";
      const start = flag("start") || "";
      const port = flag("port") ? Number(flag("port")) : undefined;
      const target = flag("target") || "docker";
      await api("POST", "/api/projects", {
        name,
        source,
        buildCmd: build,
        startCmd: start,
        port,
        target,
      });
      console.log("✓ created project", name);
      break;
    }

    case "deploy": {
      let name = args[0];
      let source;
      if (!name && fs.existsSync(".hosterax.json")) {
        try {
          const conf = JSON.parse(fs.readFileSync(".hosterax.json", "utf8"));
          name = conf.name;
          source = conf.source || process.cwd();
        } catch {}
      } else if (name && fs.existsSync(name)) {
        source = path.resolve(name);
        name = path.basename(source);
        await api("POST", "/api/projects", { name, source });
      }

      if (!name) {
        console.error("Usage: hosterax deploy <project-name|path>");
        process.exit(1);
      }

      const r = await api("POST", `/api/projects/${name}/deploy`, {
        trigger: flag("trigger") || "cli",
      });
      console.log(`✓ Deployment queued: ${r.id} (version: ${r.version})`);
      if (has("follow") || !has("no-follow")) await follow(r.id);
      break;
    }

    case "restart": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax restart <projectName>");
        process.exit(1);
      }
      const r = await api("POST", `/api/projects/${name}/restart`);
      console.log(`✓ Restart signal sent for ${name}`);
      break;
    }

    case "logs": {
      const target = args[0];
      if (!target) {
        console.error("Usage: hosterax logs <deploymentId|projectName> [--follow]");
        process.exit(1);
      }
      if (target.startsWith("d_") || target.startsWith("dep_")) {
        await follow(target, has("follow"));
      } else {
        const deps = await api("GET", `/api/projects/${target}/deployments?limit=1`);
        if (deps && deps.length > 0) {
          await follow(deps[0].id, has("follow"));
        } else {
          console.log(`No deployments found for project '${target}'`);
        }
      }
      break;
    }

    case "history": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax history <projectName>");
        process.exit(1);
      }
      console.table(await api("GET", `/api/projects/${name}/deployments`));
      break;
    }

    case "diff": {
      const d1 = args[0];
      const d2 = args[1];
      if (!d1 || !d2) {
        console.error("Usage: hosterax diff <deployId1> <deployId2>");
        process.exit(1);
      }
      const diff = await api("GET", `/api/deployments/${d1}/diff/${d2}`);
      console.log(`\n╭─ Deployment Diff ─────────────────────────────╮`);
      console.log(`│ Base:   ${diff.base.id.padEnd(38)} │`);
      console.log(`│ Target: ${diff.target.id.padEnd(38)} │`);
      console.log(`╰───────────────────────────────────────────────╯\n`);
      console.table([
        { Metric: "Version", Base: diff.base.version, Target: diff.target.version },
        { Metric: "Phase", Base: diff.base.phase, Target: diff.target.phase },
        { Metric: "Trigger", Base: diff.base.trigger, Target: diff.target.trigger },
        {
          Metric: "Exit Code",
          Base: diff.base.exit_code ?? "—",
          Target: diff.target.exit_code ?? "—",
        },
      ]);
      if (diff.env_diff && diff.env_diff.length > 0) {
        console.log("Environment changes:");
        console.table(
          diff.env_diff.map((d) => ({
            Key: d.key,
            Change: d.change.toUpperCase(),
            Base: d.base ?? "—",
            Target: d.target ?? "—",
          })),
        );
      }
      console.log(
        `Duration delta: ${diff.duration_diff_ms > 0 ? "+" : ""}${diff.duration_diff_ms}ms`,
      );
      break;
    }

    case "metrics": {
      const name = args[0];
      if (name) {
        const m = await api("GET", `/api/projects/${name}/metrics`);
        console.log(`\n╭─ Resource Metrics: ${name.padEnd(28)} ╮`);
        console.log(
          `│ Process:  ${m.process_running ? "✓ running" : "✗ stopped"}${m.pid ? ` (pid ${m.pid})` : ""}`.padEnd(
            48,
          ) + " │",
        );
        console.log(`│ Deploys:  ${String(m.deploy_count).padEnd(36)} │`);
        console.log(`╰───────────────────────────────────────────────╯`);
        console.log(`\nSystem Resources:`);
        console.table({
          "CPU Load": `${m.system.cpu.percent}% (${m.system.cpu.cores} cores)`,
          RAM: `${m.system.memory.used_mb} MB / ${m.system.memory.total_mb} MB (${m.system.memory.percent}%)`,
          Uptime: `${Math.floor(m.system.uptime_seconds / 3600)}h ${Math.floor((m.system.uptime_seconds % 3600) / 60)}m`,
          "Load Avg": m.system.load_avg.join(", "),
        });
      } else {
        const m = await api("GET", "/api/metrics");
        console.log(`\nSystem Metrics (${m.hostname}):`);
        console.table({
          CPU: `${m.cpu.percent}% (${m.cpu.cores} × ${m.cpu.model})`,
          RAM: `${m.memory.used_mb} MB / ${m.memory.total_mb} MB (${m.memory.percent}%)`,
          Uptime: `${Math.floor(m.uptime_seconds / 3600)}h ${Math.floor((m.uptime_seconds % 3600) / 60)}m`,
          "Load Avg": m.load_avg.join(", "),
          Platform: m.platform,
        });
      }
      break;
    }

    case "rollback": {
      const target = args[0];
      if (!target) {
        console.error("Usage: hosterax rollback <deploymentId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/deployments/${target}/rollback`);
      console.log(`✓ Rollback initiated: ${r.id}`);
      await follow(r.id);
      break;
    }

    case "env": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax env <projectName> [KEY=val ...]");
        process.exit(1);
      }
      const kvArgs = args.slice(1);
      if (kvArgs.length === 0) {
        const p = await api("GET", `/api/projects/${name}`);
        console.log(`Environment variables for ${name}:`);
        console.table(p.env || {});
        break;
      }
      const env = {};
      for (const kv of kvArgs) {
        const i = kv.indexOf("=");
        if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
      }
      await api("POST", `/api/projects/${name}/env`, { env });
      console.log(`✓ Updated environment variables for ${name}`);
      break;
    }

    case "quotas": {
      const name = args[0];
      const cpu = flag("cpu");
      const memory = flag("memory");
      if (!name) {
        console.error("Usage: hosterax quotas <project> [--cpu <cores>] [--memory <mb>]");
        process.exit(1);
      }
      const r = await api("POST", `/api/projects/${name}/quotas`, {
        cpu_limit: cpu ? parseFloat(cpu) : null,
        memory_mb_limit: memory ? parseInt(memory, 10) : null,
      });
      console.log(`✓ Updated quotas for ${name}`);
      console.log(`  CPU: ${r.cpu_limit ?? "Unlimited"}`);
      console.log(`  Memory: ${r.memory_mb_limit ? r.memory_mb_limit + " MB" : "Unlimited"}`);
      break;
    }

    case "diagnose": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax diagnose <projectName>");
        process.exit(1);
      }
      const diag = await api("POST", "/api/diagnostics/crash", { projectName: name });
      console.log(`\n╭─ AI Crash Diagnostics: ${name.padEnd(28)} ╮`);
      console.log(`│ Status:      ${diag.status || "analyzed"} │`);
      console.log(`│ Root Cause:  ${(diag.rootCause || "Unknown").slice(0, 36)} │`);
      console.log(`│ Suggested:   ${(diag.suggestedFix || "Restart").slice(0, 36)} │`);
      console.log(`╰───────────────────────────────────────────────────╯`);
      break;
    }

    case "rm": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax rm <projectName>");
        process.exit(1);
      }
      await api("DELETE", `/api/projects/${name}`);
      console.log("✓ Removed project", name);
      break;
    }

    // ────────── Databases & Backups ──────────
    case "databases": {
      const name = args[0];
      if (name) {
        const dbs = await api("GET", `/api/projects/${name}/databases`);
        if (dbs.length === 0) {
          console.log(`No databases attached to ${name}.`);
          break;
        }
        console.table(
          dbs.map((d) => ({
            ID: d.id,
            Name: d.name,
            Engine: d.engine,
            Size: `${d.size_mb} MB`,
            Status: d.status,
            Connection: d.connection_string
              ? d.connection_string.replace(/:[^:@]+@/, ":••••@")
              : "—",
          })),
        );
      } else {
        const dbs = await api("GET", "/api/databases");
        if (dbs.length === 0) {
          console.log("No databases provisioned.");
          break;
        }
        console.table(
          dbs.map((d) => ({
            ID: d.id,
            Project: d.project,
            Name: d.name,
            Engine: d.engine,
            Size: `${d.size_mb} MB`,
            Status: d.status,
          })),
        );
      }
      break;
    }

    case "db:create": {
      const project = args[0];
      const dbName = args[1];
      const engine = args[2] || "postgres";
      if (!project || !dbName) {
        console.error("Usage: hosterax db:create <project> <name> [postgres|mysql|mongodb|redis]");
        process.exit(1);
      }
      const r = await api("POST", `/api/projects/${project}/databases`, {
        name: dbName,
        engine,
        size_mb: 1024,
      });
      console.log(`✓ Database ${dbName} (${engine}) provisioned for project ${project}`);
      break;
    }

    case "backup:create": {
      const target = args[0];
      if (!target) {
        console.error("Usage: hosterax backup:create <databaseName|databaseId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/databases/${target}/backup`);
      console.log(`✓ Snapshot ${r.id} created for ${r.database || target}`);
      console.log(`  Size: ${r.size_mb || 0} MB | SHA256: ${(r.sha256 || "").slice(0, 16)}…`);
      break;
    }

    case "backup:list": {
      const backups = await api("GET", "/api/backups");
      if (backups.length === 0) {
        console.log("No backups available.");
        break;
      }
      console.table(
        backups.map((b) => ({
          ID: b.id,
          Database: b.db_name,
          Engine: b.db_engine,
          Project: b.project,
          Size: `${b.size_mb} MB`,
          Status: b.status,
          Type: b.snapshot_type,
          Created: new Date(b.created_at).toISOString(),
        })),
      );
      break;
    }

    case "backup:restore": {
      const snapId = args[0];
      if (!snapId) {
        console.error("Usage: hosterax backup:restore <snapshotId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/backups/${snapId}/restore`);
      console.log(`✓ ${r.message || "Snapshot restored successfully"}`);
      break;
    }

    // ────────── Domains & Edge ──────────
    case "domains": {
      const name = args[0];
      if (!name) {
        console.error("Usage: hosterax domains <projectName>");
        process.exit(1);
      }
      const doms = await api("GET", `/api/projects/${name}/domains`);
      if (doms.length === 0) {
        console.log(`No custom domains for ${name}.`);
        break;
      }
      console.table(
        doms.map((d) => ({
          ID: d.id,
          Hostname: d.hostname,
          Verified: d.verified ? "✓" : "✗",
          Primary: d.is_primary ? "★" : "",
          SSL: d.ssl_status,
        })),
      );
      break;
    }

    case "domain:add": {
      const name = args[0];
      const hostname = args[1];
      if (!name || !hostname) {
        console.error("Usage: hosterax domain:add <project> <hostname> [--primary]");
        process.exit(1);
      }
      const isPrimary = has("primary");
      const r = await api("POST", `/api/projects/${name}/domains`, { hostname, isPrimary });
      console.log(`✓ Domain ${hostname} added (id: ${r.id})`);
      break;
    }

    case "domain:verify": {
      const domId = args[0];
      if (!domId) {
        console.error("Usage: hosterax domain:verify <domainId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/domains/${domId}/verify`);
      console.log(
        r.verified
          ? `✓ Domain ${r.hostname} verified.`
          : `✗ Verification pending for ${r.hostname}.`,
      );
      break;
    }

    case "domain:ssl": {
      const domId = args[0];
      if (!domId) {
        console.error("Usage: hosterax domain:ssl <domainId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/domains/${domId}/ssl`);
      console.log(`✓ ${r.message}`);
      break;
    }

    case "domain:primary": {
      const domId = args[0];
      if (!domId) {
        console.error("Usage: hosterax domain:primary <domainId>");
        process.exit(1);
      }
      await api("POST", `/api/domains/${domId}/primary`);
      console.log("✓ Primary domain updated.");
      break;
    }

    case "edge:status": {
      const edge = await api("GET", "/api/edge/status");
      console.log(`\n╭─ Managed Edge Gateway ────────────────────────╮`);
      console.log(`│ Active Proxy:   ${(edge.provider || "Caddy 2").padEnd(30)} │`);
      console.log(`│ Dynamic Routes: ${String(edge.routes_count || 0).padEnd(30)} │`);
      console.log(`╰────────────────────────────────────────────────╯`);
      break;
    }

    // ────────── Multi-Node & Cron ──────────
    case "servers": {
      const srvs = await api("GET", "/api/servers");
      if (!srvs || srvs.length === 0) {
        console.log("No remote servers connected.");
        break;
      }
      console.table(
        srvs.map((s) => ({
          ID: s.id,
          Name: s.name,
          Host: s.host,
          Status: s.status,
          Latency: s.latency_ms ? `${s.latency_ms}ms` : "—",
        })),
      );
      break;
    }

    case "server:test": {
      const srvId = args[0];
      if (!srvId) {
        console.error("Usage: hosterax server:test <serverId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/servers/${srvId}/test`);
      console.log(
        r.ok ? `✓ Server reachable (${r.latency_ms}ms)` : `✗ Connection failed: ${r.error}`,
      );
      break;
    }

    case "cron:list": {
      const jobs = await api("GET", "/api/cron/jobs");
      if (!jobs || jobs.length === 0) {
        console.log("No cron jobs scheduled.");
        break;
      }
      console.table(
        jobs.map((j) => ({
          ID: j.id,
          Name: j.name,
          Schedule: j.schedule,
          Target: j.target_project || "system",
          Enabled: j.enabled ? "✓" : "✗",
          LastRun: j.last_run_at ? new Date(j.last_run_at).toISOString() : "Never",
        })),
      );
      break;
    }

    case "cron:run": {
      const jobId = args[0];
      if (!jobId) {
        console.error("Usage: hosterax cron:run <jobId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/cron/jobs/${jobId}/run`);
      console.log(`✓ Cron job execution triggered (exit code: ${r.exit_code ?? 0})`);
      break;
    }

    case "s3:status": {
      const s3 = await api("GET", "/api/storage/s3");
      console.log(`S3 Configured: ${s3.configured ? "✓ Yes" : "✗ No"}`);
      if (s3.configured) {
        console.log(`Bucket: ${s3.bucket} (${s3.provider || "AWS S3"})`);
      }
      break;
    }

    case "s3:sync": {
      const r = await api("POST", "/api/storage/s3/sync");
      console.log(`✓ S3 Remote Sync: ${r.message || "Completed"}`);
      break;
    }

    // ────────── Catalog & MCP ──────────
    case "catalog:search": {
      const q = args[0] || "";
      const tag = flag("category") || flag("tag");
      const url = `/api/catalog/apps?q=${encodeURIComponent(q)}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}&limit=20`;
      const res = await api("GET", url);
      const apps = Array.isArray(res) ? res : res?.apps || [];
      if (!apps || apps.length === 0) {
        console.log("No matching catalog apps found.");
        break;
      }
      console.table(
        apps.slice(0, 20).map((a) => ({
          Name: a.name,
          Category: a.tag || a.category || "App",
          Description: (a.desc || a.description || "").slice(0, 45) + "…",
        })),
      );
      break;
    }

    case "mcp:tools": {
      const rpc = await api("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: "cli_1",
        method: "tools/list",
      });
      const tools = rpc.result?.tools || [];
      console.log(`\nHosteraX Registered MCP Tools (${tools.length} available):`);
      console.table(
        tools.map((t) => ({
          Tool: t.name,
          Description: t.description.slice(0, 65) + "…",
        })),
      );
      break;
    }

    case "mcp:call": {
      const toolName = args[0];
      let rawArgs = {};
      if (args[1]) {
        try {
          rawArgs = JSON.parse(args[1]);
        } catch {
          try {
            // Support key=val syntax or single unquoted string
            const cleaned = args[1].replace(/'/g, '"');
            rawArgs = JSON.parse(cleaned);
          } catch {
            rawArgs = { query: args[1], name: args[1], input: args[1] };
          }
        }
      }
      if (!toolName) {
        console.error("Usage: hosterax mcp:call <toolName> [jsonArgs]");
        process.exit(1);
      }
      const rpc = await api("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: "cli_call",
        method: "tools/call",
        params: { name: toolName, arguments: rawArgs },
      });
      console.log(rpc.result?.content?.[0]?.text || JSON.stringify(rpc, null, 2));
      break;
    }

    case "mcp:config": {
      const target = (args[0] || "all").toLowerCase();
      const httpEndpoint = `${cfg.url}/api/mcp`;
      const cliPath = path.resolve(process.argv[1]);

      const configs = {
        cursor: {
          name: "Cursor IDE (.cursor/mcp.json or Settings -> Features -> MCP)",
          config: {
            mcpServers: {
              hosterax: {
                url: httpEndpoint,
              },
            },
          },
        },
        claude: {
          name: "Claude Desktop (claude_desktop_config.json)",
          config: {
            mcpServers: {
              hosterax: {
                command: "npx",
                args: ["-y", "hosterax", "mcp:stdio"],
              },
            },
          },
        },
        devin: {
          name: "Devin / Windsurf / Codex / Custom Agents",
          config: {
            name: "hosterax",
            type: "mcp",
            url: httpEndpoint,
          },
        },
      };

      if (target === "cursor") {
        console.log(JSON.stringify(configs.cursor.config, null, 2));
      } else if (target === "claude") {
        console.log(JSON.stringify(configs.claude.config, null, 2));
      } else if (target === "devin" || target === "windsurf" || target === "codex") {
        console.log(JSON.stringify(configs.devin.config, null, 2));
      } else {
        console.log(`\n╭─ HosteraX Model Context Protocol (MCP) Setup ─╮`);
        console.log(`│ HTTP Endpoint: ${httpEndpoint.padEnd(31)}│`);
        console.log(`╰────────────────────────────────────────────────╯`);
        for (const val of Object.values(configs)) {
          console.log(`\n📌 ${val.name}:`);
          console.log(JSON.stringify(val.config, null, 2));
        }
      }
      break;
    }

    case "mcp:stdio": {
      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, terminal: false });
      rl.on("line", async (line) => {
        if (!line.trim()) return;
        try {
          const payload = JSON.parse(line);
          const res = await api("POST", "/api/mcp", payload);
          process.stdout.write(JSON.stringify(res) + "\n");
        } catch (err) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: err.message },
            }) + "\n",
          );
        }
      });
      break;
    }

    case "ai:key": {
      const provider = flag("provider") || "gemini";
      const key = args[0] || flag("key");
      if (!key) {
        console.error("Usage: htx ai:key <apiKey> [--provider openai|anthropic|gemini]");
        process.exit(1);
      }
      if (provider === "anthropic" || provider === "claude") {
        cfg.anthropicApiKey = key;
      } else if (provider === "openai") {
        cfg.openaiApiKey = key;
      } else {
        cfg.geminiApiKey = key;
      }
      saveCfg(cfg);
      console.log(`✓ ${provider.toUpperCase()} API key saved to ~/.hosterax/cli.json`);
      break;
    }

    case "ai:model": {
      const modelName = args[0] || flag("model");
      if (!modelName) {
        console.log(`Current default AI model: ${cfg.aiModel || "gemini-3.5-flash"}`);
        console.log("Usage: htx ai:model <modelName>");
        console.log("Examples:");
        console.log("  htx ai:model gemini-3.5-flash");
        console.log("  htx ai:model gpt-4o");
        console.log("  htx ai:model gpt-4o-mini");
        console.log("  htx ai:model claude-3-5-sonnet-20241022");
        console.log("  htx ai:model claude-3-5-haiku-20241022");
        console.log("  htx ai:model llama3");
        break;
      }
      cfg.aiModel = modelName;
      saveCfg(cfg);
      console.log(`✓ Default AI model set to: ${modelName} (saved in ~/.hosterax/cli.json)`);
      break;
    }

    case "ai": {
      const userPrompt = args[0];
      if (!userPrompt) {
        console.error(
          'Usage: htx ai "<your prompt>" [--provider openai|claude|gemini|ollama] [--model <modelName>] [--key <apiKey>]',
        );
        process.exit(1);
      }

      // Provider resolution (Default: Gemini)
      let provider = flag("provider") || cfg.defaultAiProvider;
      let apiKey = flag("key");
      const customModel = flag("model") || cfg.aiModel;

      if (!provider) {
        if (apiKey) {
          provider = apiKey.startsWith("sk-ant")
            ? "anthropic"
            : apiKey.startsWith("sk-")
              ? "openai"
              : "gemini";
        } else if (process.env.GEMINI_API_KEY || cfg.geminiApiKey) {
          provider = "gemini"; // Default
        } else if (process.env.ANTHROPIC_API_KEY || cfg.anthropicApiKey) {
          provider = "anthropic";
        } else if (process.env.OPENAI_API_KEY || cfg.openaiApiKey) {
          provider = "openai";
        } else if (process.env.OLLAMA_HOST) {
          provider = "ollama";
        } else {
          provider = "gemini";
        }
      }

      // 1. Fetch MCP Tools
      const rpc = await api("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: "mcp_list",
        method: "tools/list",
      });
      const mcpTools = rpc.result?.tools || [];

      // ── Provider: Anthropic (Claude) ──
      if (provider === "anthropic" || provider === "claude") {
        const key = apiKey || cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
        const modelName =
          customModel || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
        console.log(`\n🤖 HosteraX Autonomous Agent thinking (ANTHROPIC / ${modelName})...`);

        if (!key) {
          console.error(
            "Error: Anthropic API key not found. Set ANTHROPIC_API_KEY or run: htx ai:key <key> --provider anthropic",
          );
          process.exit(1);
        }
        const claudeTools = mcpTools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema || { type: "object", properties: {} },
        }));

        let messages = [{ role: "user", content: userPrompt }];
        let maxSteps = 5;

        while (maxSteps-- > 0) {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: modelName,
              max_tokens: 1024,
              system:
                "You are the HosteraX Autonomous Cloud Agent. You have direct access to 34 HosteraX MCP tools to inspect and manage infrastructure.",
              messages,
              tools: claudeTools,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 429 || res.status === 529) {
              console.log(`⏳ Anthropic rate limited/overloaded. Waiting 4s before retrying...`);
              await new Promise((r) => setTimeout(r, 4000));
              continue;
            }
            console.error("Anthropic API Error:", err.error?.message || res.statusText);
            break;
          }

          const resp = await res.json();
          const toolUses = resp.content?.filter((c) => c.type === "tool_use") || [];
          if (toolUses.length > 0) {
            messages.push({ role: "assistant", content: resp.content });
            const toolResults = [];

            for (const toolUse of toolUses) {
              console.log(`\n⚡ Autonomous MCP Tool Call: \x1b[36m${toolUse.name}\x1b[0m`);
              if (Object.keys(toolUse.input || {}).length > 0) {
                console.log(`   Args:`, JSON.stringify(toolUse.input));
              }
              const toolExec = await api("POST", "/api/mcp", {
                jsonrpc: "2.0",
                id: "ai_" + Date.now(),
                method: "tools/call",
                params: { name: toolUse.name, arguments: toolUse.input || {} },
              });
              const resultText = toolExec.result?.content?.[0]?.text || JSON.stringify(toolExec);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: resultText,
              });
            }

            messages.push({ role: "user", content: toolResults });
            continue;
          }

          const textBlock = resp.content?.find((c) => c.type === "text");
          if (textBlock?.text) {
            console.log(`\n💡 \x1b[1mAnswer:\x1b[0m\n${textBlock.text}\n`);
          }
          break;
        }
        break;
      }

      // ── Provider: OpenAI / Ollama ──
      if (provider === "openai" || provider === "ollama") {
        const key =
          apiKey ||
          cfg.openaiApiKey ||
          process.env.OPENAI_API_KEY ||
          (provider === "ollama" ? "ollama" : "");
        const baseUrl =
          provider === "ollama"
            ? (process.env.OLLAMA_HOST || "http://localhost:11434") + "/v1"
            : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
        const modelName =
          customModel ||
          (provider === "ollama"
            ? process.env.OLLAMA_MODEL || "llama3"
            : process.env.OPENAI_MODEL || "gpt-4o");
        console.log(
          `\n🤖 HosteraX Autonomous Agent thinking (${provider.toUpperCase()} / ${modelName})...`,
        );

        const openAiTools = mcpTools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        }));

        let messages = [{ role: "user", content: userPrompt }];
        let maxSteps = 5;

        while (maxSteps-- > 0) {
          let res;
          try {
            res = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                model: modelName,
                messages,
                tools: openAiTools,
              }),
            });
          } catch (fetchErr) {
            if (provider === "ollama") {
              console.error(
                `Ollama connection error: Could not reach Ollama at ${baseUrl}. Ensure Ollama is running ('ollama serve').`,
              );
            } else {
              console.error(`Network error: ${fetchErr.message}`);
            }
            break;
          }

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 429) {
              console.log(`⏳ OpenAI rate limit reached. Waiting 4s before retrying...`);
              await new Promise((r) => setTimeout(r, 4000));
              continue;
            }
            console.error("OpenAI API Error:", err.error?.message || res.statusText);
            break;
          }

          const resp = await res.json();
          const choice = resp.choices?.[0]?.message;
          if (choice?.tool_calls?.length > 0) {
            messages.push(choice);

            for (const call of choice.tool_calls) {
              const name = call.function.name;
              let callArgs = {};
              try {
                callArgs = JSON.parse(call.function.arguments || "{}");
              } catch {}
              console.log(`\n⚡ Autonomous MCP Tool Call: \x1b[36m${name}\x1b[0m`);
              if (Object.keys(callArgs).length > 0) {
                console.log(`   Args:`, JSON.stringify(callArgs));
              }
              const toolExec = await api("POST", "/api/mcp", {
                jsonrpc: "2.0",
                id: "ai_" + Date.now(),
                method: "tools/call",
                params: { name, arguments: callArgs },
              });
              const resultText = toolExec.result?.content?.[0]?.text || JSON.stringify(toolExec);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: resultText,
              });
            }
            continue;
          }
          if (choice?.content) {
            console.log(`\n💡 \x1b[1mAnswer:\x1b[0m\n${choice.content}\n`);
          }
          break;
        }
        break;
      }

      // ── Provider: Google Gemini ──
      const geminiKey = apiKey || cfg.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        console.error("Error: No AI provider API key found.");
        console.error(
          "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY, or run: htx ai:key <key>",
        );
        process.exit(1);
      }

      const model = customModel || process.env.GEMINI_MODEL || "gemini-3.5-flash";
      console.log(`\n🤖 HosteraX Autonomous Agent thinking (GEMINI / ${model})...`);

      const functionDeclarations = mcpTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: JSON.parse(JSON.stringify(t.inputSchema || { type: "object", properties: {} })),
      }));
      const geminiTools = [{ functionDeclarations }];

      const contents = [{ role: "user", parts: [{ text: userPrompt }] }];
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      let currentContents = [...contents];
      let maxSteps = 5;
      let rateLimitRetries = 0;

      while (maxSteps-- > 0) {
        let res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: currentContents,
            tools: geminiTools,
            systemInstruction: {
              parts: [
                {
                  text: "You are the HosteraX Autonomous Cloud Agent. You have direct access to 34 HosteraX MCP tools. Answer the user prompt by invoking the relevant tools and then providing a clear, concise summary of the results.",
                },
              ],
            },
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (res.status === 429) {
            if (++rateLimitRetries > 2) {
              console.error(
                "Gemini API Rate Limit: Quota currently exhausted. Please try again in 1 minute or use a paid/custom API key.",
              );
              break;
            }
            const match = err.error?.message?.match(/retry in ([\d\.]+)s/i);
            const waitSec = match ? Math.min(Math.ceil(parseFloat(match[1])) + 1, 15) : 5;
            console.log(`⏳ Gemini Free-tier RPM limit reached. Waiting ${waitSec}s...`);
            await new Promise((r) => setTimeout(r, waitSec * 1000));
            continue;
          }
          console.error("Gemini API Error:", err.error?.message || res.statusText);
          break;
        }

        const responseJson = await res.json();
        const candidate = responseJson.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        const funcCallPart = parts.find((p) => p.functionCall);
        if (funcCallPart) {
          const { name, args: callArgs } = funcCallPart.functionCall;
          console.log(`\n⚡ Autonomous MCP Tool Call: \x1b[36m${name}\x1b[0m`);
          if (Object.keys(callArgs || {}).length > 0) {
            console.log(`   Args:`, JSON.stringify(callArgs));
          }

          const toolExec = await api("POST", "/api/mcp", {
            jsonrpc: "2.0",
            id: "ai_exec_" + Date.now(),
            method: "tools/call",
            params: { name, arguments: callArgs || {} },
          });

          let toolResultRaw = toolExec.result?.content?.[0]?.text;
          let toolData;
          try {
            toolData = JSON.parse(toolResultRaw);
          } catch {
            toolData = { raw: toolResultRaw };
          }

          currentContents.push(candidate.content);
          currentContents.push({
            role: "user",
            parts: [{ functionResponse: { name, response: { content: toolData } } }],
          });
          continue;
        }

        const text = parts
          .map((p) => p.text)
          .filter(Boolean)
          .join("\n");
        if (text) {
          console.log(`\n💡 \x1b[1mAnswer:\x1b[0m\n${text}\n`);
        }
        break;
      }
      break;
    }

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
