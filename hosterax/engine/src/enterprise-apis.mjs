// hosterax/engine/src/enterprise-apis.mjs
// Enterprise APIs: Audit Logging, SIEM Forwarding, Database Query Proxy, Secrets Vault,
// Fleet Security Scanner & Policy, Edge Middlewares, Status Page & Synthetic Probes,
// OAuth/MCP Client Registry & PKCE, Webhook Deliveries, and Org Scoping helpers.

import crypto from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encryptSecret, decryptSecret } from "./secrets.mjs";
import {
  isSafeContainerName,
  isSafeHostname,
  isSafeImageRef,
  hashToken,
} from "./security.mjs";

const execFileAsync = promisify(execFile);

const SENSITIVE_COL_RE =
  /^(.*_)?(token|password|password_hash|secret|secret_access_key|totp_secret|env_json|clone_token|api_key|api_key_enc|ssh_key|private_key|value_enc|client_secret_hash)(_.*)?$/i;

const WRITE_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|REINDEX|VACUUM|CREATE|REPLACE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|LOAD_EXTENSION)\b/i;

export function validateReadOnlySql(rawSql) {
  let s = String(rawSql || "").trim();
  if (!s) throw new Error("SQL query is required");
  if (s.length > 8000) throw new Error("SQL query exceeds 8000 character limit");
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (!s) throw new Error("SQL query is required");

  // Strip single-quoted string literals before checking for semicolons or write verbs
  const scrubbed = s
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  if (scrubbed.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed");
  }
  if (WRITE_SQL_RE.test(scrubbed)) {
    throw new Error("Only read-only SELECT, PRAGMA, or EXPLAIN queries are allowed");
  }
  if (/^\s*PRAGMA\b/i.test(scrubbed)) {
    if (scrubbed.includes("=") || /\bwritable_schema\b/i.test(scrubbed)) {
      throw new Error("Mutating PRAGMA statements are not allowed");
    }
    return s;
  }
  if (!/^\s*(SELECT|EXPLAIN|WITH)\b/i.test(scrubbed)) {
    throw new Error("Only read-only SELECT, WITH, PRAGMA, or EXPLAIN queries are permitted");
  }
  return s;
}

