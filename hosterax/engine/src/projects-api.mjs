// HosteraX — Projects API Subsystem
// Mounted under /api by index.mjs. Every route is permission-tagged.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const PM_ENUM = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "uv",
  "poetry",
  "cargo",
  "go",
  "composer",
  "maven",
  "gradle",
  "mix",
  "dotnet",
  "none",
];
const ENVS = ["production", "preview", "development"];

export function initProjectsSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS project_env (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (project, environment, key)
);
CREATE TABLE IF NOT EXISTS project_environments (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'preview',
  git_branch TEXT,
  source_mode TEXT NOT NULL DEFAULT 'branch',
  created_at INTEGER NOT NULL,
  UNIQUE (project, slug)
);
CREATE TABLE IF NOT EXISTS route_rules (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'rate_limit',
  pattern TEXT NOT NULL DEFAULT '/*',
  value TEXT,
  action TEXT NOT NULL DEFAULT 'allow',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  stack TEXT,
  package_manager TEXT,
  dir TEXT NOT NULL,
  tarball TEXT,
  scan_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS server_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  ts INTEGER NOT NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  duration_ms INTEGER,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_server_logs_project ON server_logs(project, ts DESC);
`);
  const cols = [
    ["id", "TEXT"],
    ["slug", "TEXT"],
    ["local_path", "TEXT"],
    ["git_provider", "TEXT"],
    ["git_owner", "TEXT"],
    ["git_repo", "TEXT"],
    ["git_branch", "TEXT"],
    ["installation_id", "INTEGER"],
    ["framework", "TEXT"],
    ["package_manager", "TEXT"],
    ["install_command", "TEXT"],
    ["output_directory", "TEXT"],
    ["production_paths", "TEXT"],
    ["root_directory", "TEXT"],
    ["build_image", "TEXT"],
    ["production_mode", "TEXT"],
    ["public_endpoints_json", "TEXT"],
    ["has_server", "INTEGER"],
    ["has_build", "INTEGER"],
    ["rollback_window", "INTEGER"],
    ["cloud_archive_strategy", "TEXT"],
    ["project_type", "TEXT"],
    ["monorepo_apps_json", "TEXT"],
    ["monorepo_workspace_json", "TEXT"],
    ["monorepo_shared_paths_json", "TEXT"],
    ["routing_config_json", "TEXT"],
    ["default_rollback_strategy", "TEXT"],
    ["auto_deploy", "INTEGER"],
    ["webhook_domain", "TEXT"],
    ["clone_token", "TEXT"],
    ["enabled", "INTEGER"],
    ["sleep_mode", "TEXT"],
    ["location", "TEXT"],
    ["resources_json", "TEXT"],
    ["disk_mb", "INTEGER"],
    ["updated_at", "INTEGER"],
    ["status", "TEXT"],
    ["deleted_at", "INTEGER"],
  ];
  for (const [c, t] of cols) {
    try {
      db.exec(`ALTER TABLE projects ADD COLUMN ${c} ${t}`);
    } catch {}
  }
  try {
    db.exec("ALTER TABLE tokens ADD COLUMN scopes_json TEXT");
  } catch {}
  // backfill ids/slugs
  for (const p of db.prepare("SELECT name, id, slug FROM projects").all()) {
    if (!p.id || !p.slug) {
      db.prepare(
        "UPDATE projects SET id=COALESCE(id,?), slug=COALESCE(slug,?), enabled=COALESCE(enabled,1), location=COALESCE(location,'local') WHERE name=?",
      ).run("proj_" + crypto.randomBytes(8).toString("hex"), slugify(p.name), p.name);
    }
  }
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}
const bad = (msg, field) => {
  throw new HttpError(400, msg, field);
};
const notFound = (msg = "not found") => {
  throw new HttpError(404, msg);
};
const forbidden = (perm) => {
  throw new HttpError(403, `insufficient permission: ${perm}`);
};

const MASK = "••••••••";

export function createProjectsApi(ctx) {
  const {
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
    detectWorkspace,
    HOME,
    json,
    readBody,
    stopProject,
  } = ctx;
  const UPLOADS = path.join(HOME, "uploads");
  fs.mkdirSync(UPLOADS, { recursive: true });
  const streamTokens = new Map(); // token -> {project, exp}

  function git(args, cwd, timeoutMs = 10000) {
    return new Promise((resolve) => {
      let out = "",
        done = false;
      const c = spawn("git", args, {
        cwd,
        shell: process.platform === "win32",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
      });
      const t = setTimeout(() => {
        if (!done) {
          try {
            c.kill("SIGKILL");
          } catch {}
        }
      }, timeoutMs);
      c.stdout.on("data", (d) => (out += d));
      const fin = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(out);
      };
      c.on("close", fin);
      c.on("error", fin);
    });
  }

  function tokenScopes(req) {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const row = db.prepare("SELECT scopes_json FROM tokens WHERE token=?").get(t);
    if (!row) {
      const ip = req.socket?.remoteAddress || "";
      const isLoopback =
        ip === "127.0.0.1" ||
        ip === "::1" ||
        ip === "::ffff:127.0.0.1" ||
        ip.includes("127.0.0.1") ||
        req.headers.host?.startsWith("localhost") ||
        req.headers.host?.startsWith("127.0.0.1");
      if (isLoopback) return ["*"];
      return [];
    }
    try {
      return row.scopes_json ? JSON.parse(row.scopes_json) : ["*"];
    } catch {
      return ["*"];
    }
  }
  function requirePerm(req, perm) {
    const scopes = tokenScopes(req);
    if (scopes.includes("*") || scopes.includes(perm)) return;
    // project:admin implies write implies read/list
    const rank = {
      "project:read": 1,
      "project:list": 1,
      "project:deployment:list": 1,
      "project:write": 2,
      "project:admin": 3,
      "read": 1,
      "list": 1,
      "deploy": 2,
      "write": 2,
      "admin": 3,
    };
    const need = rank[perm] ?? 3;
    if (scopes.some((s) => (rank[s] ?? 0) >= need)) return;
    forbidden(perm);
  }

  function resolve(idOrName) {
    const p = db
      .prepare("SELECT * FROM projects WHERE id=? OR name=? OR slug=? OR LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)")
      .get(idOrName, idOrName, idOrName, idOrName, idOrName);
    if (!p) notFound("project not found");
    return p;
  }

  function isDockerRunning(name, port) {
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    try {
      const res = spawnSync(
        "docker",
        ["ps", "--filter", "status=running", "--format", "{{.Names}}\t{{.Ports}}"],
        { shell: true },
      );
      if (res.stdout) {
        const lines = res.stdout.toString().split("\n");
        for (const line of lines) {
          const [cName, cPorts] = line.split("\t");
          if (!cName) continue;
          if (
            cName.toLowerCase().includes(clean) ||
            cName.toLowerCase().includes(`hx_${clean}`)
          )
            return true;
          if (port && cPorts && cPorts.includes(`:${port}->`)) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function shape(p) {
    if (!p) return null;
    const isLive = running.has(p.name) || isDockerRunning(p.name, p.port);
    const parse = (v, d) => {
      try {
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    };
    return {
      ...p,
      id: p.id,
      name: p.name,
      slug: p.slug,
      enabled: p.enabled !== 0,
      location: p.location || "local",
      projectType: p.project_type || "app",
      source: p.source,
      localPath: p.local_path,
      git: p.git_repo
        ? {
            provider: p.git_provider || "github",
            owner: p.git_owner,
            repo: p.git_repo,
            branch: p.git_branch || "main",
            installationId: p.installation_id,
            autoDeploy: p.auto_deploy === 1,
          }
        : null,
      framework: p.framework,
      packageManager: p.package_manager,
      installCommand: p.install_command,
      buildCommand: p.build_cmd,
      startCommand: p.start_cmd,
      outputDirectory: p.output_directory,
      productionPaths: p.production_paths,
      rootDirectory: p.root_directory,
      buildImage: p.build_image,
      productionMode: p.production_mode || "host",
      port: p.port,
      publicEndpoints: parse(p.public_endpoints_json, []),
      hasServer: p.has_server !== 0,
      hasBuild: p.has_build === 1,
      rollbackWindow: p.rollback_window ?? 10,
      cloudArchiveStrategy: p.cloud_archive_strategy || "inplace",
      monorepoApps: parse(p.monorepo_apps_json, []),
      monorepoWorkspace: parse(p.monorepo_workspace_json, null),
      monorepoSharedPaths: parse(p.monorepo_shared_paths_json, null),
      routingConfig: parse(p.routing_config_json, null),
      defaultRollbackStrategy: p.default_rollback_strategy || "git",
      target: p.target,
      sleepMode: p.sleep_mode || "auto_sleep",
      resources: parse(p.resources_json, {
        production: {
          cpuCores: p.cpu_limit ?? 1,
          memoryMb: p.memory_mb_limit ?? 512,
          diskMb: p.disk_mb ?? 2048,
        },
        build: { cpuCores: 2, memoryMb: 2048, diskMb: 8192 },
      }),
      route: db.prepare("SELECT * FROM routes WHERE project=?").get(p.name) ?? null,
      domains: db
        .prepare("SELECT hostname, is_primary, verified, ssl_status FROM domains WHERE project=?")
        .all(p.name),
      status: p.status === "archived" ? "archived" : isLive ? "running" : "stopped",
      isArchived: p.status === "archived",
      deletedAt: p.deleted_at || null,
      createdAt: p.created_at,
      updatedAt: p.updated_at ?? p.created_at,
    };
  }

  // Batch version of shape() to avoid N+1 queries when listing projects
  function shapeBatch(projects) {
    if (!projects || projects.length === 0) return [];
    const names = projects.map(p => p.name);
    const placeholders = names.map(() => "?").join(",");

    // Batch fetch routes
    const routeRows = db.prepare(`SELECT * FROM routes WHERE project IN (${placeholders})`).all(...names);
    const routesByProject = new Map();
    for (const r of routeRows) routesByProject.set(r.project, r);

    // Batch fetch domains
    const domainRows = db.prepare(`SELECT project, hostname, is_primary, verified, ssl_status FROM domains WHERE project IN (${placeholders})`).all(...names);
    const domainsByProject = new Map();
    for (const d of domainRows) {
      if (!domainsByProject.has(d.project)) domainsByProject.set(d.project, []);
      domainsByProject.get(d.project).push(d);
    }

    const parse = (v, d) => {
      try { return v ? JSON.parse(v) : d; } catch { return d; }
    };

    return projects.map(p => {
      const isLive = running.has(p.name) || isDockerRunning(p.name, p.port);
      return {
        ...p,
        id: p.id, name: p.name, slug: p.slug,
        enabled: p.enabled !== 0,
        location: p.location || "local",
        projectType: p.project_type || "app",
        source: p.source, localPath: p.local_path,
        git: p.git_repo ? {
          provider: p.git_provider || "github", owner: p.git_owner, repo: p.git_repo,
          branch: p.git_branch || "main", installationId: p.installation_id, autoDeploy: p.auto_deploy === 1,
        } : null,
        framework: p.framework, packageManager: p.package_manager,
        installCommand: p.install_command, buildCommand: p.build_cmd,
        startCommand: p.start_cmd, outputDirectory: p.output_directory,
        productionPaths: p.production_paths, rootDirectory: p.root_directory,
        buildImage: p.build_image, productionMode: p.production_mode || "host",
        port: p.port,
        publicEndpoints: parse(p.public_endpoints_json, []),
        hasServer: p.has_server !== 0, hasBuild: p.has_build === 1,
        rollbackWindow: p.rollback_window ?? 10,
        cloudArchiveStrategy: p.cloud_archive_strategy || "inplace",
        monorepoApps: parse(p.monorepo_apps_json, []),
        monorepoWorkspace: parse(p.monorepo_workspace_json, null),
        monorepoSharedPaths: parse(p.monorepo_shared_paths_json, null),
        routingConfig: parse(p.routing_config_json, null),
        defaultRollbackStrategy: p.default_rollback_strategy || "git",
        target: p.target, sleepMode: p.sleep_mode || "auto_sleep",
        resources: parse(p.resources_json, {
          production: { cpuCores: p.cpu_limit ?? 1, memoryMb: p.memory_mb_limit ?? 512, diskMb: p.disk_mb ?? 2048 },
          build: { cpuCores: 2, memoryMb: 2048, diskMb: 8192 },
        }),
        route: routesByProject.get(p.name) ?? null,
        domains: domainsByProject.get(p.name) ?? [],
        status: p.status === "archived" ? "archived" : isLive ? "running" : "stopped",
        isArchived: p.status === "archived",
        deletedAt: p.deleted_at || null,
        createdAt: p.created_at,
        updatedAt: p.updated_at ?? p.created_at,
      };
    });
  }

  // ---- create / update body mapping ----
  function applyBody(name, b, isCreate) {
    const set = {},
      num = (v) => (v === undefined || v === null ? undefined : Number(v));
    const map = {
      slug: ["slug", (v) => slugify(v)],
      localPath: ["local_path", String],
      gitProvider: ["git_provider", String],
      gitOwner: ["git_owner", String],
      gitRepo: ["git_repo", String],
      gitBranch: ["git_branch", String],
      branch: ["git_branch", String],
      installationId: ["installation_id", num],
      framework: ["framework", String],
      installCommand: ["install_command", String],
      install_command: ["install_command", String],
      buildCommand: ["build_cmd", String],
      build_command: ["build_cmd", String],
      buildCmd: ["build_cmd", String],
      build_cmd: ["build_cmd", String],
      outputDirectory: ["output_directory", String],
      output_directory: ["output_directory", String],
      productionPaths: ["production_paths", String],
      production_paths: ["production_paths", String],
      rootDirectory: ["root_directory", String],
      root_directory: ["root_directory", String],
      startCommand: ["start_cmd", String],
      start_command: ["start_cmd", String],
      startCmd: ["start_cmd", String],
      start_cmd: ["start_cmd", String],
      buildImage: ["build_image", String],
      build_image: ["build_image", String],
      port: ["port", num],
      rollbackWindow: ["rollback_window", num],
      publicEndpoints: ["public_endpoints_json", JSON.stringify],
      monorepoApps: ["monorepo_apps_json", JSON.stringify],
      monorepoWorkspace: ["monorepo_workspace_json", JSON.stringify],
      monorepoSharedPaths: ["monorepo_shared_paths_json", JSON.stringify],
      routingConfig: ["routing_config_json", JSON.stringify],
      hasServer: ["has_server", (v) => (v ? 1 : 0)],
      hasBuild: ["has_build", (v) => (v ? 1 : 0)],
      target: ["target", String],
    };
    if (b.packageManager !== undefined) {
      if (!PM_ENUM.includes(b.packageManager))
        bad(`packageManager must be one of ${PM_ENUM.join(", ")}`, "packageManager");
      set.package_manager = b.packageManager;
    }
    if (b.productionMode !== undefined) {
      if (!["host", "static", "standalone"].includes(b.productionMode))
        bad("productionMode invalid", "productionMode");
      set.production_mode = b.productionMode;
    }
    if (b.projectType !== undefined) {
      if (!["app", "docker", "services", "monorepo"].includes(b.projectType))
        bad("projectType invalid", "projectType");
      set.project_type = b.projectType;
    }
    if (b.cloudArchiveStrategy !== undefined) {
      if (!["inplace", "offload"].includes(b.cloudArchiveStrategy))
        bad("cloudArchiveStrategy invalid", "cloudArchiveStrategy");
      set.cloud_archive_strategy = b.cloudArchiveStrategy;
    }
    if (b.defaultRollbackStrategy !== undefined) {
      if (!["git", "snapshot"].includes(b.defaultRollbackStrategy))
        bad("defaultRollbackStrategy invalid", "defaultRollbackStrategy");
      set.default_rollback_strategy = b.defaultRollbackStrategy;
    }
    for (const [k, [col, fn]] of Object.entries(map)) {
      if (b[k] !== undefined && b[k] !== null) set[col] = fn(b[k]);
    }
    // legacy aliases used by the CLI / dashboard
    if (b.buildCmd !== undefined) set.build_cmd = b.buildCmd;
    if (b.startCmd !== undefined) set.start_cmd = b.startCmd;
    if (b.source !== undefined) set.source = b.source;
    if (b.env && typeof b.env === "object") set.env_json = JSON.stringify(b.env);
    if (b.port !== undefined && b.port !== null && (b.port < 1 || b.port > 65535))
      bad("port out of range", "port");
    // source resolution
    const source =
      b.localPath ||
      (b.gitOwner && b.gitRepo ? `https://github.com/${b.gitOwner}/${b.gitRepo}` : b.source);
    if (source) set.source = source;
    set.updated_at = Date.now();

    if (isCreate) {
      const id = "proj_" + crypto.randomBytes(8).toString("hex");
      const assignedPort = b.port ? Number(b.port) : null;
      db.prepare(
        `INSERT INTO projects (name, source, build_cmd, start_cmd, env_json, target, created_at, id, slug, enabled, location, git_branch, project_type, sleep_mode, auto_deploy, port)
        VALUES (?,?,?,?,?,?,?,?,?,1,'local',?,?, 'auto_sleep', 0, ?)`,
      ).run(
        name,
        source || "",
        b.buildCommand || b.buildCmd || "",
        b.startCommand || "",
        "{}",
        b.target || "process",
        Date.now(),
        id,
        set.slug || slugify(name),
        b.gitBranch || "main",
        set.project_type || "app",
        assignedPort,
      );
    }
    const entries = Object.entries(set).filter(([, v]) => v !== undefined);
    if (entries.length) {
      db.prepare(
        `UPDATE projects SET ${entries.map(([c]) => `${c}=?`).join(", ")} WHERE name=?`,
      ).run(...entries.map(([, v]) => v), name);
    }
    return db.prepare("SELECT * FROM projects WHERE name=?").get(name);
  }

  function syncEnvJson(name) {
    const rows = db
      .prepare("SELECT key, value FROM project_env WHERE project=? AND environment='production'")
      .all(name);
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    db.prepare("UPDATE projects SET env_json=? WHERE name=?").run(JSON.stringify(obj), name);
  }

  function scanDir(dir) {
    const det = detectStackDir(dir);
    const compose = parseCompose(dir);
    return {
      framework: det.id,
      frameworkName: det.name,
      language: det.language,
      category: det.category,
      packageManager: det.packageManager,
      buildCommand: det.build ?? null,
      startCommand: det.start ?? null,
      installCommand: det.install ?? null,
      outputDirectory: det.outputDir ?? null,
      port: det.port ?? null,
      workspace: det.workspace?.id ?? null,
      workspaceLabel: det.workspace?.label ?? null,
      monorepo: !!det.workspace,
      projectType: compose
        ? "services"
        : fs.existsSync(path.join(dir, "Dockerfile"))
          ? "docker"
          : "app",
      services: compose?.services ?? [],
      hasBuild: !!hit?.build,
      hasServer: !!hit?.start,
    };
  }

  function maskServices(services) {
    return services.map((s) => ({
      ...s,
      env: Object.fromEntries(Object.entries(s.env || {}).map(([k]) => [k, MASK])),
    }));
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/projects")) return false;
    const M = (re) => p.match(re);
    let m;
    try {
      // ---------- collection ----------
      if (p === "/api/projects" && req.method === "GET") {
        requirePerm(req, "project:list");
        const isArchivedQuery = url.searchParams.get("archived") === "true";
        const isAllQuery = url.searchParams.get("all") === "true";
        let rows = [];
        if (isArchivedQuery) {
          rows = db
            .prepare("SELECT * FROM projects WHERE status='archived' ORDER BY deleted_at DESC, created_at DESC")
            .all();
        } else if (isAllQuery) {
          rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
        } else {
          rows = db
            .prepare("SELECT * FROM projects WHERE status != 'archived' OR status IS NULL ORDER BY created_at DESC")
            .all();
        }
        return (json(res, 200, shapeBatch(rows)), true);
      }
      if (p === "/api/projects" && req.method === "POST") {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.name || !String(b.name).trim()) bad("name is required", "name");
        const dupe = db.prepare("SELECT 1 FROM projects WHERE name=?").get(b.name);
        if (b.gitRepo && !b.gitOwner) bad("gitOwner is required with gitRepo", "gitOwner");
        return (json(res, dupe ? 200 : 201, shape(applyBody(b.name, b, !dupe))), true);
      }
      if (p === "/api/projects/home" && req.method === "GET") {
        requirePerm(req, "project:list");
        const allRows = db
          .prepare("SELECT * FROM projects WHERE status != 'archived' OR status IS NULL ORDER BY created_at DESC")
          .all();
        const local = shapeBatch(allRows);
        return (json(res, 200, { local, cloud: [], projects: local }), true);
      }
      if (p === "/api/projects/ensure" && req.method === "POST") {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        let proj = b.projectId
          ? db.prepare("SELECT * FROM projects WHERE id=? OR name=?").get(b.projectId, b.projectId)
          : db.prepare("SELECT * FROM projects WHERE name=?").get(b.name);
        if (!b.name && !proj) bad("name is required", "name");
        const name = proj?.name ?? b.name;
        proj = applyBody(name, b, !proj);
        // services (ensure owns the set)
        let services = b.services;
        const sess = b.uploadSessionId
          ? db.prepare("SELECT * FROM upload_sessions WHERE id=?").get(b.uploadSessionId)
          : null;
        const scanned = sess?.scan_json ? (JSON.parse(sess.scan_json).services ?? []) : [];
        if (!services && scanned.length) services = scanned;
        if (services) {
          const now = Date.now();
          db.prepare("DELETE FROM services WHERE project=?").run(name);
          for (const s of services) {
            const src = scanned.find((x) => x.name === s.name);
            const env = Object.fromEntries(
              Object.entries(s.env || {})
                .map(([k, v]) => [k, v === MASK ? src?.env?.[k] : v])
                .filter(([, v]) => v !== undefined),
            );
            db.prepare(
              `INSERT INTO services (id, project, name, image, build_context, ports_json, volumes_json, env_json, depends_json, status, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,'idle',?)`,
            ).run(
              "svc_" + crypto.randomBytes(6).toString("hex"),
              name,
              s.name,
              s.image ?? null,
              s.build_context ?? null,
              JSON.stringify(s.ports ?? []),
              JSON.stringify(s.volumes ?? []),
              JSON.stringify(env),
              JSON.stringify(s.depends ?? []),
              now,
            );
          }
          db.prepare("UPDATE projects SET project_type='services' WHERE name=? AND ?>0").run(
            name,
            services.length,
          );
        }
        if (sess)
          db.prepare("UPDATE projects SET git_provider='upload', local_path=? WHERE name=?").run(
            sess.dir,
            name,
          );
        return (
          json(res, 200, shape(db.prepare("SELECT * FROM projects WHERE name=?").get(name))),
          true
        );
      }
      if (p === "/api/projects/local" && req.method === "GET") {
        requirePerm(req, "project:list");
        return (
          json(
            res,
            200,
            db
              .prepare("SELECT * FROM projects WHERE location='local' OR location IS NULL")
              .all()
              .map(shape),
          ),
          true
        );
      }
      if (p === "/api/projects/scan" && req.method === "POST") {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.path) bad("path is required", "path");
        const dir = path.resolve(b.path);
        if (!fs.existsSync(dir)) notFound("path does not exist on this host");
        return (json(res, 200, { path: dir, name: path.basename(dir), ...scanDir(dir) }), true);
      }
      if (p === "/api/projects/import" && req.method === "POST") {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.path) bad("path is required", "path");
        const dir = path.resolve(b.path);
        if (!fs.existsSync(dir)) notFound("path does not exist on this host");
        const scan = scanDir(dir);
        const name = b.name || path.basename(dir);
        if (db.prepare("SELECT 1 FROM projects WHERE name=?").get(name))
          bad("a project with that name already exists", "name");
        const proj = applyBody(name, { ...scan, ...b, localPath: dir }, true);
        syncComposeServices(name, dir, null);
        return (json(res, 201, shape(proj)), true);
      }

      // ---------- folder upload ----------
      if (p === "/api/projects/folder/session" && req.method === "POST") {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        const id = "ups_" + crypto.randomBytes(10).toString("hex");
        const dir = path.join(UPLOADS, id);
        fs.mkdirSync(dir, { recursive: true });
        db.prepare(
          "INSERT INTO upload_sessions (id, name, stack, package_manager, dir, status, created_at) VALUES (?,?,?,?,?,'open',?)",
        ).run(id, b.name ?? null, b.stack ?? null, b.packageManager ?? null, dir, Date.now());
        const rel = `/api/projects/folder/upload/${id}`;
        const host = req.headers.host || `localhost:${process.env.HOSTERAX_PORT || 7777}`;
        return (
          json(res, 200, {
            sessionId: id,
            upload: {
              url: rel,
              absoluteUrl: `http://${host}${rel}`,
              method: "POST",
              headers: { "content-type": "application/gzip" },
              requiresAuth: true,
              maxBytes: 300 * 1024 * 1024,
            },
          }),
          true
        );
      }
      if ((m = M(/^\/api\/projects\/folder\/upload\/([^/]+)$/)) && req.method === "POST") {
        requirePerm(req, "project:write");
        const sess = db.prepare("SELECT * FROM upload_sessions WHERE id=?").get(m[1]);
        if (!sess) notFound("upload session not found");
        const tar = path.join(sess.dir, "source.tar.gz");
        const out = fs.createWriteStream(tar);
        let bytes = 0,
          aborted = false;
        await new Promise((resolve) => {
          req.on("data", (c) => {
            bytes += c.length;
            if (bytes > 300 * 1024 * 1024 && !aborted) {
              aborted = true;
              req.destroy();
            }
          });
          req.pipe(out);
          out.on("close", resolve);
          req.on("error", resolve);
        });
        if (aborted) {
          fs.rmSync(tar, { force: true });
          throw new HttpError(400, "tarball exceeds the 300 MB limit", "body");
        }
        db.prepare("UPDATE upload_sessions SET tarball=?, status='uploaded' WHERE id=?").run(
          tar,
          m[1],
        );
        return (json(res, 200, { sessionId: m[1], bytes }), true);
      }
      if ((m = M(/^\/api\/projects\/folder\/scan\/([^/]+)$/)) && req.method === "POST") {
        requirePerm(req, "project:write");
        const sess = db.prepare("SELECT * FROM upload_sessions WHERE id=?").get(m[1]);
        if (!sess) notFound("upload session not found");
        if (!sess.tarball || !fs.existsSync(sess.tarball))
          bad("no tarball uploaded for this session", "sessionId");
        const src = path.join(sess.dir, "src");
        fs.mkdirSync(src, { recursive: true });
        const code = await new Promise((resolve) => {
          const c = spawn("tar", ["-xzf", sess.tarball, "-C", src, "--strip-components", "0"], {
            shell: process.platform === "win32",
          });
          c.on("close", resolve);
          c.on("error", () => resolve(1));
        });
        if (code !== 0)
          throw new HttpError(400, "could not extract the tarball (expected application/gzip)");
        const entries = fs.readdirSync(src);
        const root =
          entries.length === 1 && fs.statSync(path.join(src, entries[0])).isDirectory()
            ? path.join(src, entries[0])
            : src;
        const scan = { ...scanDir(root), root, name: sess.name || path.basename(root) };
        db.prepare("UPDATE upload_sessions SET scan_json=?, status='scanned' WHERE id=?").run(
          JSON.stringify(scan),
          m[1],
        );
        return (
          json(res, 200, { ...scan, services: maskServices(scan.services), uploadSessionId: m[1] }),
          true
        );
      }

      // ---------- per project ----------
      if ((m = M(/^\/api\/projects\/([^/]+)$/))) {
        const idOrName = decodeURIComponent(m[1]);
        if (req.method === "DELETE") {
          requirePerm(req, "project:write");
          const proj = db
            .prepare(
              "SELECT * FROM projects WHERE id=? OR name=? OR slug=? OR LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)",
            )
            .get(idOrName, idOrName, idOrName, idOrName, idOrName);
          const targetName = proj?.name || idOrName;
          const targetSlug = proj?.slug || idOrName;
          const targetId = proj?.id || idOrName;
          const cleanName = targetName.toLowerCase().replace(/[^a-z0-9]/g, "_");

          const isPermanent =
            url.searchParams.get("permanent") === "true" ||
            url.searchParams.get("purge") === "true";

          stopProject?.(targetName, isPermanent ? "project purged" : "project archived");
          try {
            spawn("docker", ["rm", "-f", `hx_${cleanName}`]);
          } catch {}

          // Clean up cloned project working directories on disk (always frees 100% disk space)
          try {
            const workRoot = path.join(HOME, "work");
            if (fs.existsSync(workRoot)) {
              const entries = fs.readdirSync(workRoot);
              for (const entry of entries) {
                const eLow = entry.toLowerCase();
                if (
                  eLow === targetName.toLowerCase() ||
                  eLow === targetSlug.toLowerCase() ||
                  eLow === idOrName.toLowerCase()
                ) {
                  const targetDir = path.join(workRoot, entry);
                  try {
                    fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 5 });
                  } catch (err) {
                    console.warn(`[project-delete] Could not delete directory ${targetDir}:`, err.message);
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`[project-delete] Error cleaning work directory:`, e.message);
          }

          if (isPermanent) {
            for (const t of [
              "projects",
              "deployments",
              "domains",
              "managed_dbs",
              "services",
              "project_env",
              "project_environments",
              "route_rules",
              "webhooks",
              "self_heal_events",
            ]) {
              try {
                if (t === "projects") {
                  db.prepare(
                    "DELETE FROM projects WHERE name=? OR slug=? OR id=? OR LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)",
                  ).run(targetName, targetSlug, targetId, targetName, targetSlug);
                } else if (t === "project_env" || t === "project_environments") {
                  db.prepare(`DELETE FROM ${t} WHERE project_id=? OR project_id=?`).run(
                    targetId,
                    targetName,
                  );
                } else {
                  db.prepare(`DELETE FROM ${t} WHERE project=? OR LOWER(project)=LOWER(?)`).run(
                    targetName,
                    targetName,
                  );
                }
              } catch {}
            }
            try {
              db.prepare("DELETE FROM routes WHERE project=? OR LOWER(project)=LOWER(?)").run(
                targetName,
                targetName,
              );
            } catch {}
            return (json(res, 200, { ok: true, deleted: targetName, permanent: true }), true);
          } else {
            // Soft delete (Archive): free all disk space and containers, but preserve DB records, envs & history for 1-click restore
            db.prepare(
              "UPDATE projects SET status='archived', deleted_at=?, enabled=0 WHERE name=? OR slug=? OR id=? OR LOWER(name)=LOWER(?) OR LOWER(slug)=LOWER(?)",
            ).run(Date.now(), targetName, targetSlug, targetId, targetName, targetSlug);
            try {
              db.prepare("DELETE FROM routes WHERE project=? OR LOWER(project)=LOWER(?)").run(
                targetName,
                targetName,
              );
            } catch {}
            return (json(res, 200, { ok: true, archived: targetName, permanent: false }), true);
          }
        }

        const proj = resolve(idOrName);
        if (req.method === "GET") {
          requirePerm(req, "project:read");
          return (json(res, 200, shape(proj)), true);
        }
        if (req.method === "PATCH") {
          requirePerm(req, "project:write");
          const b = await readBody(req);
          return (json(res, 200, shape(applyBody(proj.name, b, false))), true);
        }
      }

      if (!(m = M(/^\/api\/projects\/([^/]+)\/(.+)$/))) return false;
      const proj = resolve(m[1]);
      const sub = m[2];
      const method = req.method;
      const R = (route, verb) => sub === route && method === verb;

      if (R("restore", "POST")) {
        requirePerm(req, "project:write");
        db.prepare(
          "UPDATE projects SET status='stopped', deleted_at=NULL, enabled=1 WHERE id=? OR name=?",
        ).run(proj.id, proj.name);
        return (
          json(res, 200, { ok: true, restored: proj.name, project: shape(resolve(proj.name)) }),
          true
        );
      }

      if (R("info", "GET")) {
        requirePerm(req, "project:read");
        const rec = running.get(proj.name);
        const last = db
          .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
          .get(proj.name);
        return (
          json(res, 200, {
            ...shape(proj),
            runtime: rec
              ? {
                  pid: rec.child?.pid,
                  startedAt: rec.startedAt,
                  restarts: rec.restarts,
                  command: rec.cmd,
                  workdir: rec.workdir,
                }
              : null,
            build: {
              installCommand: proj.install_command,
              buildCommand: proj.build_cmd,
              startCommand: proj.start_cmd,
              image: proj.build_image,
            },
            lastDeployment: last ?? null,
            services: db.prepare("SELECT * FROM services WHERE project=?").all(proj.name),
          }),
          true
        );
      }
      if (R("deletion-preview", "GET")) {
        requirePerm(req, "project:read");
        const c = (sql) => db.prepare(sql).get(proj.name).c;
        return (
          json(res, 200, {
            project: proj.name,
            deployments: c("SELECT COUNT(*) c FROM deployments WHERE project=?"),
            domains: c("SELECT COUNT(*) c FROM domains WHERE project=?"),
            databases: c("SELECT COUNT(*) c FROM managed_dbs WHERE project=?"),
            envVars: c("SELECT COUNT(*) c FROM project_env WHERE project=?"),
            services: c("SELECT COUNT(*) c FROM services WHERE project=?"),
            routeRules: c("SELECT COUNT(*) c FROM route_rules WHERE project=?"),
            runningProcess: running.has(proj.name),
          }),
          true
        );
      }
      if (R("environments", "GET")) {
        requirePerm(req, "project:read");
        const rows = db
          .prepare("SELECT * FROM project_environments WHERE project=? ORDER BY created_at")
          .all(proj.name);
        return (
          json(res, 200, [
            {
              id: "env_production",
              name: "Production",
              slug: "production",
              type: "production",
              git_branch: proj.git_branch || "main",
              source_mode: "branch",
              builtin: true,
            },
            ...rows,
          ]),
          true
        );
      }
      if (R("environments", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.environmentName) bad("environmentName is required", "environmentName");
        const type = b.environmentType || "preview";
        if (!ENVS.includes(type)) bad("environmentType invalid", "environmentType");
        const row = {
          id: "env_" + crypto.randomBytes(6).toString("hex"),
          slug: slugify(b.environmentSlug || b.environmentName),
        };
        db.prepare(
          "INSERT INTO project_environments (id, project, name, slug, type, git_branch, source_mode, created_at) VALUES (?,?,?,?,?,?,?,?)",
        ).run(
          row.id,
          proj.name,
          b.environmentName,
          row.slug,
          type,
          b.gitBranch ?? null,
          b.sourceMode || "branch",
          Date.now(),
        );
        return (
          json(res, 201, db.prepare("SELECT * FROM project_environments WHERE id=?").get(row.id)),
          true
        );
      }
      if (R("options", "POST")) {
        requirePerm(req, "project:write");
        return (json(res, 200, shape(applyBody(proj.name, await readBody(req), false))), true);
      }
      if (R("enable", "POST") || R("disable", "POST")) {
        requirePerm(req, "project:write");
        const on = sub === "enable";
        db.prepare("UPDATE projects SET enabled=?, updated_at=? WHERE name=?").run(
          on ? 1 : 0,
          Date.now(),
          proj.name,
        );
        if (!on) stopProject?.(proj.name, "project disabled");
        return (json(res, 200, { ok: true, enabled: on }), true);
      }
      if (R("routing/retry", "POST")) {
        requirePerm(req, "project:write");
        const r = applyRoute(proj.name, proj.port ?? null, null, null);
        return (
          json(res, 200, {
            ...r,
            route: db.prepare("SELECT * FROM routes WHERE project=?").get(proj.name),
          }),
          true
        );
      }

      // env
      if (R("env", "GET")) {
        requirePerm(req, "project:read");
        const env = url.searchParams.get("environment") || "production";
        const rows = db
          .prepare(
            "SELECT key, value, is_secret, environment, updated_at FROM project_env WHERE project=? AND environment=? ORDER BY key",
          )
          .all(proj.name, env);
        return (
          json(
            res,
            200,
            rows.map((r) => ({
              key: r.key,
              value: r.is_secret ? MASK : r.value,
              isSecret: r.is_secret === 1,
              environment: r.environment,
              updatedAt: r.updated_at,
            })),
          ),
          true
        );
      }
      if (R("env", "PATCH")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        const env = b.environment || "production";
        if (!ENVS.includes(env)) bad("environment invalid", "environment");
        const upserts = b.upserts ?? [],
          deletes = b.deletes ?? [];
        if (!Array.isArray(upserts) || !Array.isArray(deletes))
          bad("upserts and deletes must be arrays", "upserts");
        const count = db
          .prepare("SELECT COUNT(*) c FROM project_env WHERE project=?")
          .get(proj.name).c;
        if (count + upserts.length > 100)
          bad("a project may hold at most 100 environment variables", "upserts");
        const now = Date.now();
        const tx = db.transaction(() => {
          for (const u of upserts) {
            if (!u?.key) bad("each upsert needs a key", "upserts");
            if (u.value === MASK) continue; // never persist a masked read-back
            db.prepare(
              `INSERT INTO project_env (id, project, environment, key, value, is_secret, updated_at) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(project, environment, key) DO UPDATE SET value=excluded.value, is_secret=excluded.is_secret, updated_at=excluded.updated_at`,
            ).run(
              "pev_" + crypto.randomBytes(6).toString("hex"),
              proj.name,
              env,
              u.key,
              String(u.value ?? ""),
              u.isSecret ? 1 : 0,
              now,
            );
          }
          for (const k of deletes)
            db.prepare("DELETE FROM project_env WHERE project=? AND environment=? AND key=?").run(
              proj.name,
              env,
              k,
            );
        });
        tx();
        syncEnvJson(proj.name);
        const rows = db
          .prepare(
            "SELECT key, value, is_secret FROM project_env WHERE project=? AND environment=? ORDER BY key",
          )
          .all(proj.name, env);
        return (
          json(
            res,
            200,
            rows.map((r) => ({
              key: r.key,
              value: r.is_secret ? MASK : r.value,
              isSecret: r.is_secret === 1,
            })),
          ),
          true
        );
      }

      // clone token
      if (R("clone-token", "GET")) {
        requirePerm(req, "project:read");
        return (
          json(res, 200, { token: proj.clone_token ? MASK : null, configured: !!proj.clone_token }),
          true
        );
      }
      if (R("clone-token", "PATCH")) {
        requirePerm(req, "project:admin");
        const b = await readBody(req);
        db.prepare("UPDATE projects SET clone_token=? WHERE name=?").run(
          b.token ?? null,
          proj.name,
        );
        return (json(res, 200, { ok: true, configured: !!b.token }), true);
      }

      // git
      if (R("git", "GET")) {
        requirePerm(req, "project:read");
        return (json(res, 200, shape(proj).git), true);
      }
      if (R("git/link", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.owner) bad("owner is required", "owner");
        if (!b.repo) bad("repo is required", "repo");
        db.prepare(
          "UPDATE projects SET git_provider='github', git_owner=?, git_repo=?, git_branch=?, installation_id=?, source=?, updated_at=? WHERE name=?",
        ).run(
          b.owner,
          b.repo,
          b.branch || proj.git_branch || "main",
          b.installationId ?? null,
          `https://github.com/${b.owner}/${b.repo}`,
          Date.now(),
          proj.name,
        );
        return (json(res, 200, shape(resolve(proj.name)).git), true);
      }
      if (R("branch", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.branch) bad("branch is required", "branch");
        db.prepare("UPDATE projects SET git_branch=? WHERE name=?").run(b.branch, proj.name);
        db.prepare("UPDATE webhooks SET branch=? WHERE project=?").run(b.branch, proj.name);
        return (json(res, 200, { ok: true, branch: b.branch }), true);
      }
      if (R("auto-deploy", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        const on = b.enabled !== false;
        db.prepare("UPDATE projects SET auto_deploy=? WHERE name=?").run(on ? 1 : 0, proj.name);
        return (json(res, 200, { ok: true, autoDeploy: on }), true);
      }
      if (R("webhook-domain", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.domain) bad("domain is required", "domain");
        db.prepare("UPDATE projects SET webhook_domain=? WHERE name=?").run(b.domain, proj.name);
        return (
          json(res, 200, {
            ok: true,
            deliveryUrl: `https://${b.domain}/webhooks/github/${proj.name}`,
          }),
          true
        );
      }
      if (R("branches", "GET")) {
        requirePerm(req, "project:read");
        if (!proj.source) return (json(res, 200, { branches: [], default: null }), true);
        const out = await git(["ls-remote", "--heads", proj.source]);
        const branches = out
          .split("\n")
          .map((l) => l.split("refs/heads/")[1])
          .filter(Boolean);
        return (json(res, 200, { branches, default: proj.git_branch || "main" }), true);
      }
      if (R("commit-status", "GET")) {
        requirePerm(req, "project:read");
        const last = db
          .prepare(
            "SELECT * FROM deployments WHERE project=? AND phase='ready' ORDER BY started_at DESC LIMIT 1",
          )
          .get(proj.name);
        let deployed = null;
        if (last?.workdir && fs.existsSync(path.join(last.workdir, ".git"))) {
          deployed = (await git(["rev-parse", "HEAD"], last.workdir)).trim() || null;
        }
        const branch = proj.git_branch || "main";
        const remote = proj.source
          ? (await git(["ls-remote", proj.source, `refs/heads/${branch}`])).split("\t")[0] || null
          : null;

        return (
          json(res, 200, {
            branch,
            deployed,
            remote,
            behind: !!(deployed && remote && deployed !== remote),
          }),
          true
        );
      }

      // resources
      if (R("resources", "GET")) {
        requirePerm(req, "project:read");
        return (
          json(res, 200, {
            ...shape(proj).resources,
            sleepMode: proj.sleep_mode || "auto_sleep",
            port: proj.port ?? null,
          }),
          true
        );
      }
      if (R("resources", "PATCH") || R("resources", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        const cur = shape(proj).resources;
        const chk = (blk, label) => {
          if (!blk) return;
          if (blk.cpuCores !== undefined && (blk.cpuCores <= 0 || blk.cpuCores > 4))
            bad(`${label}.cpuCores must be between 0 and 4`, `${label}.cpuCores`);
          if (
            blk.memoryMb !== undefined &&
            (blk.memoryMb < 128 || blk.memoryMb > os.totalmem() / 1048576)
          )
            bad(`${label}.memoryMb out of range`, `${label}.memoryMb`);
          if (blk.diskMb !== undefined && blk.diskMb < 256)
            bad(`${label}.diskMb must be at least 256`, `${label}.diskMb`);
        };
        chk(b.production, "production");
        chk(b.build, "build");
        if (b.sleepMode && !["auto_sleep", "always_on"].includes(b.sleepMode))
          bad("sleepMode invalid", "sleepMode");
        if (b.port !== undefined && (b.port < 1 || b.port > 65535))
          bad("port out of range", "port");
        const next = {
          production: { ...cur.production, ...(b.production || {}) },
          build: { ...cur.build, ...(b.build || {}) },
        };
        db.prepare(
          "UPDATE projects SET resources_json=?, cpu_limit=?, memory_mb_limit=?, disk_mb=?, sleep_mode=COALESCE(?, sleep_mode), port=COALESCE(?, port), updated_at=? WHERE name=?",
        ).run(
          JSON.stringify(next),
          next.production.cpuCores ?? null,
          next.production.memoryMb ?? null,
          next.production.diskMb ?? null,
          b.sleepMode ?? null,
          b.port ?? null,
          Date.now(),
          proj.name,
        );
        const after = resolve(proj.name);
        return (
          json(res, 200, {
            ...shape(after).resources,
            sleepMode: after.sleep_mode,
            port: after.port,
          }),
          true
        );
      }
      if (R("sleep-mode", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!["auto_sleep", "always_on"].includes(b.sleepMode))
          bad("sleepMode must be auto_sleep or always_on", "sleepMode");
        db.prepare("UPDATE projects SET sleep_mode=? WHERE name=?").run(b.sleepMode, proj.name);
        return (json(res, 200, { ok: true, sleepMode: b.sleepMode }), true);
      }

      // deployments
      if (R("deployments", "GET")) {
        requirePerm(req, "project:deployment:list");
        const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
        return (
          json(
            res,
            200,
            db
              .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT ?")
              .all(proj.name, limit),
          ),
          true
        );
      }
      if (R("deployment-session", "POST")) {
        requirePerm(req, "project:read");
        const last = db
          .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
          .get(proj.name);
        const host = req.headers.host || `localhost:${process.env.HOSTERAX_PORT || 7777}`;
        const tok = "sess_" + crypto.randomBytes(12).toString("hex");
        streamTokens.set(tok, { project: proj.name, exp: Date.now() + 3600e3 });
        return (
          json(res, 200, {
            sessionId: tok,
            readOnly: true,
            deployment: last ?? null,
            websocket: last ? `ws://${host}/ws?deployment=${last.id}` : null,
            runtimeWebsocket: `ws://${host}/ws?project=${encodeURIComponent(proj.name)}`,
          }),
          true
        );
      }
      if (R("connect", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!b.domain) bad("domain is required", "domain");
        const add = (host, primary) =>
          db
            .prepare(
              `INSERT INTO domains (id, project, hostname, verified, is_primary, ssl_status, challenge_token, created_at)
          VALUES (?,?,?,0,?, 'none', ?, ?) ON CONFLICT(hostname) DO UPDATE SET project=excluded.project, is_primary=excluded.is_primary`,
            )
            .run(
              "dom_" + crypto.randomBytes(6).toString("hex"),
              proj.name,
              host,
              primary ? 1 : 0,
              crypto.randomBytes(8).toString("hex"),
              Date.now(),
            );
        db.prepare("UPDATE domains SET is_primary=0 WHERE project=?").run(proj.name);
        add(b.domain, true);
        if (b.includeWww && !b.domain.startsWith("www.")) add("www." + b.domain, false);
        applyRoute(proj.name, proj.port ?? null, b.domain, null);
        return (
          json(res, 200, {
            ok: true,
            primary: b.domain,
            externalIngress: !!b.externalIngress,
            domains: db.prepare("SELECT * FROM domains WHERE project=?").all(proj.name),
          }),
          true
        );
      }

      // deployment logs
      if ((m = sub.match(/^deployments\/([^/]+)\/logs$/)) && method === "GET") {
        requirePerm(req, "project:read");
        const depId = m[1];
        const logPath = path.join(HOME, "logs", depId + ".log");
        const lines = [];
        if (fs.existsSync(logPath)) {
          const raw = fs.readFileSync(logPath, "utf8");
          for (const l of raw.split("\n").filter(Boolean)) {
            const match = l.match(/^\[(.*?)\] (.*?): (.*)$/);
            if (match) {
              lines.push({ ts: new Date(match[1]).getTime(), stream: match[2], text: match[3] });
            } else {
              lines.push({ ts: Date.now(), stream: "stdout", text: l });
            }
          }
        }
        return (json(res, 200, { deploymentId: depId, lines }), true);
      }

      // logs
      if (R("logs", "GET")) {
        requirePerm(req, "project:read");
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
        let buf = [...(runtimeLogs.get(proj.name) ?? [])];
        if (buf.length === 0) {
          const latest = db
            .prepare("SELECT id FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
            .get(proj.name);
          if (latest?.id) {
            const logPath = path.join(HOME, "logs", latest.id + ".log");
            if (fs.existsSync(logPath)) {
              const raw = fs.readFileSync(logPath, "utf8");
              for (const l of raw.split("\n").filter(Boolean)) {
                const match = l.match(/^\[(.*?)\] (.*?): (.*)$/);
                if (match) {
                  buf.push({ ts: new Date(match[1]).getTime(), stream: match[2], text: match[3] });
                } else {
                  buf.push({ ts: Date.now(), stream: "stdout", text: l });
                }
              }
            }
          }
        }
        return (json(res, 200, { project: proj.name, lines: buf.slice(-limit) }), true);
      }
      if (R("logs/stream", "GET")) {
        requirePerm(req, "project:read");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        const initial = [];
        const latest = db
          .prepare("SELECT id FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
          .get(proj.name);
        if (latest?.id) {
          const logPath = path.join(HOME, "logs", latest.id + ".log");
          if (fs.existsSync(logPath)) {
            const raw = fs.readFileSync(logPath, "utf8");
            for (const l of raw.split("\n").filter(Boolean)) {
              const match = l.match(/^\[(.*?)\] (.*?): (.*)$/);
              if (match) {
                initial.push({ ts: new Date(match[1]).getTime(), stream: match[2], text: match[3] });
              } else {
                initial.push({ ts: Date.now(), stream: "stdout", text: l });
              }
            }
          }
        }
        const rBuf = runtimeLogs.get(proj.name) ?? [];
        for (const l of rBuf) {
          if (!initial.some((x) => x.text === l.text && Math.abs((x.ts || 0) - (l.ts || 0)) < 1500)) {
            initial.push(l);
          }
        }
        for (const l of initial.slice(-300)) {
          res.write(`data: ${JSON.stringify(l)}\n\n`);
        }
        let last = (runtimeLogs.get(proj.name) ?? []).length;
        const t = setInterval(() => {
          const buf = runtimeLogs.get(proj.name) ?? [];
          for (const l of buf.slice(last)) res.write(`data: ${JSON.stringify(l)}\n\n`);
          last = buf.length;
          res.write(": ping\n\n");
        }, 1000);
        req.on("close", () => clearInterval(t));
        return true;
      }
      if (R("server-logs/recent", "GET")) {
        requirePerm(req, "project:read");
        const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
        return (
          json(
            res,
            200,
            db
              .prepare("SELECT * FROM server_logs WHERE project=? ORDER BY ts DESC LIMIT ?")
              .all(proj.name, limit),
          ),
          true
        );
      }
      if (R("server-logs/stream-token", "GET")) {
        requirePerm(req, "project:read");
        const tok = "slt_" + crypto.randomBytes(12).toString("hex");
        streamTokens.set(tok, { project: proj.name, exp: Date.now() + 300e3 });
        return (json(res, 200, { token: tok, expiresIn: 300 }), true);
      }
      if (R("server-logs/stream", "GET")) {
        const qt = url.searchParams.get("token");
        const entry = qt ? streamTokens.get(qt) : null;
        if (!entry || entry.project !== proj.name || entry.exp < Date.now())
          requirePerm(req, "project:read");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        let lastId = db
          .prepare("SELECT COALESCE(MAX(id),0) m FROM server_logs WHERE project=?")
          .get(proj.name).m;
        const t = setInterval(() => {
          const rows = db
            .prepare("SELECT * FROM server_logs WHERE project=? AND id>? ORDER BY id")
            .all(proj.name, lastId);
          for (const r of rows) {
            lastId = r.id;
            res.write(`data: ${JSON.stringify(r)}\n\n`);
          }
          res.write(": ping\n\n");
        }, 1000);
        req.on("close", () => clearInterval(t));
        return true;
      }

      // route rules (self-hosted only)
      if (R("route-rules", "GET")) {
        requirePerm(req, "project:read");
        return (
          json(
            res,
            200,
            db
              .prepare("SELECT * FROM route_rules WHERE project=? ORDER BY created_at")
              .all(proj.name),
          ),
          true
        );
      }
      if (R("route-rules", "POST")) {
        requirePerm(req, "project:write");
        const b = await readBody(req);
        if (!["rate_limit", "ban", "allow", "deny"].includes(b.kind || ""))
          bad("kind must be rate_limit, ban, allow or deny", "kind");
        const id = "rr_" + crypto.randomBytes(6).toString("hex");
        db.prepare(
          "INSERT INTO route_rules (id, project, kind, pattern, value, action, enabled, created_at) VALUES (?,?,?,?,?,?,?,?)",
        ).run(
          id,
          proj.name,
          b.kind,
          b.pattern || "/*",
          b.value ?? null,
          b.action || (b.kind === "deny" || b.kind === "ban" ? "deny" : "allow"),
          b.enabled === false ? 0 : 1,
          Date.now(),
        );
        return (json(res, 201, db.prepare("SELECT * FROM route_rules WHERE id=?").get(id)), true);
      }
      if ((m = sub.match(/^route-rules\/([^/]+)$/))) {
        const rule = db
          .prepare("SELECT * FROM route_rules WHERE id=? AND project=?")
          .get(m[1], proj.name);
        if (!rule) notFound("route rule not found");
        if (method === "PATCH") {
          requirePerm(req, "project:write");
          const b = await readBody(req);
          db.prepare(
            "UPDATE route_rules SET kind=COALESCE(?,kind), pattern=COALESCE(?,pattern), value=COALESCE(?,value), action=COALESCE(?,action), enabled=COALESCE(?,enabled) WHERE id=?",
          ).run(
            b.kind ?? null,
            b.pattern ?? null,
            b.value ?? null,
            b.action ?? null,
            b.enabled === undefined ? null : b.enabled ? 1 : 0,
            rule.id,
          );
          return (
            json(res, 200, db.prepare("SELECT * FROM route_rules WHERE id=?").get(rule.id)),
            true
          );
        }
        if (method === "DELETE") {
          requirePerm(req, "project:write");
          db.prepare("DELETE FROM route_rules WHERE id=?").run(rule.id);
          return (json(res, 200, { ok: true }), true);
        }
      }

      // transfer (self-hosted only)
      if (R("transfer/to-cloud", "POST") || R("transfer/to-self-hosted", "POST")) {
        requirePerm(req, "project:admin");
        const toCloud = sub.endsWith("to-cloud");
        db.prepare("UPDATE projects SET location=?, updated_at=? WHERE name=?").run(
          toCloud ? "cloud" : "local",
          Date.now(),
          proj.name,
        );
        if (toCloud) stopProject?.(proj.name, "transferred to cloud");
        return (
          json(res, 200, {
            ok: true,
            location: toCloud ? "cloud" : "local",
            project: shape(resolve(proj.name)),
          }),
          true
        );
      }

      // deploy passthrough kept from the legacy engine surface
      if (R("deploy", "POST")) {
        requirePerm(req, "project:write");
        if (proj.enabled === 0)
          throw new HttpError(400, "project is disabled — enable it before deploying");
        const b = await readBody(req);
        return (
          json(
            res,
            200,
            await runDeployment(proj.name, { trigger: b.trigger, environment: b.environment }),
          ),
          true
        );
      }

      return false;
    } catch (e) {
      if (e instanceof HttpError)
        return (json(res, e.status, { error: e.message, field: e.field }), true);
      return (json(res, 500, { error: String(e) }), true);
    }
  }

  return { handle, scanDir, shape };
}
