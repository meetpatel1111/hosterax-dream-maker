#!/usr/bin/env node
// hosterax CLI — talks to the engine over HTTP/WS with full platform feature parity.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findEngineEntry() {
  const candidates = [
    path.join(__dirname, "../engine/index.mjs"),
    path.join(__dirname, "../engine/src/index.mjs"),
    path.join(__dirname, "../../engine/src/index.mjs"),
    path.join(process.cwd(), "hosterax/engine/src/index.mjs"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function openBrowser(url) {
  const start =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(start, [url], { shell: true, detached: true, stdio: "ignore" }).unref();
  } catch {}
}

async function isEngineHealthy(url = "http://localhost:7777") {
  try {
    const res = await fetch(url + "/health", { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startEngineAndOpenDashboard(port = 7777, shouldOpen = true) {
  const url = `http://localhost:${port}`;
  const alreadyRunning = await isEngineHealthy(url);

  if (alreadyRunning) {
    console.log(`[HosteraX] Engine is already running at ${url}`);
    if (shouldOpen) {
      console.log(`[HosteraX] Opening Control Plane dashboard in your browser...`);
      openBrowser(url);
    }
    return;
  }

  const enginePath = findEngineEntry();
  if (!enginePath) {
    console.error(`[HosteraX Error] Could not locate engine entrypoint.`);
    console.error(
      `Make sure HosteraX is installed or pass --url http://host:7777 to connect remotely.`,
    );
    process.exit(1);
  }

  console.log(`[HosteraX] Launching HosteraX Cloud Control Plane on ${url}...`);
  const child = spawn("node", ["--max-old-space-size=256", enginePath], {
    env: { ...process.env, HOSTERAX_PORT: String(port) },
    stdio: "inherit",
    detached: false,
  });

  child.on("error", (err) => {
    console.error(`[HosteraX Error] Failed to start engine process:`, err);
  });

  let attempts = 0;
  while (attempts < 20) {
    await new Promise((r) => setTimeout(r, 300));
    attempts++;
    if (await isEngineHealthy(url)) {
      console.log(`\n======================================================`);
      console.log(`  🚀 HosteraX Cloud Control Plane is Live!`);
      console.log(`  🌐 Web Dashboard:  ${url}`);
      console.log(`  🤖 MCP Endpoint:   ${url}/api/mcp`);
      console.log(`  🛡️ Engine Daemon:  PID ${child.pid}`);
      console.log(`======================================================\n`);
      if (shouldOpen) {
        openBrowser(url);
      }
      break;
    }
  }
}

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
  // The file holds an API token: owner-only permissions.
  fs.writeFileSync(CFG, JSON.stringify(c, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CFG, 0o600);
  } catch {}
}

const cfg = {
  ...loadCfg(),
  ...(process.env.HOSTERAX_URL ? { url: process.env.HOSTERAX_URL } : {}),
};
if (process.env.HOSTERAX_TOKEN) cfg.token = process.env.HOSTERAX_TOKEN;

/** Low-level request: never exits the process, so long-lived modes (mcp:stdio) can survive errors. */
async function request(method, pathname, body) {
  const headers = { "content-type": "application/json" };
  // Local engines trust loopback callers; only send a token when we have one.
  if (cfg.token) headers.authorization = "Bearer " + cfg.token;
  let r;
  try {
    r = await fetch(cfg.url + pathname, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error(
      `Cannot reach the HosteraX engine at ${cfg.url} (${e.cause?.code || e.message}). Start it with: hosterax up`,
    );
    err.status = 0;
    throw err;
  }
  const txt = await r.text();
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    data = txt;
  }
  if (!r.ok) {
    const err = new Error(typeof data === "object" && data?.error ? data.error : String(data));
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function api(method, pathname, body) {
  try {
    return await request(method, pathname, body);
  } catch (e) {
    console.error("error:", e.message);
    if (e.status === 401)
      console.error(
        "hint: authenticate with `hosterax login <token>` (the token is printed when the engine first starts).",
      );
    process.exit(1);
  }
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
    backup:schedules                          List scheduled backups and their last result
    backup:schedule <database> --cron "0 2 * * *" [--keep 7] [--days 0] [--drill archive|restore|off] [--encrypt]
                                              Back up a managed database on a schedule
    backup:schedule:run <scheduleId>          Run a schedule now
    backup:schedule:rm <scheduleId>           Delete a schedule (its existing backups are kept)
    backup:verify <backupId>                  Check a backup's checksum, encryption and archive integrity
    backup:drill <backupId>                   Restore a backup into a scratch container to prove it works

  Public access (free tunnels, no public IP or router setup needed):
    expose <project|edge> [--provider auto]   Give an app a public https address (see expose:providers)
    expose:list                               Public addresses and their status
    expose:providers                          Free options and which ones this machine can run
    expose:logs|stop|start|restart|rm <id|project>   Manage one tunnel
    expose:ip [--save]                        This machine's public IP; --save uses it for Magic DNS
    expose:auto [on|off] [--provider auto]    Automatically expose every deployed project (off by default)

  Domains & Edge Routing:
    domains <name>                            List custom domains for project
    domain:add <name> <hostname> [--primary]  Add custom domain to project
    domain:verify <domainId>                  Verify domain ownership via DNS TXT
    domain:ssl <domainId>                     Provision SSL certificate via Let's Encrypt
    domain:primary <domainId>                 Set domain as primary
    edge:status                               Inspect edge proxy (OpenResty/Caddy)

  Remote Servers (deploy over SSH):
    servers                                   List servers and whether each is ready
    server:add <name> --host H [--port 22] [--user root] [--key-file path]
                                              Add a server (a key is generated unless --key-file)
    server:trust <serverId> [--fingerprint SHA256:...] [--replace]
                                              Confirm the server's host key; nothing connects before this
    server:test <serverId>                    Connect, log in, and check Docker on the server
    server:bootstrap <serverId>               Print the script that installs Docker and authorises the key
    server:rm <serverId>                      Remove a server (it must not run any project)
    create <name> --server <serverId>         Place a Docker project on a server (also: deploy <path> --server)

  Notifications:
    notify:list                               Channels, what they listen to, and whether the last send worked
    notify:add <name> --type webhook|slack|discord|ntfy|email --url <url> | --to a@b.com
               [--secret <s>] [--events deploy.failed,server.down,...]
                                              Be told when a deploy fails, an app crashes, a server goes away,
                                              a backup fails (events default to everything important)
    notify:test <id>                          Send a test message
    notify:rm <id>                            Remove a channel

  Cron & Backups:
    cron:list                                 List scheduled background cron jobs
    cron:run <jobId>                          Trigger immediate execution of cron job
    s3:status                                 Check remote S3/R2 backup sync status
    s3:sync                                   Trigger remote backup sync to AWS S3/R2

  Email Stack & Webmail:
    mail:domains                              List configured email domains & SPF/DKIM
    mail:domain:add <domain>                  Add custom email domain & generate keys
    mail:boxes [domainId]                     List configured mailboxes
    mail:box:new <email> <name> <password>    Create new email mailbox
    mail:aliases                              List inbound forwarding aliases & webhooks
    mail:alias:new <alias> <destination>      Create forwarding email alias

  Webhooks & PR Previews:
    webhooks <project>                        Inspect Git push-to-deploy webhook secret
    previews [project]                        List ephemeral PR preview containers
    preview:delete <previewId>                Destroy PR preview environment

  Organizations & RBAC Teams:
    orgs                                      List organizations and workspaces
    org:new <name> [slug]                     Create new isolated organization workspace
    org:members <orgId>                       List members and roles
    org:member:add <orgId> <email> <name>     Add member to workspace

  App Store & AI / MCP (Claude, Cursor, Devin, OpenAI, Gemini):
    ai "<prompt>" [--provider <name>] [--model <name>] Universal autonomous AI copilot (Claude, OpenAI, Ollama, Gemini)
    ai:key <apiKey> [--provider <name>]       Save AI provider API key in CLI config
    ai:model <modelName>                      Set default AI model (e.g. gemini-3.5-flash, gpt-4o, claude-3-5-sonnet)
    catalog:search <query> [--category <cat>] Search 2,500+ open-source template apps
    mcp                                       Run stdio MCP transport for AI IDEs (Cursor, Claude, Devin)
    mcp:tools                                 List all registered MCP tools
    mcp:call <toolName> [jsonArgs]            Execute MCP JSON-RPC tool directly
    mcp:config [cursor|claude|devin|windsurf] Output ready-to-use IDE MCP configuration JSON
    mcp:stdio                                 Run stdio MCP transport for IDEs
    users                                     List user accounts and their roles
    user:add <email> [--role developer] [--name "…"] [--password …]
                                              Create a user (a password is generated and shown once if omitted)
    user:role <email|id> <owner|admin|developer|viewer>
                                              Change a user's role
    user:disable <email|id> / user:enable <email|id>
                                              Block or allow a user (also signs them out)
    user:2fa-reset <email|id>                 Remove a user's two-factor authentication
    user:rm <email|id>                        Delete a user
    tokens                                    List personal access tokens
    token:new <label>                         Mint personal access token
`);
}

/** Finds a tunnel by its id, or by the project it exposes when that is unambiguous. */
async function findTunnel(ref) {
  if (!ref) {
    console.error("Give a tunnel id or project name (see: hosterax expose:list)");
    process.exit(1);
  }
  const list = await api("GET", "/api/tunnels");
  const hits = list.filter((t) => t.id === ref || t.target === ref);
  if (hits.length === 0) {
    console.error(`No tunnel matches "${ref}" (see: hosterax expose:list)`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(
      `"${ref}" has ${hits.length} tunnels; use one of these ids: ${hits.map((t) => t.id).join(", ")}`,
    );
    process.exit(1);
  }
  return hits[0];
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
    // ────────── All-in-One Engine & Web Dashboard Launcher ──────────
    case undefined:
    case "":
    case "start":
    case "up":
    case "server":
    case "dashboard":
    case "open": {
      if (has("help") || has("h")) {
        help();
        break;
      }
      const port = Number(flag("port") || 7777);
      const noOpen = has("no-open");
      await startEngineAndOpenDashboard(port, !noOpen);
      break;
    }

    case "engine:start": {
      const port = Number(flag("port") || 7777);
      await startEngineAndOpenDashboard(port, false);
      break;
    }

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
          Server: p.serverName && p.serverId !== "local" ? p.serverName : "local",
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
        serverId: flag("server"),
      });
      console.log("✓ created project", name, flag("server") ? `on server ${flag("server")}` : "");
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
        await api("POST", "/api/projects", {
          name,
          source,
          ...(flag("server") ? { serverId: flag("server"), target: "docker" } : {}),
        });
      }

      if (!name) {
        console.error("Usage: hosterax deploy <project-name|path>");
        process.exit(1);
      }

      const r = await api("POST", `/api/projects/${name}/deploy`, {
        trigger: flag("trigger") || "cli",
      });
      console.log(`✓ Deployment queued: ${r.id} (version: ${r.version})`);
      if (!has("no-follow")) await follow(r.id, false);
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
      await follow(r.id, false);
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
      const diag = await api("GET", `/api/projects/${encodeURIComponent(name)}/diagnostics`);
      console.log(`\nDiagnostics for ${name}`);
      console.log(
        `  Fault type:  ${diag.fault_type || "none"}  (severity: ${diag.severity || "info"})`,
      );
      console.log(`  Root cause:  ${diag.root_cause || "Unknown"}`);
      console.log(`  Suggested:   ${diag.suggested_action || "Nothing to do"}`);
      if (diag.suggested_command) console.log(`  Command:     ${diag.suggested_command}`);
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
      console.log(`  Size: ${r.sizeMb ?? 0} MB | SHA256: ${(r.sha256 || "").slice(0, 23)}…`);
      if (r.s3Synced) console.log("  Replicated to S3");
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
          Database: b.database_name,
          Engine: b.db_type,
          Project: b.project_name,
          Size: `${b.sizeMb} MB`,
          Status: b.status,
          Where: b.destination,
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

    case "backup:schedules": {
      const list = await api("GET", "/api/backups/schedules");
      if (list.length === 0) {
        console.log(
          'No backup schedules. Create one with: hosterax backup:schedule <database> --cron "0 2 * * *"',
        );
        break;
      }
      console.table(
        list.map((s) => ({
          ID: s.id,
          Database: s.databaseName,
          Cron: s.cron,
          Keep: s.keepDays ? `${s.keepLast} / ${s.keepDays}d` : s.keepLast,
          Drill: s.drill,
          Encrypted: s.encrypt ? "yes" : "no",
          Enabled: s.enabled ? "yes" : "no",
          Last: s.lastStatus ?? "never",
          Next: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : "—",
          Error: s.lastError ?? "",
        })),
      );
      break;
    }

    case "backup:schedule": {
      const target = args[0];
      const cron = flag("cron");
      if (!target || !cron) {
        console.error(
          'Usage: hosterax backup:schedule <databaseName|databaseId> --cron "0 2 * * *" [--keep 7] [--days 0] [--drill archive|restore|off] [--drill-every 7] [--encrypt]',
        );
        process.exit(1);
      }
      const body = { managedDatabase: target, cron };
      if (flag("keep")) body.keepLast = Number(flag("keep"));
      if (flag("days")) body.keepDays = Number(flag("days"));
      if (flag("drill")) body.drill = flag("drill");
      if (flag("drill-every")) body.drillEvery = Number(flag("drill-every"));
      if (has("encrypt")) body.encrypt = true;
      const s = await api("POST", "/api/backups/schedules", body);
      console.log(`✓ Schedule ${s.id} created for ${s.databaseName} (${s.cron})`);
      console.log(`  Next run: ${new Date(s.nextRunAt).toLocaleString()}`);
      console.log(
        `  Keeps the last ${s.keepLast}${s.keepDays ? ` and nothing older than ${s.keepDays} days` : ""}; verification: ${s.drill}`,
      );
      if (s.encrypt)
        console.log(
          "  Archives are encrypted — keep a copy of secret.key (or HOSTERAX_SECRET_KEY) elsewhere.",
        );
      break;
    }

    case "backup:schedule:run": {
      const id = args[0];
      if (!id) {
        console.error("Usage: hosterax backup:schedule:run <scheduleId>");
        process.exit(1);
      }
      await api("POST", `/api/backups/schedules/${id}/run`);
      console.log("✓ Started. Check the result with: hosterax backup:schedules");
      break;
    }

    case "backup:schedule:rm": {
      const id = args[0];
      if (!id) {
        console.error("Usage: hosterax backup:schedule:rm <scheduleId>");
        process.exit(1);
      }
      await api("DELETE", `/api/backups/schedules/${id}`);
      console.log(`✓ Schedule ${id} deleted (backups it already took are kept)`);
      break;
    }

    case "expose": {
      const target = args[0];
      if (!target || target.startsWith("--")) {
        console.error(
          "Usage: hosterax expose <project|edge> [--provider auto|cloudflare|localhost-run|pinggy|localtunnel|serveo|ngrok|tailscale|bore|cloudflare-token|custom] [--no-wait]\n" +
            "  ngrok:             --authtoken <token> (or NGROK_AUTHTOKEN) [--domain you.ngrok-free.app]\n" +
            "  cloudflare-token:  edge --token <token> (or CLOUDFLARE_TUNNEL_TOKEN) [--hostname apps.example.com]\n" +
            "  bore:              [--server host[:port]] [--secret <secret>]\n" +
            '  custom:            --command "zrok share public --headless {host}:{port}" --url-pattern "(https://\\\\S+)"\n' +
            "See what this machine can run with: hosterax expose:providers",
        );
        process.exit(1);
      }
      const provider = flag("provider") || "auto";
      const options = {};
      const token = flag("token") || process.env.CLOUDFLARE_TUNNEL_TOKEN;
      const authtoken = flag("authtoken") || process.env.NGROK_AUTHTOKEN;
      if (provider === "cloudflare-token" && token) options.token = token;
      if (provider === "ngrok" && authtoken) options.authtoken = authtoken;
      for (const [f, k] of [
        ["hostname", "hostname"],
        ["domain", "domain"],
        ["server", "server"],
        ["secret", "secret"],
        ["command", "command"],
        ["url-pattern", "urlPattern"],
      ])
        if (flag(f)) options[k] = flag(f);
      const created = await api("POST", "/api/tunnels", { target, provider, options });
      console.log(`Making ${target} public (${provider})…`);
      if (has("no-wait")) {
        console.log(`✓ Started tunnel ${created.id}. Check it with: hosterax expose:list`);
        break;
      }
      let t = created;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        t = await api("GET", `/api/tunnels/${created.id}`);
        if (["running", "failed", "waiting"].includes(t.status)) break;
      }
      if (t.status === "running") {
        console.log(`✓ ${target} is public${t.providerUsed ? ` through ${t.providerUsed}` : ""}:`);
        console.log(`  ${t.publicUrl || "(the address is set in your Cloudflare dashboard)"}`);
        if (t.kind === "tcp") console.log("  This is a raw TCP address, not a web page.");
        console.log(`  It restarts by itself and comes back after the engine restarts.`);
        console.log(`  Stop it with: hosterax expose:stop ${t.id}`);
      } else if (t.status === "waiting") {
        console.log(`… ${t.lastError}. It will go public by itself once the project is running.`);
      } else {
        console.error(
          `✗ Could not make ${target} public:\n${t.lastError || "no address after waiting"}`,
        );
        console.error(
          `  Details: hosterax expose:logs ${t.id}   ·   Options: hosterax expose:providers`,
        );
        process.exit(1);
      }
      break;
    }

    case "expose:list": {
      const list = await api("GET", "/api/tunnels");
      if (list.length === 0) {
        console.log("Nothing is public. Try: hosterax expose <project>");
        break;
      }
      console.table(
        list.map((t) => ({
          ID: t.id,
          Target: t.target,
          Provider: t.providerUsed || t.provider,
          Status: t.status,
          Address: t.publicUrl || "—",
          Answers: t.reachable === null ? "—" : t.reachable ? `yes (${t.checkStatus})` : "no",
          Restarts: t.restarts,
          Note: (t.lastError || "").split("\n")[0].slice(0, 70),
        })),
      );
      break;
    }

    case "expose:providers": {
      const list = await api("GET", "/api/tunnels/providers");
      console.table(
        list.map((p) => ({
          Provider: p.id,
          Account: p.needsAccount ? "needed" : "none",
          Kind: p.kind,
          "Ready here": p.ready ? `yes (${p.runsWith})` : "no",
          Auto: p.inAuto ? "yes" : "",
          Needs: (p.missing || "").replace(/ \([^)]*\)/g, ""),
        })),
      );
      console.log(
        "\nauto tries the providers marked Auto, in this order, and uses the first that works.\n" +
          "Details and limits of each: GET /api/tunnels/providers",
      );
      break;
    }

    case "expose:logs": {
      const t = await findTunnel(args[0]);
      const r = await api("GET", `/api/tunnels/${t.id}/logs`);
      console.log(r.lines.join("\n") || "(no output yet)");
      break;
    }

    case "expose:stop": {
      const t = await findTunnel(args[0]);
      await api("POST", `/api/tunnels/${t.id}/stop`);
      console.log(
        `✓ ${t.target} is no longer public (tunnel ${t.id} stopped; start it again with expose:start)`,
      );
      break;
    }

    case "expose:start": {
      const t = await findTunnel(args[0]);
      await api("POST", `/api/tunnels/${t.id}/start`);
      console.log(`✓ Tunnel ${t.id} starting. Watch it with: hosterax expose:list`);
      break;
    }

    case "expose:restart": {
      const t = await findTunnel(args[0]);
      await api("POST", `/api/tunnels/${t.id}/restart`);
      console.log(`✓ Tunnel ${t.id} restarting (its address may change)`);
      break;
    }

    case "expose:rm": {
      const t = await findTunnel(args[0]);
      await api("DELETE", `/api/tunnels/${t.id}`);
      console.log(`✓ Tunnel ${t.id} removed`);
      break;
    }

    case "expose:ip": {
      const r = await api("GET", "/api/expose/public-ip");
      if (!r.ip) {
        console.error(`✗ ${r.error}`);
        process.exit(1);
      }
      console.log(`Public IP: ${r.ip}   (HosteraX is using: ${r.configured})`);
      console.log(r.advice);
      if (has("save")) {
        await api("POST", "/api/expose/public-ip", { ip: r.ip });
        console.log(`✓ ${r.ip} saved. Magic DNS names will now use it.`);
      } else if (!r.configuredMatches) {
        console.log("Use it for Magic DNS names with: hosterax expose:ip --save");
      }
      break;
    }

    case "expose:auto": {
      const word = args[0];
      if (word === "on" || word === "off" || flag("provider")) {
        const body = {};
        if (word === "on") body.enabled = true;
        if (word === "off") body.enabled = false;
        if (flag("provider")) body.provider = flag("provider");
        const r = await api("PUT", "/api/expose/auto", body);
        console.log(
          r.enabled
            ? `✓ Every deployed project is now made public automatically (${r.provider}). Anyone with the address can open them.`
            : "✓ Automatic exposure is off. Existing tunnels keep running until you stop them.",
        );
      } else {
        const r = await api("GET", "/api/expose/auto");
        console.log(`Automatic exposure: ${r.enabled ? "on" : "off"} (provider: ${r.provider})`);
        console.log("Change it with: hosterax expose:auto on|off [--provider auto]");
      }
      break;
    }

    case "backup:verify": {
      const id = args[0];
      if (!id) {
        console.error("Usage: hosterax backup:verify <backupId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/backups/${id}/verify`);
      console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
      if (!r.ok) process.exit(1);
      break;
    }

    case "backup:drill": {
      const id = args[0];
      if (!id) {
        console.error("Usage: hosterax backup:drill <backupId>");
        process.exit(1);
      }
      await api("POST", `/api/backups/${id}/drill`);
      console.log("✓ Restore drill started (it can take a few minutes).");
      console.log(
        `  Check the result with: hosterax backup:list   (look at the backup's verify status)`,
      );
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
      console.log(`\nManaged Edge Gateway`);
      console.log(`  Provider:     ${edge.provider}`);
      console.log(`  Container:    ${edge.containerName} (${edge.containerStatus})`);
      console.log(`  Ports:        http ${edge.httpPort} · https ${edge.httpsPort}`);
      console.log(
        `  Domains:      ${edge.totalDomains} (${edge.activeSslCertificates} with active SSL)`,
      );
      break;
    }

    // ────────── Multi-Node & Cron ──────────
    case "servers": {
      const srvs = await api("GET", "/api/servers");
      if (!srvs || srvs.length === 0) {
        console.log("No servers.");
        break;
      }
      console.table(
        srvs.map((s) => ({
          ID: s.id,
          Name: s.name,
          Type: s.type,
          Host: s.type === "local" ? "this machine" : `${s.username}@${s.host}:${s.port}`,
          Status: s.status,
          "Host key": s.type === "local" ? "—" : s.host_key_pinned ? "confirmed" : "NOT CONFIRMED",
          Docker: s.docker_version || "—",
          Problem: s.last_error ? s.last_error.slice(0, 60) : "",
        })),
      );
      break;
    }

    case "server:add": {
      const name = args[0];
      const host = flag("host");
      if (!name || name.startsWith("--") || !host) {
        console.error(
          "Usage: hosterax server:add <name> --host <host> [--port 22] [--user root] [--key-file <private key>]",
        );
        process.exit(1);
      }
      const keyFile = flag("key-file");
      const body = {
        name,
        type: "remote",
        host,
        port: flag("port") ? Number(flag("port")) : 22,
        username: flag("user") || "root",
      };
      if (keyFile) body.private_key = fs.readFileSync(keyFile, "utf8");
      const srv = await api("POST", "/api/servers", body);
      console.log(`✓ Added ${srv.name} (${srv.id})`);
      console.log(
        `\nStep 1: let HosteraX log in. Add this public key to ~${srv.username}/.ssh/authorized_keys`,
      );
      console.log(
        `        on the server, or run: hosterax server:bootstrap ${srv.id}  (as root there)\n`,
      );
      console.log(`  ${srv.public_key}\n`);
      console.log(`Step 2: confirm the server's identity:  hosterax server:trust ${srv.id}`);
      console.log(`Step 3: check it:                      hosterax server:test ${srv.id}`);
      break;
    }

    case "server:trust": {
      const id = args[0];
      if (!id || id.startsWith("--")) {
        console.error(
          "Usage: hosterax server:trust <serverId> [--fingerprint SHA256:...] [--replace]",
        );
        process.exit(1);
      }
      const scan = await api("GET", `/api/servers/${id}/host-key`);
      console.log(`${scan.host}:${scan.port} presents:`);
      for (const k of scan.keys) console.log(`  ${k.type.padEnd(22)} ${k.fingerprint}`);
      if (scan.pinned) {
        console.log(
          scan.changed
            ? `\n⚠ The pinned key (${scan.pinned.fingerprint}) is NOT among them. The server was reinstalled, or the connection is being intercepted.`
            : `\nAlready confirmed: ${scan.pinned.fingerprint}`,
        );
        if (!has("replace")) break;
      }
      let want = flag("fingerprint");
      if (!want) {
        console.log(
          "\nCompare with your provider's console, or run on the server:\n  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub",
        );
        const { createInterface } = await import("node:readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise((resolve) => {
          rl.on("close", () => resolve("")); // no terminal attached: that is a "no"
          rl.question(`Trust ${scan.keys[0].fingerprint}? [y/N] `, resolve);
        });
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())) {
          console.log("Not confirmed.");
          process.exitCode = 1;
          break;
        }
        want = scan.keys[0].fingerprint;
      }
      await api("POST", `/api/servers/${id}/host-key`, {
        fingerprint: want,
        replace: has("replace"),
      });
      console.log(`✓ Host key confirmed. Next: hosterax server:test ${id}`);
      break;
    }

    case "server:test": {
      const srvId = args[0];
      if (!srvId) {
        console.error("Usage: hosterax server:test <serverId>");
        process.exit(1);
      }
      const r = await api("POST", `/api/servers/${srvId}/test`);
      console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}${r.code ? ` (${r.code})` : ""}`);
      if (!r.ok) process.exitCode = 1;
      break;
    }

    case "server:bootstrap": {
      const srvId = args[0];
      if (!srvId) {
        console.error(
          "Usage: hosterax server:bootstrap <serverId>   (pipe the output to bash on the server)",
        );
        process.exit(1);
      }
      console.log(await api("GET", `/api/servers/${srvId}/bootstrap`));
      break;
    }

    case "server:rm": {
      const srvId = args[0];
      if (!srvId) {
        console.error("Usage: hosterax server:rm <serverId>");
        process.exit(1);
      }
      await api("DELETE", `/api/servers/${srvId}`);
      console.log(`✓ Removed ${srvId}`);
      break;
    }

    case "notify:list": {
      const r = await api("GET", "/api/notifications");
      if (!r.channels.length) {
        console.log(
          "No notification channels. Add one with: hosterax notify:add <name> --type slack --url <webhook url>",
        );
        console.log(`Events: ${Object.keys(r.events).join(", ")}`);
        break;
      }
      console.table(
        r.channels.map((c) => ({
          ID: c.id,
          Name: c.name,
          Type: c.type,
          Target: c.target,
          Events: c.events.length ? c.events.join(",") : "all important",
          Enabled: c.enabled ? "✓" : "✗",
          "Last send": c.lastStatus
            ? `${c.lastStatus}${c.lastError ? `: ${c.lastError.slice(0, 40)}` : ""}`
            : "never",
        })),
      );
      break;
    }

    case "notify:add": {
      const name = args[0];
      const type = flag("type");
      if (!name || name.startsWith("--") || !type) {
        console.error(
          "Usage: hosterax notify:add <name> --type webhook|slack|discord|ntfy|email (--url <url> | --to <email,...>) [--secret <s>] [--events a,b]",
        );
        process.exit(1);
      }
      const body = { name, type };
      if (flag("url")) body.url = flag("url");
      if (flag("to")) body.to = flag("to");
      if (flag("secret")) body.secret = flag("secret");
      if (flag("events"))
        body.events = flag("events")
          .split(",")
          .map((e) => e.trim());
      const c = await api("POST", "/api/notifications", body);
      console.log(`✓ Added ${c.name} (${c.id}). Sending a test message…`);
      const t = await api("POST", `/api/notifications/${c.id}/test`);
      console.log(
        t.ok ? "✓ The test message was delivered." : `✗ The test message failed: ${t.error}`,
      );
      if (!t.ok) process.exitCode = 1;
      break;
    }

    case "notify:test": {
      if (!args[0]) {
        console.error("Usage: hosterax notify:test <id>");
        process.exit(1);
      }
      const t = await api("POST", `/api/notifications/${args[0]}/test`);
      console.log(t.ok ? "✓ Delivered." : `✗ Failed: ${t.error}`);
      if (!t.ok) process.exitCode = 1;
      break;
    }

    case "notify:rm": {
      if (!args[0]) {
        console.error("Usage: hosterax notify:rm <id>");
        process.exit(1);
      }
      await api("DELETE", `/api/notifications/${args[0]}`);
      console.log(`✓ Removed ${args[0]}`);
      break;
    }

    case "cron:list": {
      const jobs = await api("GET", "/api/jobs");
      if (!jobs || jobs.length === 0) {
        console.log("No cron jobs scheduled.");
        break;
      }
      console.table(
        jobs.map((j) => ({
          ID: j.id,
          Name: j.name,
          Schedule: j.cron_expression,
          Type: j.job_type,
          Target: j.project_name || "system",
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
      const r = await api("POST", `/api/jobs/${jobId}/run`);
      console.log(
        r.status === "success"
          ? `✓ Job finished (exit ${r.exit_code ?? 0}, ${r.duration_ms ?? 0} ms)`
          : `✗ Job ${r.status} (exit ${r.exit_code ?? "?"}): ${r.error_message || r.stderr || ""}`,
      );
      if (r.status !== "success") process.exitCode = 1;
      break;
    }

    case "s3:status": {
      const s3 = await api("GET", "/api/backups/s3-config");
      console.log(`S3 Configured: ${s3.configured ? "✓ Yes" : "✗ No"}`);
      if (s3.configured) {
        console.log(`Bucket: ${s3.bucket} (${s3.provider_type})  prefix: ${s3.prefix}`);
        console.log(`Auto-sync new snapshots: ${s3.auto_sync ? "on" : "off"}`);
      }
      break;
    }

    case "s3:sync": {
      const cfgS3 = await api("GET", "/api/backups/s3-config");
      if (!cfgS3.configured) {
        console.error("S3 is not configured. Configure it in the dashboard (Backups → Remote S3).");
        process.exit(1);
      }
      const pending = (await api("GET", "/api/backups")).filter(
        (b) => b.status === "completed" && b.existsOnDisk && b.destination !== "s3_synced",
      );
      let ok = 0;
      for (const b of pending) {
        try {
          await request("POST", `/api/backups/${b.id}/sync-s3`);
          ok++;
          console.log(`  ✓ ${b.id} → S3`);
        } catch (e) {
          console.error(`  ✗ ${b.id}: ${e.message}`);
          process.exitCode = 1;
        }
      }
      console.log(`✓ S3 sync finished: ${ok}/${pending.length} snapshot(s) uploaded`);
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

    case "mcp": {
      // `htx mcp [tools|call|config|stdio]` — also accepts the colon forms (mcp:tools …)
      const sub = args.shift();
      if (!sub || sub === "info") {
        const info = await api("GET", "/api/mcp");
        console.log(
          `MCP endpoint: ${cfg.url}/api/mcp  (${info.toolsCount} tools, protocol ${info.mcp})`,
        );
        console.log(
          "Subcommands: tools | call <tool> [jsonArgs] | config [cursor|claude|devin] | stdio",
        );
        break;
      }
      // Re-dispatch `htx mcp <sub> …` to the colon form (`htx mcp:<sub> …`), keeping stdio attached.
      const child = spawnSync(process.execPath, [process.argv[1], `mcp:${sub}`, ...args], {
        stdio: "inherit",
      });
      process.exit(child.status ?? 1);
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
                ...(cfg.token
                  ? { headers: { Authorization: "Bearer <your HosteraX token>" } }
                  : {}),
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
            ...(cfg.token ? { headers: { Authorization: "Bearer <your HosteraX token>" } } : {}),
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
        let payload;
        try {
          payload = JSON.parse(line);
          const res = await request("POST", "/api/mcp", payload);
          // JSON-RPC notifications (no id) must not be answered.
          if (payload.id !== undefined && payload.id !== null)
            process.stdout.write(JSON.stringify(res) + "\n");
        } catch (err) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload?.id ?? null,
              error: { code: payload ? -32603 : -32700, message: err.message },
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

    case "users": {
      const list = await api("GET", "/api/users");
      if (list.length === 0) {
        console.log(
          "No user accounts yet. Create the owner in the dashboard (Users & access) or with: curl -X POST <engine>/api/auth/setup",
        );
        break;
      }
      console.table(
        list.map((u) => ({
          ID: u.id,
          Email: u.email,
          Name: u.name,
          Role: u.role,
          "2FA": u.twoFactorEnabled ? "on" : "off",
          Source: u.authSource,
          Status: u.disabled ? "disabled" : "active",
          "Last sign-in": u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : "never",
        })),
      );
      break;
    }

    case "user:add": {
      const email = args[0];
      if (!email) {
        console.error(
          'Usage: hosterax user:add <email> [--role developer] [--name "…"] [--password …]',
        );
        process.exit(1);
      }
      const generated = !flag("password");
      const password = flag("password") || crypto.randomBytes(12).toString("base64url");
      const u = await api("POST", "/api/users", {
        email,
        name: flag("name") || "",
        role: flag("role") || "developer",
        password,
      });
      console.log(`✓ ${u.email} created as ${u.role} (${u.id})`);
      if (generated) {
        console.log(`  Temporary password (shown once): ${password}`);
        console.log("  Share it safely; they can change it and add two-factor in Settings.");
      }
      break;
    }

    case "user:role":
    case "user:disable":
    case "user:enable":
    case "user:2fa-reset":
    case "user:rm": {
      const target = args[0];
      if (!target || (cmd === "user:role" && !args[1])) {
        console.error(
          cmd === "user:role"
            ? "Usage: hosterax user:role <email|id> <owner|admin|developer|viewer>"
            : `Usage: hosterax ${cmd} <email|id>`,
        );
        process.exit(1);
      }
      const all = await api("GET", "/api/users");
      const user = all.find((u) => u.id === target || u.email === target.toLowerCase());
      if (!user) {
        console.error(`No user "${target}". List them with: hosterax users`);
        process.exit(1);
      }
      if (cmd === "user:role") {
        await api("PATCH", `/api/users/${user.id}`, { role: args[1] });
        console.log(`✓ ${user.email} is now ${args[1]}`);
      } else if (cmd === "user:disable" || cmd === "user:enable") {
        await api("PATCH", `/api/users/${user.id}`, { disabled: cmd === "user:disable" });
        console.log(
          `✓ ${user.email} ${cmd === "user:disable" ? "disabled and signed out" : "enabled"}`,
        );
      } else if (cmd === "user:2fa-reset") {
        await api("POST", `/api/users/${user.id}/2fa-reset`);
        console.log(`✓ Two-factor removed for ${user.email}; they were signed out`);
      } else {
        await api("DELETE", `/api/users/${user.id}`);
        console.log(`✓ ${user.email} deleted`);
      }
      break;
    }

    case "tokens": {
      const list = await api("GET", "/api/tokens");
      console.table(
        list.map((t) => ({
          ID: t.id.slice(0, 12),
          Name: t.name,
          Prefix: t.prefix,
          Scopes: (t.scopes || []).join(","),
          LastUsed: t.last_used_at ? new Date(t.last_used_at).toISOString() : "never",
        })),
      );
      break;
    }

    case "token:new": {
      // htx token:new <name> [read|deploy|admin]   (default scope: deploy)
      const [name, scope = "deploy"] = args;
      if (!name || !["read", "deploy", "admin"].includes(scope)) {
        console.error("Usage: htx token:new <name> [read|deploy|admin]");
        process.exit(1);
      }
      const res = await api("POST", "/api/tokens", { name, scopes: [scope] });
      console.log(res.token);
      console.error(`(scope: ${scope} — shown once; store it now)`);
      break;
    }

    case "token:revoke": {
      if (!args[0]) {
        console.error("Usage: htx token:revoke <idPrefix>");
        process.exit(1);
      }
      const all = await api("GET", "/api/tokens");
      const hit = all.filter((t) => t.id.startsWith(args[0]));
      if (hit.length !== 1) {
        console.error(hit.length ? "Prefix is ambiguous — use more characters." : "No such token.");
        process.exit(1);
      }
      await api("DELETE", `/api/tokens/${hit[0].id}`);
      console.log(`✓ Revoked token "${hit[0].name}"`);
      break;
    }

    // ────────── Email Stack & Webmail ──────────
    case "mail:domains": {
      const doms = await api("GET", "/api/email/domains");
      console.table(
        doms.map((d) => ({
          Domain: d.domain,
          SPF: d.spf_status,
          DKIM: d.dkim_status,
          DMARC: d.dmarc_status,
          MX: d.mx_status,
          Mailboxes: d.mailbox_count,
          Aliases: d.alias_count,
        })),
      );
      break;
    }

    case "mail:domain:add": {
      const domain = args[0];
      if (!domain) {
        console.error("Usage: htx mail:domain:add <domain.com>");
        process.exit(1);
      }
      console.log(await api("POST", "/api/email/domains", { domain }));
      break;
    }

    case "mail:boxes": {
      const domainId = args[0];
      const url = domainId
        ? `/api/email/mailboxes?domain_id=${encodeURIComponent(domainId)}`
        : "/api/email/mailboxes";
      console.table(await api("GET", url));
      break;
    }

    case "mail:box:new": {
      const [email, name, password] = args;
      if (!email || !name || !password) {
        console.error("Usage: htx mail:box:new <email> <name> <password>");
        process.exit(1);
      }
      // The API addresses a domain by id: resolve it from the email's domain part.
      const domains = await api("GET", "/api/email/domains");
      const dom = domains.find((d) => d.domain === String(email).split("@")[1]?.toLowerCase());
      if (!dom) {
        console.error(
          `No email domain registered for "${String(email).split("@")[1]}". Run: htx mail:domain:add <domain>`,
        );
        process.exit(1);
      }
      console.log(
        await api("POST", "/api/email/mailboxes", { domain_id: dom.id, email, name, password }),
      );
      break;
    }

    case "mail:aliases": {
      console.table(await api("GET", "/api/email/aliases"));
      break;
    }

    case "mail:alias:new": {
      const [alias_address, destination_email] = args;
      if (!alias_address) {
        console.error("Usage: htx mail:alias:new <alias@domain.com> [destination@domain.com]");
        process.exit(1);
      }
      const domains = await api("GET", "/api/email/domains");
      const dom = domains.find(
        (d) => d.domain === String(alias_address).split("@")[1]?.toLowerCase(),
      );
      if (!dom) {
        console.error(`No email domain registered for "${String(alias_address).split("@")[1]}".`);
        process.exit(1);
      }
      if (!destination_email) {
        console.error("A destination (email address or http(s) webhook URL) is required.");
        process.exit(1);
      }
      console.log(
        await api("POST", "/api/email/aliases", {
          domain_id: dom.id,
          source_email: alias_address,
          destination_type: /^https?:/i.test(destination_email) ? "webhook" : "email",
          destination_target: destination_email,
        }),
      );
      break;
    }

    // ────────── Webhooks & PR Previews ──────────
    case "webhooks": {
      const project = args[0];
      if (!project) {
        console.error("Usage: htx webhooks <project_name>");
        process.exit(1);
      }
      console.log(await api("GET", `/api/projects/${project}/webhook-config`));
      break;
    }

    case "previews": {
      const project = args[0];
      const url = project ? `/api/projects/${project}/previews` : "/api/previews";
      console.table(await api("GET", url));
      break;
    }

    case "preview:delete": {
      const previewId = args[0];
      if (!previewId) {
        console.error("Usage: htx preview:delete <previewId>");
        process.exit(1);
      }
      console.log(await api("DELETE", `/api/previews/${previewId}`));
      break;
    }

    // ────────── Organizations & RBAC ──────────
    case "orgs": {
      console.table(await api("GET", "/api/orgs"));
      break;
    }

    case "org:new": {
      const [name, slug] = args;
      if (!name) {
        console.error("Usage: htx org:new <name> [slug]");
        process.exit(1);
      }
      console.log(await api("POST", "/api/orgs", { name, slug }));
      break;
    }

    case "org:members": {
      const orgId = args[0];
      if (!orgId) {
        console.error("Usage: htx org:members <orgId>");
        process.exit(1);
      }
      console.table(await api("GET", `/api/orgs/${orgId}/members`));
      break;
    }

    case "org:member:add": {
      const [orgId, user_email, user_name, role] = args;
      if (!orgId || !user_email || !user_name) {
        console.error("Usage: htx org:member:add <orgId> <email> <name> [role]");
        process.exit(1);
      }
      console.log(
        await api("POST", `/api/orgs/${orgId}/members`, {
          user_email,
          user_name,
          role: role || "member",
        }),
      );
      break;
    }

    default:
      help();
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}

const FINISHED_PHASES = new Set(["ready", "success", "failed", "cancelled"]);

/**
 * Streams a deployment's logs. With keepOpen=false (deploy) it returns as soon as the deployment
 * reaches a terminal phase and sets a non-zero exit code if it failed.
 */
async function follow(id, keepOpen = true) {
  let ws = null;
  const seen = new Set();
  const print = (m) => {
    const key = `${m.ts}|${m.stream}|${m.text}`;
    if (m.stream === "replay" || !seen.has(key)) {
      seen.add(key);
      console.log(`[${m.stream}] ${m.text}`);
    }
  };

  if (typeof WebSocket !== "undefined") {
    const wsUrl =
      cfg.url.replace(/^http/, "ws") +
      "/ws?deployment=" +
      encodeURIComponent(id) +
      (cfg.token ? "&token=" + encodeURIComponent(cfg.token) : "");
    try {
      ws = new WebSocket(wsUrl);
      ws.addEventListener("message", (ev) => {
        try {
          print(JSON.parse(ev.data));
        } catch {}
      });
      ws.addEventListener("error", () => {});
    } catch {
      ws = null;
    }
  }

  // Poll the deployment so we also work on Node versions without a WebSocket global and know when to stop.
  let printed = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    let dep = null;
    try {
      dep = await request("GET", `/api/deployments/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e.status === 404) {
        console.error(`error: deployment ${id} not found`);
        process.exitCode = 1;
        break;
      }
    }
    if (!ws || ws.readyState > 1) {
      // fallback: plain log polling
      try {
        const text = await request("GET", `/api/deployments/${encodeURIComponent(id)}/logs`);
        const lines = String(text).split("\n").filter(Boolean);
        for (const line of lines.slice(printed)) console.log(line);
        printed = lines.length;
      } catch {}
    }
    if (dep && FINISHED_PHASES.has(dep.phase) && !keepOpen) {
      await new Promise((r) => setTimeout(r, 800)); // let the last websocket frames arrive
      console.log(
        dep.phase === "failed" || dep.phase === "cancelled"
          ? `✗ Deployment ${dep.version || id} ${dep.phase}`
          : `✓ Deployment ${dep.version || id} is ${dep.phase}`,
      );
      if (dep.phase === "failed" || dep.phase === "cancelled") process.exitCode = 1;
      break;
    }
  }
  try {
    ws?.close();
  } catch {}
}