export function maskSensitiveRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SENSITIVE_COL_RE.test(k) && v !== null && v !== undefined && v !== "") {
      out[k] = "••••••••";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function normalizeGitRepoSlug(source) {
  const s = String(source || "").trim();
  if (!s) return "";
  // git@github.com:owner/repo.git
  const ssh = s.match(/^git@[^:]+:([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  if (ssh) return ssh[1].toLowerCase();
  // https://github.com/owner/repo(.git) or ssh://...
  try {
    const u = new URL(s);
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`.toLowerCase();
  } catch {}
  return "";
}

export function resolveOrgId(req, url) {
  const hdr = req?.headers?.["x-hosterax-org"];
  const q = url?.searchParams?.get("orgId");
  const raw = String(hdr || q || "default").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : "default";
}

export function evaluateContainerPosture(inspectData) {
  const cfg = inspectData?.Config || {};
  const hostCfg = inspectData?.HostConfig || {};
  const state = inspectData?.State || {};
  const name = String(inspectData?.Name || "").replace(/^\//, "");
  const image = cfg.Image || "unknown";
  const findings = [];

  if (hostCfg.Privileged) {
    findings.push({
      severity: "critical",
      code: "PRIVILEGED_CONTAINER",
      title: "Container runs in --privileged mode",
      remediation: "Remove Privileged=true and drop unnecessary Linux capabilities.",
    });
  }
  if (hostCfg.NetworkMode === "host" && name !== "hx_edge") {
    findings.push({
      severity: "high",
      code: "HOST_NETWORK_NAMESPACE",
      title: "Container shares host network namespace",
      remediation: "Use an isolated bridge network unless binding host low-level ports.",
    });
  }
  const user = String(cfg.User || "").trim();
  if (!user || user === "0" || user === "root") {
    findings.push({
      severity: "medium",
      code: "RUNNING_AS_ROOT",
      title: "Container process runs as UID 0 (root)",
      remediation: "Specify a non-root USER in Dockerfile or container runtime config.",
    });
  }
  if (!hostCfg.ReadonlyRootfs) {
    findings.push({
      severity: "low",
      code: "WRITABLE_ROOTFS",
      title: "Container root filesystem is writable",
      remediation: "Enable ReadonlyRootfs with explicit tmpfs/volume mounts where supported.",
    });
  }
  if (!hostCfg.Memory && !hostCfg.NanoCpus) {
    findings.push({
      severity: "low",
      code: "UNBOUNDED_RESOURCES",
      title: "No CPU or memory cgroup limit configured",
      remediation: "Configure Memory and CPU quotas in Project Resources.",
    });
  }
  const mounts = Array.isArray(inspectData?.Mounts) ? inspectData.Mounts : [];
  if (mounts.some((m) => String(m?.Source || "") === "/var/run/docker.sock")) {
    findings.push({
      severity: "high",
      code: "DOCKER_SOCKET_MOUNTED",
      title: "Docker socket mounted inside container",
      remediation: "Avoid mounting docker.sock into workload containers.",
    });
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (counts[f.severity] !== undefined) counts[f.severity] += 1;
  }

  return {
    container: name,
    image,
    running: Boolean(state.Running),
    counts,
    findings,
  };
}

export function ensureEnterpriseSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      actor_email TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details_json TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS vault_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      linked_projects_json TEXT NOT NULL DEFAULT '[]',
      sync_mode TEXT NOT NULL DEFAULT 'manual',
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_secrets (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_enc TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(group_id) REFERENCES vault_groups(id) ON DELETE CASCADE,
      UNIQUE(group_id, key)
    );

    CREATE TABLE IF NOT EXISTS security_scans (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      target TEXT NOT NULL,
      target_type TEXT NOT NULL,
      scanner_backend TEXT NOT NULL,
      critical INTEGER NOT NULL DEFAULT 0,
      high INTEGER NOT NULL DEFAULT 0,
      medium INTEGER NOT NULL DEFAULT 0,
      low INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      summary TEXT,
      findings_json TEXT NOT NULL DEFAULT '[]',
      scanned_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_security_scans_at ON security_scans(scanned_at DESC);

    CREATE TABLE IF NOT EXISTS security_policy (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      block_critical INTEGER NOT NULL DEFAULT 0,
      block_high INTEGER NOT NULL DEFAULT 0,
      enforce_non_root INTEGER NOT NULL DEFAULT 0,
      require_sbom INTEGER NOT NULL DEFAULT 0,
      max_cvss REAL DEFAULT 9.0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS siem_sinks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      api_key_enc TEXT DEFAULT '',
      min_level TEXT NOT NULL DEFAULT 'INFO',
      filter_source TEXT NOT NULL DEFAULT 'all',
      enabled INTEGER NOT NULL DEFAULT 1,
      batch_size INTEGER NOT NULL DEFAULT 50,
      last_flush_at INTEGER,
      events_sent INTEGER NOT NULL DEFAULT 0,
      events_failed INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS siem_deliveries (
      id TEXT PRIMARY KEY,
      sink_id TEXT NOT NULL,
      status_code INTEGER,
      ok INTEGER NOT NULL DEFAULT 0,
      events_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      latency_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(sink_id) REFERENCES siem_sinks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS edge_middlewares (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_target TEXT NOT NULL DEFAULT '*',
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      hits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_page_settings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'HosteraX System Status',
      custom_domain TEXT NOT NULL DEFAULT '',
      public_enabled INTEGER NOT NULL DEFAULT 1,
      subscribe_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_components (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT 'Core Infrastructure',
      target_url TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'operational',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      uptime_pct REAL NOT NULL DEFAULT 100.0,
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'investigating',
      impact TEXT NOT NULL DEFAULT 'minor',
      message TEXT NOT NULL DEFAULT '',
      component_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS status_probes (
      id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error_message TEXT,
      checked_at INTEGER NOT NULL,
      FOREIGN KEY(component_id) REFERENCES status_components(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_status_probes_comp ON status_probes(component_id, checked_at DESC);

    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      client_id TEXT NOT NULL UNIQUE,
      client_secret_hash TEXT DEFAULT '',
      redirect_uris_json TEXT NOT NULL DEFAULT '[]',
      scopes_json TEXT NOT NULL DEFAULT '["read"]',
      client_type TEXT NOT NULL DEFAULT 'confidential',
      mcp_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT,
      user_email TEXT,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      user_email TEXT,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      project_name TEXT,
      provider TEXT NOT NULL DEFAULT 'github',
      event TEXT NOT NULL,
      delivery_guid TEXT,
      status_code INTEGER NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      action TEXT,
      message TEXT,
      payload_json TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_at ON webhook_deliveries(received_at DESC);
  `);

  for (const tbl of ["projects", "managed_dbs", "domains", "tokens"]) {
    try {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN org_id TEXT DEFAULT 'default'`);
    } catch {}
  }

  // Ensure default status page config row exists
  if (!db.prepare("SELECT 1 FROM status_page_settings WHERE id='default'").get()) {
    db.prepare(
      "INSERT INTO status_page_settings (id, title, custom_domain, public_enabled, subscribe_enabled, updated_at) VALUES ('default', 'HosteraX Cloud Status', '', 1, 1, ?)",
    ).run(Date.now());
  }
  if (!db.prepare("SELECT 1 FROM security_policy WHERE id='default'").get()) {
    db.prepare(
      "INSERT INTO security_policy (id, org_id, block_critical, block_high, enforce_non_root, require_sbom, max_cvss, updated_at) VALUES ('default', 'default', 0, 0, 0, 0, 9.0, ?)",
    ).run(Date.now());
  }
}

const LEVEL_RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CRITICAL: 4 };

export function createEnterpriseApi({
  db,
  json,
  readBody,
  dockerApi,
  edgeManager,
  webhookManager,
  backupManager,
  projectsApi,
  sessionOf,
  callerScopes,
  clientIp,
  publishSystemLog,
}) {
  ensureEnterpriseSchema(db);

  function logAudit({
    orgId = "default",
    actorEmail = "system",
    actorRole = "system",
    action,
    resourceType = null,
    resourceId = null,
    details = null,
    ip = null,
  }) {
    try {
      const id = "aud_" + crypto.randomBytes(8).toString("hex");
      const now = Date.now();
      db.prepare(
        `INSERT INTO audit_logs (id, org_id, actor_email, actor_role, action, resource_type, resource_id, details_json, ip, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        orgId,
        actorEmail,
        actorRole,
        action,
        resourceType,
        resourceId,
        details ? JSON.stringify(details) : null,
        ip,
        now,
      );
      void forwardToSiemSinks({
        id,
        ts: now,
        level: /fail|delete|purge|error|block/i.test(action) ? "WARN" : "INFO",
        source: "audit",
        message: `${actorEmail} performed ${action}${resourceType ? ` on ${resourceType}` : ""}${resourceId ? `:${resourceId}` : ""}`,
        meta: details,
      });
    } catch {}
  }

  async function dispatchToSingleSink(sink, events) {
    const start = Date.now();
    const apiKey = sink.api_key_enc ? decryptSecret(sink.api_key_enc) : "";
    let statusCode = 0;
    let ok = false;
    let errorMessage = null;

    try {
      if (sink.provider === "syslog" || sink.endpoint.startsWith("udp://") || sink.endpoint.startsWith("tcp://")) {
        const cleaned = sink.endpoint.replace(/^(udp|tcp):\/\//i, "");
        const [host, portStr] = cleaned.split(":");
        const port = Number(portStr) || 514;
        if (!host) throw new Error("Syslog host required");
        const payload = events
          .map(
            (e) =>
              `<134>1 ${new Date(e.ts || Date.now()).toISOString()} hosterax ${e.source || "engine"} - - [meta@hosterax level="${e.level}"] ${e.message}`,
          )
          .join("\n");
        if (sink.endpoint.toLowerCase().startsWith("tcp://")) {
          await new Promise((resolve, reject) => {
            const sock = net.createConnection({ host, port, timeout: 4000 }, () => {
              sock.end(payload + "\n", resolve);
            });
            sock.on("error", reject);
            sock.on("timeout", () => {
              sock.destroy();
              reject(new Error("Syslog TCP timeout"));
            });
          });
        } else {
          await new Promise((resolve, reject) => {
            const sock = dgram.createSocket("udp4");
            const buf = Buffer.from(payload);
            sock.send(buf, port, host, (err) => {
              sock.close();
              if (err) reject(err);
              else resolve();
            });
          });
        }
        statusCode = 200;
        ok = true;
      } else {
        const u = new URL(sink.endpoint);
        if (!["http:", "https:"].includes(u.protocol)) {
          throw new Error("Only http://, https://, tcp://, or udp:// endpoints supported");
        }
        const headers = { "content-type": "application/json", "user-agent": "HosteraX-SIEM/1.0" };
        if (apiKey) {
          if (sink.provider === "datadog") headers["DD-API-KEY"] = apiKey;
          else if (sink.provider === "splunk") headers.Authorization = `Splunk ${apiKey}`;
          else headers.Authorization = `Bearer ${apiKey}`;
        }
        let body;
        if (sink.provider === "loki") {
          body = JSON.stringify({
            streams: [
              {
                stream: { service: "hosterax", job: "hosterax-engine" },
                values: events.map((e) => [
                  String(BigInt(e.ts || Date.now()) * 1_000_000n),
                  JSON.stringify(e),
                ]),
              },
            ],
          });
        } else if (sink.provider === "splunk") {
          body = events
            .map((e) => JSON.stringify({ time: (e.ts || Date.now()) / 1000, sourcetype: "hosterax", event: e }))
            .join("\n");
        } else {
          body = JSON.stringify(events.length === 1 ? events[0] : { events });
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const r = await fetch(sink.endpoint, {
            method: "POST",
            headers,
            body,
            signal: ctrl.signal,
          });
          statusCode = r.status;
          ok = r.ok;
          if (!r.ok) {
            const txt = await r.text().catch(() => "");
            errorMessage = `HTTP ${r.status}${txt ? `: ${txt.slice(0, 120)}` : ""}`;
          }
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (err) {
      errorMessage = String(err?.message || err);
      ok = false;
    }

    const latencyMs = Date.now() - start;
    try {
      db.prepare(
        `INSERT INTO siem_deliveries (id, sink_id, status_code, ok, events_count, error_message, latency_ms, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        "sdel_" + crypto.randomBytes(6).toString("hex"),
        sink.id,
        statusCode,
        ok ? 1 : 0,
        events.length,
        errorMessage,
        latencyMs,
        Date.now(),
      );
      db.prepare(
        `UPDATE siem_sinks SET
          last_flush_at=?,
          events_sent = events_sent + ?,
          events_failed = events_failed + ?,
          last_error = ?
         WHERE id=?`,
      ).run(
        Date.now(),
        ok ? events.length : 0,
        ok ? 0 : events.length,
        errorMessage,
        sink.id,
      );
    } catch {}

    return { ok, statusCode, latencyMs, errorMessage };
  }

  async function forwardToSiemSinks(event) {
    let sinks = [];
    try {
      sinks = db.prepare("SELECT * FROM siem_sinks WHERE enabled=1").all();
    } catch {
      return;
    }
    if (!sinks.length) return;
    const evRank = LEVEL_RANK[String(event.level || "INFO").toUpperCase()] ?? 1;
    for (const sink of sinks) {
      const minRank = LEVEL_RANK[String(sink.min_level || "INFO").toUpperCase()] ?? 1;
      if (evRank < minRank) continue;
      if (sink.filter_source && sink.filter_source !== "all" && sink.filter_source !== event.source) {
        continue;
      }
      dispatchToSingleSink(sink, [event]).catch(() => {});
    }
  }

  function actorContext(req) {
    const ses = sessionOf?.(req);
    const scopes = callerScopes?.(req) || [];
    return {
      email: ses?.user?.email || (scopes.includes("*") ? "local-admin@hosterax" : "api-token"),
      role: ses?.user?.role || (scopes.includes("*") ? "admin" : "operator"),
      ip: clientIp?.(req) || null,
    };
  }

  async function probeSingleComponent(comp) {
    const start = Date.now();
    let status = "operational";
    let statusCode = null;
    let errorMessage = null;
    let latencyMs = 0;

    try {
      const target = String(comp.target_url || "").trim();
      if (target.startsWith("http://") || target.startsWith("https://")) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const r = await fetch(target, { method: "GET", signal: ctrl.signal });
          statusCode = r.status;
          latencyMs = Date.now() - start;
          if (r.status >= 500) {
            status = "major_outage";
            errorMessage = `HTTP ${r.status}`;
          } else if (r.status >= 400) {
            status = "degraded";
            errorMessage = `HTTP ${r.status}`;
          }
        } finally {
          clearTimeout(timer);
        }
      } else if (target.startsWith("tcp://")) {
        const [host, portStr] = target.slice(6).split(":");
        const port = Number(portStr) || 80;
        await new Promise((resolve, reject) => {
          const sock = net.createConnection({ host, port, timeout: 4000 }, () => {
            sock.end();
            resolve();
          });
          sock.on("error", reject);
          sock.on("timeout", () => {
            sock.destroy();
            reject(new Error("TCP connect timeout"));
          });
        });
        latencyMs = Date.now() - start;
        statusCode = 200;
      } else if (comp.project_name) {
        const proj = db
          .prepare("SELECT * FROM projects WHERE name=? OR slug=?")
          .get(comp.project_name, comp.project_name);
        if (!proj) {
          status = "major_outage";
          errorMessage = "Linked project not found";
        } else if (!proj.port) {
          status = "degraded";
          errorMessage = "Project has no active port";
        } else {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3500);
          try {
            const pathPart = String(proj.health_path || "/").startsWith("/")
              ? proj.health_path || "/"
              : "/" + proj.health_path;
            const r = await fetch(`http://127.0.0.1:${proj.port}${pathPart}`, {
              signal: ctrl.signal,
            });
            statusCode = r.status;
            latencyMs = Date.now() - start;
            if (r.status >= 500) status = "major_outage";
            else if (r.status >= 400) status = "degraded";
          } finally {
            clearTimeout(timer);
          }
        }
      } else {
        throw new Error("No probe target_url or linked project configured");
      }
    } catch (err) {
      latencyMs = Date.now() - start;
      status = "major_outage";
      errorMessage = String(err?.message || err);
    }

    const now = Date.now();
    db.prepare(
      "INSERT INTO status_probes (id, component_id, status, status_code, latency_ms, error_message, checked_at) VALUES (?,?,?,?,?,?,?)",
    ).run("prb_" + crypto.randomBytes(6).toString("hex"), comp.id, status, statusCode, latencyMs, errorMessage, now);

    // Recompute trailing uptime percentage across recent 50 probes
    const recent = db
      .prepare("SELECT status FROM status_probes WHERE component_id=? ORDER BY checked_at DESC LIMIT 50")
      .all(comp.id);
    const upCount = recent.filter((r) => r.status === "operational").length;
    const uptimePct = recent.length
      ? Math.round((upCount / recent.length) * 10000) / 100
      : status === "operational"
        ? 100.0
        : 0.0;

    db.prepare(
      "UPDATE status_components SET status=?, latency_ms=?, uptime_pct=?, last_checked_at=? WHERE id=?",
    ).run(status, latencyMs, uptimePct, now, comp.id);

    return {
      componentId: comp.id,
      status,
      statusCode,
      latencyMs,
      uptimePct,
      errorMessage,
      checkedAt: now,
    };
  }

  function formatVaultGroup(g) {
    const secrets = db
      .prepare("SELECT id, key, value_enc, updated_at FROM vault_secrets WHERE group_id=? ORDER BY key")
      .all(g.id);
    let linkedProjects = [];
    try {
      linkedProjects = JSON.parse(g.linked_projects_json || "[]");
    } catch {}
    return {
      id: g.id,
      orgId: g.org_id,
      name: g.name,
      description: g.description || "",
      linkedProjects,
      syncMode: g.sync_mode,
      lastSyncedAt: g.last_synced_at,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      secrets: secrets.map((s) => ({
        id: s.id,
        key: s.key,
        value: "••••••••",
        configured: Boolean(s.value_enc),
        updatedAt: s.updated_at,
      })),
    };
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    const orgId = resolveOrgId(req, url);
    let m;

    // ────────── Public Status Page (Unauthenticated when public_enabled=1) ──────────
    if (p === "/api/public/status" && req.method === "GET") {
      const settings = db.prepare("SELECT * FROM status_page_settings WHERE id='default'").get();
      if (!settings || !settings.public_enabled) {
        return (json(res, 404, { error: "Public status page is disabled" }), true);
      }
      const components = db
        .prepare("SELECT * FROM status_components ORDER BY group_name, created_at")
        .all();
      const incidents = db
        .prepare("SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT 25")
        .all()
        .map((i) => ({
          ...i,
          componentIds: (() => {
            try {
              return JSON.parse(i.component_ids_json || "[]");
            } catch {
              return [];
            }
          })(),
        }));
      return (json(res, 200, { settings, components, incidents }), true);
    }

    // ────────── Audit Logs ──────────
    if (p === "/api/audit-logs" && req.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const action = String(url.searchParams.get("action") || "").trim();
      let rows = db
        .prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?")
        .all(limit);
      if (url.searchParams.get("orgId")) {
        rows = rows.filter((r) => r.org_id === orgId);
      }
      if (action && action !== "all") {
        rows = rows.filter((r) => r.action.startsWith(action));
      }
      if (q) {
        rows = rows.filter(
          (r) =>
            String(r.actor_email || "").toLowerCase().includes(q) ||
            String(r.action || "").toLowerCase().includes(q) ||
            String(r.resource_id || "").toLowerCase().includes(q),
        );
      }
      return (
        json(
          res,
          200,
          rows.map((r) => ({
            ...r,
            details: (() => {
              try {
                return r.details_json ? JSON.parse(r.details_json) : null;
              } catch {
                return null;
              }
            })(),
          })),
        ),
        true
      );
    }

    // ────────── Database Studio Live Query Proxy ──────────
    if (p === "/api/databases/query" && req.method === "POST") {
      const b = await readBody(req);
      const target = String(b.target || b.database || "engine-sqlite").trim();
      const sqlOrCmd = String(b.query || b.sql || "").trim();
      if (!sqlOrCmd) return (json(res, 400, { error: "query is required" }), true);
      const start = Date.now();
      const actor = actorContext(req);

      if (target === "engine-sqlite" || target === "hosterax.db") {
        let cleanSql;
        try {
          cleanSql = validateReadOnlySql(sqlOrCmd);
        } catch (err) {
          return (json(res, 400, { error: err.message }), true);
        }
        try {
          const stmt = db.prepare(cleanSql);
          const rawRows = stmt.all().slice(0, 200);
          const rows = rawRows.map(maskSensitiveRow);
          const columns = rows.length ? Object.keys(rows[0]) : [];
          logAudit({
            orgId,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: "database.query",
            resourceType: "engine-sqlite",
            resourceId: "hosterax.db",
            details: { rowCount: rows.length },
            ip: actor.ip,
          });
          return (
            json(res, 200, {
              ok: true,
              target: "engine-sqlite",
              columns,
              rows,
              rowCount: rows.length,
              durationMs: Date.now() - start,
            }),
            true
          );
        } catch (err) {
          return (json(res, 400, { error: err.message }), true);
        }
      }

      // Managed database container lookup
      const mdb = db
        .prepare("SELECT * FROM managed_dbs WHERE id=? OR name=?")
        .get(target, target);
      if (!mdb) {
        return (json(res, 404, { error: `Managed database "${target}" not found` }), true);
      }
      const containerName = `hx_db_${mdb.name}`;
      if (!isSafeContainerName(containerName)) {
        return (json(res, 400, { error: "Invalid container name" }), true);
      }

      try {
        const inspect = await dockerApi.inspectContainer(containerName);
        if (!inspect?.State?.Running) {
          return (
            json(res, 400, { error: `Container "${containerName}" is not running` }),
            true
          );
        }
      } catch (err) {
        return (
          json(res, 503, { error: `Docker container unreachable: ${err.message}` }),
          true
        );
      }

      try {
        const eng = String(mdb.engine || "").toLowerCase();
        let execRes;
        if (eng === "postgres") {
          execRes = await dockerApi.execCommand(containerName, [
            "sh",
            "-c",
            'psql -U "${POSTGRES_USER:-hx}" -d "${POSTGRES_DB:-' +
              mdb.name +
              '}" -F "\t" -A -c "$HX_SQL"',
          ], { env: [`HX_SQL=${sqlOrCmd}`] });
        } else if (eng === "mysql" || eng === "mariadb") {
          execRes = await dockerApi.execCommand(containerName, [
            "sh",
            "-c",
            'B=$(command -v mysql || command -v mariadb); P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; "$B" -uroot ${P:+-p"$P"} --batch -e "$HX_SQL"',
          ], { env: [`HX_SQL=${sqlOrCmd}`] });
        } else if (eng === "redis") {
          const parts = sqlOrCmd.split(/\s+/).filter(Boolean);
          execRes = await dockerApi.execCommand(containerName, ["redis-cli", ...parts]);
        } else if (eng === "mongodb" || eng === "mongo") {
          execRes = await dockerApi.execCommand(containerName, [
            "sh",
            "-c",
            'B=$(command -v mongosh || command -v mongo); "$B" --quiet --eval "$HX_SQL"',
          ], { env: [`HX_SQL=${sqlOrCmd}`] });
        } else {
          return (json(res, 400, { error: `Unsupported engine for query proxy: ${eng}` }), true);
        }

        const lines = String(execRes.output || "")
          .split(/\r?\n/)
          .filter((l) => l.length > 0);
        let columns = [];
        let rows = [];
        if ((eng === "postgres" || eng === "mysql" || eng === "mariadb") && lines.length > 0) {
          columns = lines[0].split("\t");
          rows = lines.slice(1, 201).map((line) => {
            const vals = line.split("\t");
            const obj = {};
            columns.forEach((col, i) => {
              obj[col] = vals[i] ?? null;
            });
            return maskSensitiveRow(obj);
          });
        } else {
          columns = ["output"];
          rows = lines.slice(0, 200).map((output) => ({ output }));
        }

        logAudit({
          orgId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "database.query",
          resourceType: mdb.engine,
          resourceId: mdb.name,
          details: { rowCount: rows.length },
          ip: actor.ip,
        });
        return (
          json(res, 200, {
            ok: execRes.exitCode === 0,
            target: mdb.name,
            engine: mdb.engine,
            columns,
            rows,
            rowCount: rows.length,
            exitCode: execRes.exitCode,
            rawOutput: execRes.output,
            durationMs: Date.now() - start,
          }),
          true
        );
      } catch (err) {
        return (json(res, 502, { error: err.message }), true);
      }
    }

    // ────────── Secrets Vault ──────────
    if (p === "/api/vault/groups" && req.method === "GET") {
      const groups = db
        .prepare("SELECT * FROM vault_groups ORDER BY updated_at DESC")
        .all()
        .map(formatVaultGroup);
      return (json(res, 200, groups), true);
    }

    if (p === "/api/vault/groups" && req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim();
      if (!name) return (json(res, 400, { error: "name is required" }), true);
      const id = "vg_" + crypto.randomBytes(6).toString("hex");
      const now = Date.now();
      const linked = Array.isArray(b.linkedProjects) ? b.linkedProjects : [];
      const syncMode = b.syncMode === "auto" ? "auto" : "manual";
      try {
        db.transaction(() => {
          db.prepare(
            `INSERT INTO vault_groups (id, org_id, name, description, linked_projects_json, sync_mode, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?)`,
          ).run(id, orgId, name, String(b.description || ""), JSON.stringify(linked), syncMode, now, now);

          if (Array.isArray(b.secrets)) {
            for (const s of b.secrets) {
              if (!s?.key) continue;
              db.prepare(
                "INSERT INTO vault_secrets (id, group_id, key, value_enc, updated_at) VALUES (?,?,?,?,?)",
              ).run(
                "vs_" + crypto.randomBytes(6).toString("hex"),
                id,
                String(s.key).trim(),
                encryptSecret(String(s.value ?? "")),
                now,
              );
            }
          }
        })();
        const actor = actorContext(req);
        logAudit({
          orgId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "vault.group_created",
          resourceType: "vault_group",
          resourceId: name,
          ip: actor.ip,
        });
        const created = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(id);
        return (json(res, 201, formatVaultGroup(created)), true);
      } catch (err) {
        return (json(res, 400, { error: err.message }), true);
      }
    }

    if ((m = p.match(/^\/api\/vault\/groups\/([^/]+)\/reveal$/)) && req.method === "GET") {
      const g = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(m[1]);
      if (!g) return (json(res, 404, { error: "Vault group not found" }), true);
      const keyFilter = url.searchParams.get("key");
      const rows = keyFilter
        ? db.prepare("SELECT id, key, value_enc, updated_at FROM vault_secrets WHERE group_id=? AND key=?").all(g.id, keyFilter)
        : db.prepare("SELECT id, key, value_enc, updated_at FROM vault_secrets WHERE group_id=?").all(g.id);
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "vault.secret_revealed",
        resourceType: "vault_group",
        resourceId: g.name,
        details: { key: keyFilter || "all" },
        ip: actor.ip,
      });
      return (
        json(
          res,
          200,
          rows.map((r) => ({
            id: r.id,
            key: r.key,
            value: decryptSecret(r.value_enc),
            updatedAt: r.updated_at,
          })),
        ),
        true
      );
    }

    if ((m = p.match(/^\/api\/vault\/groups\/([^/]+)\/sync$/)) && req.method === "POST") {
      const g = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(m[1]);
      if (!g) return (json(res, 404, { error: "Vault group not found" }), true);
      const b = await readBody(req).catch(() => ({}));
      let targets = [];
      try {
        targets = Array.isArray(b.projects) ? b.projects : JSON.parse(g.linked_projects_json || "[]");
      } catch {}
      const secrets = db.prepare("SELECT key, value_enc FROM vault_secrets WHERE group_id=?").all(g.id);
      const pairs = Object.fromEntries(secrets.map((s) => [s.key, decryptSecret(s.value_enc)]));

      const synced = [];
      const failed = [];
      for (const projName of targets) {
        const proj = db.prepare("SELECT name FROM projects WHERE name=? OR slug=?").get(projName, projName);
        if (!proj) {
          failed.push({ project: projName, error: "Project not found" });
          continue;
        }
        try {
          projectsApi.putEnv(proj.name, pairs, { environment: b.environment || "production", secret: true });
          synced.push(proj.name);
        } catch (err) {
          failed.push({ project: projName, error: err.message });
        }
      }
      db.prepare("UPDATE vault_groups SET last_synced_at=?, updated_at=? WHERE id=?").run(
        Date.now(),
        Date.now(),
        g.id,
      );
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "vault.synced",
        resourceType: "vault_group",
        resourceId: g.name,
        details: { synced, failed, keys: Object.keys(pairs).length },
        ip: actor.ip,
      });
      return (json(res, 200, { ok: true, synced, failed, group: formatVaultGroup(db.prepare("SELECT * FROM vault_groups WHERE id=?").get(g.id)) }), true);
    }

    if ((m = p.match(/^\/api\/vault\/groups\/([^/]+)$/)) && req.method === "PATCH") {
      const g = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(m[1]);
      if (!g) return (json(res, 404, { error: "Vault group not found" }), true);
      const b = await readBody(req);
      const now = Date.now();
      db.transaction(() => {
        db.prepare(
          `UPDATE vault_groups SET
             name = COALESCE(?, name),
             description = COALESCE(?, description),
             linked_projects_json = COALESCE(?, linked_projects_json),
             sync_mode = COALESCE(?, sync_mode),
             updated_at = ?
           WHERE id=?`,
        ).run(
          b.name ?? null,
          b.description ?? null,
          Array.isArray(b.linkedProjects) ? JSON.stringify(b.linkedProjects) : null,
          b.syncMode ?? null,
          now,
          g.id,
        );
        if (Array.isArray(b.upserts)) {
          for (const s of b.upserts) {
            if (!s?.key || s.value === "••••••••") continue;
            db.prepare(
              `INSERT INTO vault_secrets (id, group_id, key, value_enc, updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(group_id, key) DO UPDATE SET value_enc=excluded.value_enc, updated_at=excluded.updated_at`,
            ).run(
              "vs_" + crypto.randomBytes(6).toString("hex"),
              g.id,
              String(s.key).trim(),
              encryptSecret(String(s.value ?? "")),
              now,
            );
          }
        }
        if (Array.isArray(b.deletes)) {
          for (const k of b.deletes) {
            db.prepare("DELETE FROM vault_secrets WHERE group_id=? AND key=?").run(g.id, k);
          }
        }
      })();
      const updated = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(g.id);
      return (json(res, 200, formatVaultGroup(updated)), true);
    }

    if ((m = p.match(/^\/api\/vault\/groups\/([^/]+)$/)) && req.method === "DELETE") {
      const g = db.prepare("SELECT * FROM vault_groups WHERE id=?").get(m[1]);
      if (!g) return (json(res, 404, { error: "Vault group not found" }), true);
      db.prepare("DELETE FROM vault_groups WHERE id=?").run(g.id);
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "vault.group_deleted",
        resourceType: "vault_group",
        resourceId: g.name,
        ip: actor.ip,
      });
      return (json(res, 200, { ok: true }), true);
    }

    // ────────── Fleet Security Scanner & Policy ──────────
    if (p === "/api/security/scans" && req.method === "GET") {
      const scans = db
        .prepare("SELECT * FROM security_scans ORDER BY scanned_at DESC LIMIT 50")
        .all()
        .map((s) => ({
          ...s,
          findings: (() => {
            try {
              return JSON.parse(s.findings_json || "[]");
            } catch {
              return [];
            }
          })(),
        }));
      return (json(res, 200, scans), true);
    }

    if (p === "/api/security/policy" && req.method === "GET") {
      const pol = db.prepare("SELECT * FROM security_policy WHERE id='default'").get();
      return (
        json(res, 200, {
          blockCritical: Boolean(pol.block_critical),
          blockHigh: Boolean(pol.block_high),
          enforceNonRoot: Boolean(pol.enforce_non_root),
          requireSbom: Boolean(pol.require_sbom),
          maxCvss: pol.max_cvss ?? 9.0,
          updatedAt: pol.updated_at,
        }),
        true
      );
    }

    if (p === "/api/security/policy" && req.method === "PUT") {
      const b = await readBody(req);
      const now = Date.now();
      db.prepare(
        `UPDATE security_policy SET
          block_critical=?, block_high=?, enforce_non_root=?, require_sbom=?, max_cvss=?, updated_at=?
         WHERE id='default'`,
      ).run(
        b.blockCritical ? 1 : 0,
        b.blockHigh ? 1 : 0,
        b.enforceNonRoot ? 1 : 0,
        b.requireSbom ? 1 : 0,
        Number.isFinite(Number(b.maxCvss)) ? Number(b.maxCvss) : 9.0,
        now,
      );
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "security.policy_updated",
        resourceType: "security_policy",
        resourceId: "default",
        details: b,
        ip: actor.ip,
      });
      return (json(res, 200, { ok: true, updatedAt: now }), true);
    }

    if (p === "/api/security/scan" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      const targetName = String(b.target || "").trim();
      let trivyInstalled = false;
      try {
        await execFileAsync("trivy", ["--version"], { timeout: 2500 });
        trivyInstalled = true;
      } catch {}

      let containers = [];
      let dockerAvailable = true;
      try {
        containers = await dockerApi.listContainers({ all: true });
      } catch {
        dockerAvailable = false;
      }

      const targets = targetName
        ? containers.filter((c) => {
            const name = String(c.Names?.[0] || "").replace(/^\//, "");
            return name === targetName || c.Id.startsWith(targetName) || c.Image === targetName;
          })
        : containers.slice(0, 20);

      const results = [];
      for (const c of targets) {
        const cName = String(c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, "");
        try {
          const inspectData = await dockerApi.inspectContainer(cName);
          const posture = evaluateContainerPosture(inspectData);
          let findings = [...posture.findings];
          const counts = { ...posture.counts };
          let scannerBackend = "docker-inspect";

          if (trivyInstalled && isSafeImageRef(posture.image)) {
            try {
              const { stdout } = await execFileAsync(
                "trivy",
                ["image", "--quiet", "--format", "json", "--scanners", "vuln", posture.image],
                { timeout: 45000, maxBuffer: 16 * 1024 * 1024 },
              );
              const report = JSON.parse(stdout || "{}");
              scannerBackend = "trivy+docker-inspect";
              for (const resBlock of report.Results || []) {
                for (const v of (resBlock.Vulnerabilities || []).slice(0, 50)) {
                  const sev = String(v.Severity || "LOW").toLowerCase();
                  if (counts[sev] !== undefined) counts[sev] += 1;
                  findings.push({
                    severity: sev,
                    code: v.VulnerabilityID,
                    title: `${v.PkgName} ${v.InstalledVersion}: ${v.Title || v.VulnerabilityID}`,
                    remediation: v.FixedVersion ? `Upgrade to ${v.FixedVersion}` : "No fix released yet",
                  });
                }
              }
            } catch {}
          }

          const scanId = "scn_" + crypto.randomBytes(6).toString("hex");
          const now = Date.now();
          const summary = trivyInstalled
            ? `Scanned container posture & image packages via Trivy (${posture.image})`
            : `Inspected container runtime posture (${posture.image}); install 'trivy' on engine host for OS/package CVE scanning`;

          db.prepare(
            `INSERT INTO security_scans (id, org_id, target, target_type, scanner_backend, critical, high, medium, low, status, summary, findings_json, scanned_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            scanId,
            orgId,
            cName,
            "container",
            scannerBackend,
            counts.critical,
            counts.high,
            counts.medium,
            counts.low,
            counts.critical > 0 ? "action_required" : "completed",
            summary,
            JSON.stringify(findings.slice(0, 60)),
            now,
          );
          results.push({ id: scanId, target: cName, image: posture.image, scannerBackend, counts, findings, summary, scannedAt: now });
        } catch {}
      }

      if (!dockerAvailable && results.length === 0) {
        return (
          json(res, 503, {
            ok: false,
            dockerAvailable: false,
            trivyInstalled,
            error: "Docker daemon is unavailable — cannot inspect live containers",
          }),
          true
        );
      }

      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "security.fleet_scanned",
        resourceType: "security_scan",
        resourceId: targetName || "fleet",
        details: { scannedCount: results.length, trivyInstalled },
        ip: actor.ip,
      });

      return (json(res, 200, { ok: true, dockerAvailable, trivyInstalled, scannedCount: results.length, results }), true);
    }

    // ────────── SIEM Sinks & Deliveries ──────────
    if (p === "/api/siem/sinks" && req.method === "GET") {
      const sinks = db.prepare("SELECT * FROM siem_sinks ORDER BY created_at DESC").all();
      return (
        json(
          res,
          200,
          sinks.map(({ api_key_enc, ...s }) => ({
            ...s,
            enabled: Boolean(s.enabled),
            hasApiKey: Boolean(api_key_enc),
          })),
        ),
        true
      );
    }

    if (p === "/api/siem/sinks" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name || !b.provider || !b.endpoint) {
        return (json(res, 400, { error: "name, provider, and endpoint are required" }), true);
      }
      const id = "siem_" + crypto.randomBytes(6).toString("hex");
      const now = Date.now();
      db.prepare(
        `INSERT INTO siem_sinks (id, org_id, name, provider, endpoint, api_key_enc, min_level, filter_source, enabled, batch_size, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        orgId,
        String(b.name).trim(),
        String(b.provider).trim(),
        String(b.endpoint).trim(),
        b.apiKey ? encryptSecret(String(b.apiKey)) : "",
        String(b.minLevel || "INFO").toUpperCase(),
        String(b.filterSource || "all"),
        b.enabled === false ? 0 : 1,
        Math.min(Math.max(Number(b.batchSize) || 50, 1), 500),
        now,
        now,
      );
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "siem.sink_created",
        resourceType: "siem_sink",
        resourceId: String(b.name),
        ip: actor.ip,
      });
      const row = db.prepare("SELECT * FROM siem_sinks WHERE id=?").get(id);
      const { api_key_enc, ...safe } = row;
      return (json(res, 201, { ...safe, enabled: Boolean(safe.enabled), hasApiKey: Boolean(api_key_enc) }), true);
    }

    if ((m = p.match(/^\/api\/siem\/sinks\/([^/]+)\/test$/)) && req.method === "POST") {
      const sink = db.prepare("SELECT * FROM siem_sinks WHERE id=?").get(m[1]);
      if (!sink) return (json(res, 404, { error: "SIEM sink not found" }), true);
      const sample = {
        id: "test_" + crypto.randomBytes(4).toString("hex"),
        ts: Date.now(),
        level: "INFO",
        source: "siem-test",
        message: `HosteraX connectivity verification event for sink "${sink.name}"`,
      };
      const result = await dispatchToSingleSink(sink, [sample]);
      return (json(res, result.ok ? 200 : 502, result), true);
    }

    if ((m = p.match(/^\/api\/siem\/sinks\/([^/]+)$/)) && req.method === "PATCH") {
      const sink = db.prepare("SELECT * FROM siem_sinks WHERE id=?").get(m[1]);
      if (!sink) return (json(res, 404, { error: "SIEM sink not found" }), true);
      const b = await readBody(req);
      db.prepare(
        `UPDATE siem_sinks SET
          name=COALESCE(?,name),
          endpoint=COALESCE(?,endpoint),
          min_level=COALESCE(?,min_level),
          filter_source=COALESCE(?,filter_source),
          enabled=COALESCE(?,enabled),
          updated_at=?
         WHERE id=?`,
      ).run(
        b.name ?? null,
        b.endpoint ?? null,
        b.minLevel ? String(b.minLevel).toUpperCase() : null,
        b.filterSource ?? null,
        b.enabled === undefined ? null : b.enabled ? 1 : 0,
        Date.now(),
        sink.id,
      );
      if (b.apiKey && !String(b.apiKey).includes("•••")) {
        db.prepare("UPDATE siem_sinks SET api_key_enc=? WHERE id=?").run(encryptSecret(String(b.apiKey)), sink.id);
      }
      const row = db.prepare("SELECT * FROM siem_sinks WHERE id=?").get(sink.id);
      const { api_key_enc, ...safe } = row;
      return (json(res, 200, { ...safe, enabled: Boolean(safe.enabled), hasApiKey: Boolean(api_key_enc) }), true);
    }

    if ((m = p.match(/^\/api\/siem\/sinks\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM siem_sinks WHERE id=?").run(m[1]);
      return (json(res, 200, { ok: true }), true);
    }

    if (p === "/api/siem/deliveries" && req.method === "GET") {
      const rows = db
        .prepare("SELECT * FROM siem_deliveries ORDER BY created_at DESC LIMIT 100")
        .all()
        .map((r) => ({ ...r, ok: Boolean(r.ok) }));
      return (json(res, 200, rows), true);
    }

    // ────────── Edge Middlewares ──────────
    if (p === "/api/edge/middlewares" && req.method === "GET") {
      const rows = db
        .prepare("SELECT * FROM edge_middlewares ORDER BY priority ASC, created_at DESC")
        .all()
        .map((r) => ({
          ...r,
          enabled: Boolean(r.enabled),
          config: (() => {
            try {
              return JSON.parse(r.config_json || "{}");
            } catch {
              return {};
            }
          })(),
        }));
      return (json(res, 200, rows), true);
    }

    if (p === "/api/edge/middlewares" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name || !b.kind) return (json(res, 400, { error: "name and kind are required" }), true);
      const id = "emw_" + crypto.randomBytes(6).toString("hex");
      const now = Date.now();
      const scopeType = String(b.scopeType || "global");
      const scopeTarget = String(b.scopeTarget || "*").trim();
      if (scopeTarget !== "*" && scopeType === "domain") {
        const parts = scopeTarget.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0 || !parts.every((h) => isSafeHostname(h))) {
          return (json(res, 400, { error: "Invalid domain scope target" }), true);
        }
      }
      db.prepare(
        `INSERT INTO edge_middlewares (id, org_id, name, kind, scope_type, scope_target, config_json, enabled, priority, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        orgId,
        String(b.name).trim(),
        String(b.kind).trim(),
        scopeType,
        scopeTarget,
        JSON.stringify(b.config || {}),
        b.enabled === false ? 0 : 1,
        Number(b.priority) || 100,
        now,
        now,
      );
      edgeManager?.syncRoutes?.().catch(() => {});
      const row = db.prepare("SELECT * FROM edge_middlewares WHERE id=?").get(id);
      return (json(res, 201, { ...row, enabled: Boolean(row.enabled), config: b.config || {} }), true);
    }

    if ((m = p.match(/^\/api\/edge\/middlewares\/([^/]+)$/)) && req.method === "PATCH") {
      const mw = db.prepare("SELECT * FROM edge_middlewares WHERE id=?").get(m[1]);
      if (!mw) return (json(res, 404, { error: "Middleware not found" }), true);
      const b = await readBody(req);
      const nextScopeType = b.scopeType !== undefined ? String(b.scopeType) : mw.scope_type;
      const nextScopeTarget = b.scopeTarget !== undefined ? String(b.scopeTarget).trim() : mw.scope_target;
      if (nextScopeTarget !== "*" && nextScopeType === "domain") {
        const parts = nextScopeTarget.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0 || !parts.every((h) => isSafeHostname(h))) {
          return (json(res, 400, { error: "Invalid domain scope target" }), true);
        }
      }
      db.prepare(
        `UPDATE edge_middlewares SET
          name=COALESCE(?,name),
          kind=COALESCE(?,kind),
          scope_type=COALESCE(?,scope_type),
          scope_target=COALESCE(?,scope_target),
          config_json=COALESCE(?,config_json),
          enabled=COALESCE(?,enabled),
          priority=COALESCE(?,priority),
          updated_at=?
         WHERE id=?`,
      ).run(
        b.name ?? null,
        b.kind ?? null,
        b.scopeType ?? null,
        b.scopeTarget ?? null,
        b.config ? JSON.stringify(b.config) : null,
        b.enabled === undefined ? null : b.enabled ? 1 : 0,
        b.priority ?? null,
        Date.now(),
        mw.id,
      );
      edgeManager?.syncRoutes?.().catch(() => {});
      const updated = db.prepare("SELECT * FROM edge_middlewares WHERE id=?").get(mw.id);
      return (
        json(res, 200, {
          ...updated,
          enabled: Boolean(updated.enabled),
          config: JSON.parse(updated.config_json || "{}"),
        }),
        true
      );
    }

    if ((m = p.match(/^\/api\/edge\/middlewares\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM edge_middlewares WHERE id=?").run(m[1]);
      edgeManager?.syncRoutes?.().catch(() => {});
      return (json(res, 200, { ok: true }), true);
    }

    // ────────── Status Page & Synthetic Probes ──────────
    if (p === "/api/status-page" && req.method === "GET") {
      const settings = db.prepare("SELECT * FROM status_page_settings WHERE id='default'").get();
      const components = db
        .prepare("SELECT * FROM status_components ORDER BY group_name, created_at")
        .all();
      const incidents = db
        .prepare("SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT 50")
        .all()
        .map((i) => ({
          ...i,
          componentIds: (() => {
            try {
              return JSON.parse(i.component_ids_json || "[]");
            } catch {
              return [];
            }
          })(),
        }));
      return (json(res, 200, { settings, components, incidents }), true);
    }

    if (p === "/api/status-page" && req.method === "PUT") {
      const b = await readBody(req);
      db.prepare(
        `UPDATE status_page_settings SET
          title=COALESCE(?,title),
          custom_domain=COALESCE(?,custom_domain),
          public_enabled=COALESCE(?,public_enabled),
          subscribe_enabled=COALESCE(?,subscribe_enabled),
          updated_at=?
         WHERE id='default'`,
      ).run(
        b.title ?? null,
        b.customDomain ?? null,
        b.publicEnabled === undefined ? null : b.publicEnabled ? 1 : 0,
        b.subscribeEnabled === undefined ? null : b.subscribeEnabled ? 1 : 0,
        Date.now(),
      );
      return (json(res, 200, db.prepare("SELECT * FROM status_page_settings WHERE id='default'").get()), true);
    }

    if (p === "/api/status-page/components" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return (json(res, 400, { error: "name is required" }), true);
      const id = "scmp_" + crypto.randomBytes(6).toString("hex");
      const now = Date.now();
      db.prepare(
        `INSERT INTO status_components (id, name, description, group_name, target_url, project_name, status, latency_ms, uptime_pct, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        String(b.name).trim(),
        String(b.description || ""),
        String(b.groupName || "Core Infrastructure"),
        String(b.targetUrl || "").trim(),
        String(b.projectName || "").trim(),
        "operational",
        0,
        100.0,
        now,
      );
      const row = db.prepare("SELECT * FROM status_components WHERE id=?").get(id);
      if (row.target_url || row.project_name) {
        await probeSingleComponent(row).catch(() => {});
      }
      return (json(res, 201, db.prepare("SELECT * FROM status_components WHERE id=?").get(id)), true);
    }

    if ((m = p.match(/^\/api\/status-page\/components\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      db.prepare(
        `UPDATE status_components SET
          name=COALESCE(?,name), description=COALESCE(?,description), group_name=COALESCE(?,group_name),
          target_url=COALESCE(?,target_url), project_name=COALESCE(?,project_name), status=COALESCE(?,status)
         WHERE id=?`,
      ).run(
        b.name ?? null,
        b.description ?? null,
        b.groupName ?? null,
        b.targetUrl ?? null,
        b.projectName ?? null,
        b.status ?? null,
        m[1],
      );
      return (json(res, 200, db.prepare("SELECT * FROM status_components WHERE id=?").get(m[1])), true);
    }

    if ((m = p.match(/^\/api\/status-page\/components\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM status_components WHERE id=?").run(m[1]);
      return (json(res, 200, { ok: true }), true);
    }

    if ((m = p.match(/^\/api\/status-page\/probe\/([^/]+)$/)) && req.method === "POST") {
      const comp = db.prepare("SELECT * FROM status_components WHERE id=?").get(m[1]);
      if (!comp) return (json(res, 404, { error: "Status component not found" }), true);
      const result = await probeSingleComponent(comp);
      return (json(res, 200, result), true);
    }

    if (p === "/api/status-page/probe-all" && req.method === "POST") {
      const comps = db.prepare("SELECT * FROM status_components").all();
      const results = [];
      for (const c of comps) {
        if (c.target_url || c.project_name) {
          results.push(await probeSingleComponent(c));
        }
      }
      return (json(res, 200, { ok: true, probedCount: results.length, results }), true);
    }

    if (p === "/api/status-page/incidents" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.title) return (json(res, 400, { error: "title is required" }), true);
      const id = "sinc_" + crypto.randomBytes(6).toString("hex");
      const now = Date.now();
      db.prepare(
        `INSERT INTO status_incidents (id, title, status, impact, message, component_ids_json, created_at, updated_at, resolved_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        String(b.title).trim(),
        String(b.status || "investigating"),
        String(b.impact || "minor"),
        String(b.message || ""),
        JSON.stringify(Array.isArray(b.componentIds) ? b.componentIds : []),
        now,
        now,
        b.status === "resolved" ? now : null,
      );
      return (json(res, 201, db.prepare("SELECT * FROM status_incidents WHERE id=?").get(id)), true);
    }

    if ((m = p.match(/^\/api\/status-page\/incidents\/([^/]+)$/)) && req.method === "PATCH") {
      const b = await readBody(req);
      const now = Date.now();
      db.prepare(
        `UPDATE status_incidents SET
          status=COALESCE(?,status), impact=COALESCE(?,impact), message=COALESCE(?,message),
          updated_at=?, resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END
         WHERE id=?`,
      ).run(b.status ?? null, b.impact ?? null, b.message ?? null, now, b.status ?? "", now, m[1]);
      return (json(res, 200, db.prepare("SELECT * FROM status_incidents WHERE id=?").get(m[1])), true);
    }

    if ((m = p.match(/^\/api\/status-page\/incidents\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM status_incidents WHERE id=?").run(m[1]);
      return (json(res, 200, { ok: true }), true);
    }

    // ────────── OAuth & MCP Client Registry + PKCE ──────────
    if (p === "/api/oauth/clients" && req.method === "GET") {
      const rows = db.prepare("SELECT * FROM oauth_clients ORDER BY created_at DESC").all();
      return (
        json(
          res,
          200,
          rows.map(({ client_secret_hash, ...c }) => ({
            ...c,
            mcpEnabled: Boolean(c.mcp_enabled),
            hasSecret: Boolean(client_secret_hash),
            redirectUris: JSON.parse(c.redirect_uris_json || "[]"),
            scopes: JSON.parse(c.scopes_json || '["read"]'),
          })),
        ),
        true
      );
    }

    if (p === "/api/oauth/clients" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return (json(res, 400, { error: "name is required" }), true);
      const id = "oac_" + crypto.randomBytes(6).toString("hex");
      const clientId = "hx_app_" + crypto.randomBytes(10).toString("hex");
      const clientType = b.clientType === "public" ? "public" : "confidential";
      const plainSecret =
        clientType === "confidential" ? "hx_sec_" + crypto.randomBytes(20).toString("hex") : "";
      const redirectUris = Array.isArray(b.redirectUris) ? b.redirectUris : [];
      const scopes = Array.isArray(b.scopes) && b.scopes.length ? b.scopes : ["read"];
      const now = Date.now();
      db.prepare(
        `INSERT INTO oauth_clients (id, org_id, name, client_id, client_secret_hash, redirect_uris_json, scopes_json, client_type, mcp_enabled, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        orgId,
        String(b.name).trim(),
        clientId,
        plainSecret ? hashToken(plainSecret) : "",
        JSON.stringify(redirectUris),
        JSON.stringify(scopes),
        clientType,
        b.mcpEnabled === false ? 0 : 1,
        now,
      );
      const actor = actorContext(req);
      logAudit({
        orgId,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "oauth.client_created",
        resourceType: "oauth_client",
        resourceId: clientId,
        ip: actor.ip,
      });
      return (
        json(res, 201, {
          id,
          name: b.name,
          clientId,
          clientSecret: plainSecret || null,
          clientType,
          redirectUris,
          scopes,
          mcpEnabled: b.mcpEnabled !== false,
          createdAt: now,
        }),
        true
      );
    }

    if ((m = p.match(/^\/api\/oauth\/clients\/([^/]+)$/)) && req.method === "DELETE") {
      db.prepare("DELETE FROM oauth_clients WHERE id=? OR client_id=?").run(m[1], m[1]);
      return (json(res, 200, { ok: true }), true);
    }

    if (p === "/api/oauth/authorize" && req.method === "POST") {
      const b = await readBody(req);
      const client = db.prepare("SELECT * FROM oauth_clients WHERE client_id=?").get(b.clientId || "");
      if (!client) return (json(res, 404, { error: "Unknown client_id" }), true);
      const redirects = JSON.parse(client.redirect_uris_json || "[]");
      if (redirects.length && b.redirectUri && !redirects.includes(b.redirectUri)) {
        return (json(res, 400, { error: "redirect_uri mismatch" }), true);
      }
      const code = "hx_code_" + crypto.randomBytes(16).toString("hex");
      const actor = actorContext(req);
      db.prepare(
        `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, scopes_json, code_challenge, code_challenge_method, user_email, expires_at, used)
         VALUES (?,?,?,?,?,?,?,?,0)`,
      ).run(
        hashToken(code),
        client.client_id,
        b.redirectUri || redirects[0] || "urn:ietf:wg:oauth:2.0:oob",
        JSON.stringify(Array.isArray(b.scopes) ? b.scopes : JSON.parse(client.scopes_json || '["read"]')),
        b.codeChallenge || null,
        b.codeChallengeMethod || "S256",
        actor.email,
        Date.now() + 5 * 60 * 1000,
      );
      return (json(res, 200, { ok: true, code, expiresIn: 300 }), true);
    }

    if (p === "/api/oauth/token" && req.method === "POST") {
      const b = await readBody(req);
      const row = db.prepare("SELECT * FROM oauth_codes WHERE code_hash=?").get(hashToken(b.code || ""));
      if (!row || row.used || row.expires_at < Date.now()) {
        return (json(res, 400, { error: "Invalid or expired authorization code" }), true);
      }
      const client = db.prepare("SELECT * FROM oauth_clients WHERE client_id=?").get(row.client_id);
      if (!client) return (json(res, 400, { error: "Client missing" }), true);
      if (row.code_challenge) {
        const expected =
          row.code_challenge_method === "plain"
            ? String(b.codeVerifier || "")
            : crypto
                .createHash("sha256")
                .update(String(b.codeVerifier || ""))
                .digest("base64url");
        if (expected !== row.code_challenge) {
          return (json(res, 401, { error: "PKCE code_verifier verification failed" }), true);
        }
      } else if (client.client_secret_hash) {
        if (hashToken(b.clientSecret || "") !== client.client_secret_hash) {
          return (json(res, 401, { error: "Invalid client_secret" }), true);
        }
      }
      db.prepare("UPDATE oauth_codes SET used=1 WHERE code_hash=?").run(row.code_hash);
      const accessToken = "hx_oauth_" + crypto.randomBytes(24).toString("hex");
      const ttlMs = 3600 * 1000;
      db.prepare(
        "INSERT INTO oauth_tokens (token_hash, client_id, scopes_json, user_email, expires_at, revoked, created_at) VALUES (?,?,?,?,?,0,?)",
      ).run(hashToken(accessToken), client.client_id, row.scopes_json, row.user_email, Date.now() + ttlMs, Date.now());
      return (
        json(res, 200, {
          token_type: "Bearer",
          access_token: accessToken,
          expires_in: 3600,
          scope: JSON.parse(row.scopes_json || '["read"]').join(" "),
        }),
        true
      );
    }

    // ────────── Webhook Deliveries History & Replay ──────────
    if (p === "/api/webhooks/deliveries" && req.method === "GET") {
      const project = url.searchParams.get("project");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
      const rows = project
        ? db
            .prepare("SELECT * FROM webhook_deliveries WHERE project_name=? ORDER BY received_at DESC LIMIT ?")
            .all(project, limit)
        : db.prepare("SELECT * FROM webhook_deliveries ORDER BY received_at DESC LIMIT ?").all(limit);
      return (json(res, 200, rows.map((r) => ({ ...r, ok: Boolean(r.ok) }))), true);
    }

    if ((m = p.match(/^\/api\/webhooks\/deliveries\/([^/]+)\/replay$/)) && req.method === "POST") {
      const deliv = db.prepare("SELECT * FROM webhook_deliveries WHERE id=?").get(m[1]);
      if (!deliv) return (json(res, 404, { error: "Delivery not found" }), true);
      let payload = {};
      try {
        payload = deliv.payload_json ? JSON.parse(deliv.payload_json) : {};
      } catch {}
      const result = await webhookManager.handleGitHubWebhook({
        event: deliv.event,
        payload,
        rawBodyText: deliv.payload_json || "{}",
        signatureHeader: "",
        projectName: deliv.project_name || null,
        requireSignature: false,
      });
      return (json(res, 200, { ok: true, replayed: deliv.id, result }), true);
    }

    // ────────── DR Drill Certificates Persistence ──────────
    if (p === "/api/backups/drills" && req.method === "GET") {
      return (json(res, 200, backupManager.listDrills ? backupManager.listDrills() : []), true);
    }

    return false;
  }

  return { handle, logAudit, forwardToSiemSinks };
}
