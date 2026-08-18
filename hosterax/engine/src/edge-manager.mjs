// hosterax/engine/src/edge-manager.mjs
// Pluggable Managed Edge Gateway Subsystem for HosteraX
// Supports Caddy 2 (native Automatic HTTPS) & OpenResty 1.27 (Nginx + Lua engine)
//
// OpenResty  = routing + TLS termination (it only *reads* certificate files)
// Certbot    = certificate issuance/renewal (HTTP-01 standalone on loopback :49180,
//              proxied through the edge so port 80 never goes down)
// Lua layer  = analytics, request logging, rule guard, geo — all on ngx.shared.dict
//              (no Redis, no file I/O on the hot path), exposed on 127.0.0.1:9145.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { ACME_HTTP01_PORT, LETSENCRYPT_DIR } from "./tls-manager.mjs";

export const EDGE_MGMT_PORT = Number(process.env.EDGE_MGMT_PORT || 9145);

const OPENRESTY_KNOWN_CONFS = [
  "/usr/local/openresty/nginx/conf/nginx.conf",
  "/etc/openresty/nginx.conf",
  "/etc/nginx/nginx.conf",
];

export class EdgeManager {
  constructor(dbOrOpts, homeDir, tlsManager) {
    if (dbOrOpts && typeof dbOrOpts === "object" && dbOrOpts.db) {
      this.db = dbOrOpts.db;
      this.homeDir = dbOrOpts.homeDir || dbOrOpts.HOME;
      this.tlsManager = dbOrOpts.tlsManager;
      this.edgeDir = dbOrOpts.edgeDir || (this.homeDir ? path.join(this.homeDir, "edge") : "");
    } else {
      this.db = dbOrOpts;
      this.homeDir = homeDir;
      this.tlsManager = tlsManager;
      this.edgeDir = homeDir ? path.join(homeDir, "edge") : "";
    }
    this.caddyDataDir = path.join(this.edgeDir, "caddy-data");
    this.caddyConfigDir = path.join(this.edgeDir, "caddy-config");
    this.openrestySitesDir = path.join(this.edgeDir, "sites-enabled");
    this.acmeWebrootDir = path.join(this.edgeDir, "acme-webroot");
    this.luaDir = path.join(this.edgeDir, "lualib", "hosterax");
    this.acmeHttp01Port = ACME_HTTP01_PORT;
    this.mgmtPort = EDGE_MGMT_PORT;
    this.letsencryptDir = LETSENCRYPT_DIR;

    if (this.edgeDir) {
      fs.mkdirSync(this.edgeDir, { recursive: true });
    }
    fs.mkdirSync(this.caddyDataDir, { recursive: true });
    fs.mkdirSync(this.caddyConfigDir, { recursive: true });
    fs.mkdirSync(this.openrestySitesDir, { recursive: true });
    fs.mkdirSync(this.acmeWebrootDir, { recursive: true });
    fs.mkdirSync(this.luaDir, { recursive: true });

    this.ensureSchema();
    this.settings = this.getSettings();
    this.writeLuaModules();
  }

  /**
   * Ask the installed OpenResty binary where its own paths are (`openresty -V`),
   * falling back to the well-known locations. Makes the provider work for both
   * containerized and bare-metal OpenResty.
   */
  async detectOpenRestyPaths() {
    if (this._orPaths) return this._orPaths;
    const out = await new Promise((resolve) => {
      let buf = "";
      let child;
      try {
        child = spawn("openresty", ["-V"], { encoding: "utf8" });
      } catch {
        return resolve("");
      }
      child.stdout?.on("data", (d) => (buf += d.toString()));
      child.stderr?.on("data", (d) => (buf += d.toString())); // -V prints to stderr
      child.on("error", () => resolve(""));
      child.on("close", () => resolve(buf));
      setTimeout(() => resolve(buf), 3000);
    });

    const pick = (flag) => {
      const m = out.match(new RegExp(`--${flag}=([^\\s]+)`));
      return m ? m[1] : "";
    };
    const confPath =
      pick("conf-path") ||
      OPENRESTY_KNOWN_CONFS.find((p) => fs.existsSync(p)) ||
      OPENRESTY_KNOWN_CONFS[0];
    const paths = {
      installed: Boolean(out),
      sbinPath: pick("sbin-path") || "openresty",
      confPath,
      pidPath: pick("pid-path") || "/usr/local/openresty/nginx/logs/nginx.pid",
      sitesEnabled: path.join(path.dirname(confPath), "sites-enabled"),
    };
    this._orPaths = paths;
    return paths;
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edge_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT DEFAULT 'caddy',
        http_port INTEGER DEFAULT 80,
        https_port INTEGER DEFAULT 443,
        admin_port INTEGER DEFAULT 2019,
        acme_email TEXT DEFAULT '',
        auto_https INTEGER DEFAULT 1,
        on_demand_tls INTEGER DEFAULT 1,
        hsts_enabled INTEGER DEFAULT 1,
        is_running INTEGER DEFAULT 0,
        last_sync_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0
      );
    `);

    const row = this.db.prepare("SELECT * FROM edge_settings WHERE id=1").get();
    if (!row) {
      this.db
        .prepare(
          `INSERT INTO edge_settings (id, provider, http_port, https_port, admin_port, acme_email, auto_https, on_demand_tls, hsts_enabled, is_running, last_sync_at, updated_at)
           VALUES (1, 'caddy', 80, 443, 2019, '', 1, 1, 1, 0, 0, ?)`,
        )
        .run(Date.now());
    }
  }

  getSettings() {
    const row = this.db.prepare("SELECT * FROM edge_settings WHERE id=1").get();
    return {
      provider: row?.provider || "caddy",
      http_port: row?.http_port ?? 80,
      https_port: row?.https_port ?? 443,
      admin_port: row?.admin_port ?? 2019,
      acme_email: row?.acme_email || "",
      auto_https: Boolean(row?.auto_https ?? 1),
      on_demand_tls: Boolean(row?.on_demand_tls ?? 1),
      hsts_enabled: Boolean(row?.hsts_enabled ?? 1),
      is_running: Boolean(row?.is_running ?? 0),
      last_sync_at: row?.last_sync_at ?? 0,
    };
  }

  updateSettings(newSettings) {
    const current = this.getSettings();
    const updated = { ...current, ...newSettings };

    this.db
      .prepare(
        `UPDATE edge_settings SET 
        provider=?, http_port=?, https_port=?, admin_port=?, acme_email=?, 
        auto_https=?, on_demand_tls=?, hsts_enabled=?, updated_at=?
       WHERE id=1`,
      )
      .run(
        updated.provider,
        updated.http_port,
        updated.https_port,
        updated.admin_port,
        updated.acme_email,
        updated.auto_https ? 1 : 0,
        updated.on_demand_tls ? 1 : 0,
        updated.hsts_enabled ? 1 : 0,
        Date.now(),
      );

    this.settings = this.getSettings();
    return this.settings;
  }

  /**
   * Check if a domain is permitted for On-Demand TLS
   */
  isDomainAllowed(domain) {
    if (!domain) return false;
    const clean = domain.toLowerCase().trim();

    // Magic DNS
    if (
      clean.endsWith(".sslip.io") ||
      clean.endsWith(".nip.io") ||
      clean.endsWith(".traefik.me") ||
      clean.endsWith(".localhost") ||
      clean === "localhost"
    ) {
      return true;
    }

    // Check registered project domains in SQLite
    const dom = this.db
      .prepare("SELECT 1 FROM domains WHERE LOWER(hostname)=? AND verified=1")
      .get(clean);
    return Boolean(dom);
  }

  /**
   * Check if host is loopback/private IP vs real public IP
   */
  isPrivateOrLoopbackHost(host) {
    if (!host) return true;
    const clean = host.toLowerCase().trim();
    if (clean === "localhost" || clean.endsWith(".localhost")) return true;

    const ipMatch = clean.match(
      /(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})\.(sslip\.io|nip\.io|traefik\.me|ipq\.co|fdns\.uk)$/,
    );
    if (ipMatch) {
      const a = Number(ipMatch[1]);
      const b = Number(ipMatch[2]);
      if (a === 127) return true; // 127.0.0.0/8 loopback
      if (a === 10) return true; // 10.0.0.0/8 private
      if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
      return false; // Real Public IP!
    }
    return false;
  }

  /**
   * Rebuild routing and synchronize edge configuration
   */
  async syncRoutes() {
    const settings = this.getSettings();
    const projects = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
    const domains = this.db.prepare("SELECT * FROM domains ORDER BY created_at DESC").all();

    // Map projects with upstreams and hostnames
    const routeList = [];
    for (const p of projects) {
      if (!p.port) continue;
      const projDomains = domains.filter((d) => d.project === p.name);
      const primary = projDomains.find((d) => d.is_primary);
      const defaultHost = `${p.name}.127-0-0-1.sslip.io`;

      const hostnames = new Set();
      hostnames.add(defaultHost);
      if (primary) hostnames.add(primary.hostname);
      for (const d of projDomains) {
        if (d.verified) hostnames.add(d.hostname);
      }

      routeList.push({
        project: p.name,
        port: p.port,
        hostnames: Array.from(hostnames),
        domains: projDomains,
      });
    }

    if (settings.provider === "caddy") {
      await this.generateCaddyfile(routeList, settings);
      await this.reloadCaddy(settings);
    } else if (settings.provider === "openresty") {
      await this.generateOpenRestyConfigs(routeList, settings);
      await this.reloadOpenResty(settings);
    } else {
      // External mode: generate both exports
      await this.generateCaddyfile(routeList, settings);
      await this.generateOpenRestyConfigs(routeList, settings);
    }

    this.db.prepare("UPDATE edge_settings SET last_sync_at=? WHERE id=1").run(Date.now());
    return { ok: true, provider: settings.provider, routesCount: routeList.length };
  }

  /**
   * Generate Production Caddyfile
   */
  async generateCaddyfile(routeList, settings) {
    const caddyfilePath = path.join(this.edgeDir, "Caddyfile");
    const emailDirective = settings.acme_email
      ? `email ${settings.acme_email}`
      : "# No ACME email specified";

    let content = `# Generated automatically by HosteraX Managed Edge Subsystem
# Provider: Caddy 2 (Automatic HTTPS & Zero-Downtime Hot Reload)

{
  admin 0.0.0.0:${settings.admin_port}
  ${emailDirective}
  ${
    settings.on_demand_tls
      ? `on_demand_tls {
    ask http://host.docker.internal:7777/api/edge/check-domain
  }`
      : ""
  }
}

`;

    for (const r of routeList) {
      for (const host of r.hostnames) {
        const isPrivate = this.isPrivateOrLoopbackHost(host);

        if (isPrivate) {
          // Serve both plain HTTP and TLS internal so local devs can browse with 0 friction
          content += `http://${host} {\n`;
          content += `  header X-Forwarded-Proto http\n`;
          content += `  header X-Real-IP {remote_host}\n`;
          content += `  reverse_proxy host.docker.internal:${r.port} {\n`;
          content += `    header_up Host {upstream_hostport}\n`;
          content += `    header_up X-Forwarded-Host {host}\n`;
          content += `  }\n`;
          content += `}\n\n`;

          content += `https://${host} {\n`;
          content += `  tls internal\n`;
          if (settings.hsts_enabled) {
            content += `  header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"\n`;
          }
          content += `  header X-Forwarded-Proto https\n`;
          content += `  header X-Real-IP {remote_host}\n`;
          content += `  reverse_proxy host.docker.internal:${r.port} {\n`;
          content += `    header_up Host {upstream_hostport}\n`;
          content += `    header_up X-Forwarded-Host {host}\n`;
          content += `  }\n`;
          content += `}\n\n`;
        } else {
          // Public custom domain with automatic Let's Encrypt / ZeroSSL on-demand
          const tlsDirective = settings.on_demand_tls ? "tls {\n    on_demand\n  }" : "";

          content += `${host} {\n`;
          if (tlsDirective) content += `  ${tlsDirective}\n`;
          if (settings.hsts_enabled) {
            content += `  header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"\n`;
          }
          content += `  header X-Forwarded-Proto {scheme}\n`;
          content += `  header X-Real-IP {remote_host}\n`;
          content += `  reverse_proxy host.docker.internal:${r.port} {\n`;
          content += `    header_up Host {upstream_hostport}\n`;
          content += `    header_up X-Forwarded-Host {host}\n`;
          content += `  }\n`;
          content += `}\n\n`;
        }
      }
    }

    fs.writeFileSync(caddyfilePath, content, "utf8");
    return caddyfilePath;
  }

  /**
   * Retrieve Caddy's Local Authority Root CA Certificate
   */
  async getRootCaCertificate() {
    const caFile = path.join(this.edgeDir, "caddy-local-root-ca.crt");
    if (fs.existsSync(caFile)) {
      return fs.readFileSync(caFile, "utf8");
    }
    try {
      const cert = await new Promise((resolve, reject) => {
        const child = spawn("docker", [
          "exec",
          "hx_edge",
          "cat",
          "/data/caddy/pki/authorities/local/root.crt",
        ]);
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("close", (code) =>
          code === 0 && out.includes("BEGIN CERTIFICATE")
            ? resolve(out)
            : reject(new Error("no cert")),
        );
        child.on("error", reject);
      });
      fs.writeFileSync(caFile, cert, "utf8");
      return cert;
    } catch {
      return null;
    }
  }

  /**
   * Deploy HosteraX's Lua modules into the edge lualib tree.
   * All hot-path state lives in ngx.shared.dict — no Redis, no file I/O.
   */
  writeLuaModules() {
    const files = {
      "site_logger.lua": `-- hosterax/site_logger.lua : per-request analytics into shared memory
local _M = {}
local analytics = ngx.shared.analytics
local request_data = ngx.shared.request_data

local function bump(key, by)
  if not analytics then return end
  local ok = analytics:incr(key, by or 1)
  if not ok then analytics:set(key, by or 1) end
end

function _M.log()
  local host = ngx.var.host or "-"
  local status = tonumber(ngx.var.status) or 0
  local bytes = tonumber(ngx.var.body_bytes_sent) or 0
  local rt = tonumber(ngx.var.request_time) or 0
  local day = os.date("!%Y-%m-%d")

  bump("req:" .. host)
  bump("req:" .. host .. ":" .. day)
  bump("bytes:" .. host, bytes)
  bump("status:" .. host .. ":" .. math.floor(status / 100) .. "xx")
  bump("rt_ms:" .. host, math.floor(rt * 1000))
  bump("total:req")

  local country = ngx.var.http_cf_ipcountry or ngx.ctx.hx_country or "ZZ"
  bump("geo:" .. country)

  if request_data then
    local line = string.format("%s\\t%s\\t%s\\t%s\\t%d\\t%.3f",
      ngx.utctime(), host, ngx.var.request_method or "-",
      ngx.var.request_uri or "-", status, rt)
    local idx = request_data:incr("log:idx", 1)
    if not idx then request_data:set("log:idx", 1); idx = 1 end
    request_data:set("log:" .. (idx % 500), line, 3600)
  end
end

return _M
`,
      "geo_country.lua": `-- hosterax/geo_country.lua : best-effort country resolution (libmaxminddb optional)
local _M = {}

function _M.resolve()
  local c = ngx.var.http_cf_ipcountry or ngx.var.geoip2_country_code
  if c and c ~= "" then ngx.ctx.hx_country = c; return c end
  ngx.ctx.hx_country = "ZZ"
  return "ZZ"
end

return _M
`,
      "rules_guard.lua": `-- hosterax/rules_guard.lua : access rules + rate limiting from shared memory
local _M = {}
local analytics = ngx.shared.analytics

function _M.guard()
  local ip = ngx.var.remote_addr or "0.0.0.0"
  local host = ngx.var.host or "-"

  if analytics and analytics:get("block:ip:" .. ip) then
    return ngx.exit(403)
  end
  if analytics and analytics:get("block:host:" .. host) then
    return ngx.exit(403)
  end

  local limit = analytics and tonumber(analytics:get("ratelimit:" .. host)) or nil
  if limit then
    local key = "rl:" .. host .. ":" .. ip .. ":" .. math.floor(ngx.now())
    local n = analytics:incr(key, 1)
    if not n then analytics:set(key, 1, 2); n = 1 end
    if n > limit then
      ngx.header["Retry-After"] = "1"
      return ngx.exit(429)
    end
  end
end

return _M
`,
      "pipe_stream.lua": `-- hosterax/pipe_stream.lua : chunked live tail of the in-memory request log
local _M = {}
local request_data = ngx.shared.request_data

function _M.recent(limit)
  local out = {}
  if not request_data then return out end
  local idx = tonumber(request_data:get("log:idx")) or 0
  local n = math.min(limit or 100, 500)
  for i = 0, n - 1 do
    local line = request_data:get("log:" .. ((idx - i) % 500))
    if line then table.insert(out, line) end
  end
  return out
end

function _M.stream()
  ngx.header["Content-Type"] = "text/event-stream"
  ngx.header["Cache-Control"] = "no-cache"
  local last = tonumber(request_data and request_data:get("log:idx")) or 0
  local deadline = ngx.now() + 55
  while ngx.now() < deadline do
    local idx = tonumber(request_data and request_data:get("log:idx")) or 0
    while last < idx do
      last = last + 1
      local line = request_data:get("log:" .. (last % 500))
      if line then ngx.say("data: " .. line); ngx.flush(true) end
    end
    ngx.sleep(0.5)
  end
end

return _M
`,
      "mgmt_api.lua": `-- hosterax/mgmt_api.lua : loopback management API (analytics / logs / health)
local _M = {}
local cjson = require "cjson"
local pipe = require "hosterax.pipe_stream"
local analytics = ngx.shared.analytics

local function prefix(p)
  local out = {}
  if not analytics then return out end
  for _, k in ipairs(analytics:get_keys(0)) do
    if k:sub(1, #p) == p then out[k:sub(#p + 1)] = analytics:get(k) end
  end
  return out
end

function _M.handle()
  local uri = ngx.var.uri
  ngx.header["Content-Type"] = "application/json"

  if uri == "/health" then
    return ngx.say(cjson.encode({ ok = true, edge = "openresty", ts = ngx.time() }))
  elseif uri == "/analytics" then
    return ngx.say(cjson.encode({ requests = prefix("req:"), bytes = prefix("bytes:") }))
  elseif uri == "/analytics/totals" then
    return ngx.say(cjson.encode({ total = analytics and analytics:get("total:req") or 0 }))
  elseif uri == "/analytics/geo" then
    return ngx.say(cjson.encode(prefix("geo:")))
  elseif uri == "/logs/recent" then
    local n = tonumber(ngx.var.arg_limit) or 100
    return ngx.say(cjson.encode({ lines = pipe.recent(n) }))
  elseif uri == "/logs/stream" then
    return pipe.stream()
  end

  ngx.status = 404
  ngx.say(cjson.encode({ error = "not_found" }))
end

return _M
`,
    };
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(this.luaDir, name), body, "utf8");
    }
    return Object.keys(files);
  }

  /**
   * Generate OpenResty / Nginx configuration.
   * - :80  serves traffic and proxies /.well-known/acme-challenge/ to Certbot
   *        standalone on 127.0.0.1:<ACME_HTTP01_PORT> (no port-80 fight)
   * - :443 terminates TLS from certificate files Certbot wrote (read-only here)
   * - Lua provides analytics / rules / logging + loopback mgmt API on :9145
   */
  async generateOpenRestyConfigs(routeList, settings) {
    this.writeLuaModules();
    const nginxConfPath = path.join(this.edgeDir, "nginx.conf");
    const luaRoot = path.dirname(this.luaDir).replace(/\\/g, "/");

    const mainConf = `# Generated by HosteraX Managed Edge Subsystem — OpenResty provider
worker_processes auto;
events { worker_connections 4096; }

http {
  include       mime.types;
  default_type  application/octet-stream;
  sendfile on;
  tcp_nopush on;
  keepalive_timeout 65;
  server_tokens off;
  resolver 1.1.1.1 8.8.8.8 ipv6=off;

  # HosteraX Lua engine (shared memory, no Redis / no hot-path file I/O)
  lua_package_path "${luaRoot}/?.lua;/usr/local/openresty/site/lualib/?.lua;;";
  lua_shared_dict analytics 32m;
  lua_shared_dict request_data 32m;
  lua_code_cache on;

  access_by_lua_block {
    require("hosterax.geo_country").resolve()
    require("hosterax.rules_guard").guard()
  }
  log_by_lua_block { require("hosterax.site_logger").log() }

  # Loopback management API — analytics, logs, health
  server {
    listen 127.0.0.1:${this.mgmtPort};
    location / { content_by_lua_block { require("hosterax.mgmt_api").handle() } }
  }

  include ${this.openrestySitesDir.replace(/\\/g, "/")}/*.conf;
}
`;
    fs.writeFileSync(nginxConfPath, mainConf, "utf8");

    // Clean old site configs
    for (const f of fs.readdirSync(this.openrestySitesDir)) {
      if (f.endsWith(".conf")) fs.unlinkSync(path.join(this.openrestySitesDir, f));
    }

    const acmeBlock =
      `  # ACME HTTP-01 — Certbot runs --standalone on a loopback alternate port\n` +
      `  location /.well-known/acme-challenge/ {\n` +
      `    proxy_pass http://127.0.0.1:${this.acmeHttp01Port};\n` +
      `    proxy_set_header Host $host;\n` +
      `  }\n\n`;

    const upstreamBlock = (port) =>
      `  location / {\n` +
      `    proxy_pass http://host.docker.internal:${port};\n` +
      `    proxy_http_version 1.1;\n` +
      `    proxy_set_header Upgrade $http_upgrade;\n` +
      `    proxy_set_header Connection "upgrade";\n` +
      `    proxy_set_header Host $host;\n` +
      `    proxy_set_header X-Real-IP $remote_addr;\n` +
      `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n` +
      `    proxy_set_header X-Forwarded-Proto $scheme;\n` +
      `  }\n`;

    for (const r of routeList) {
      const siteConfPath = path.join(this.openrestySitesDir, `${r.project}.conf`);
      let conf = `# OpenResty configuration for project: ${r.project}\n`;

      for (const host of r.hostnames) {
        const dom = r.domains.find((d) => d.hostname === host);
        const forceHttps = dom ? Boolean(dom.force_https ?? 1) : false;

        // Ensure a handshake-capable certificate exists before referencing it.
        let certs = null;
        try {
          if (this.tlsManager?.certPaths) {
            await this.tlsManager.ensureBootstrapCertificate(host);
            certs = this.tlsManager.certPaths(host);
          }
        } catch {}
        const haveTls = Boolean(certs && (certs.hasAcme || certs.hasLocal));

        conf += `server {\n  listen ${settings.http_port};\n  server_name ${host};\n\n${acmeBlock}`;
        if (haveTls && forceHttps) {
          conf += `  location / { return 301 https://$host$request_uri; }\n}\n\n`;
        } else {
          conf += upstreamBlock(r.port) + `}\n\n`;
        }

        if (haveTls) {
          conf += `server {\n  listen ${settings.https_port} ssl;\n  http2 on;\n  server_name ${host};\n\n`;
          conf += `  # Certificates are issued by Certbot; OpenResty only reads them.\n`;
          conf += `  ssl_certificate ${certs.cert.replace(/\\/g, "/")};\n`;
          conf += `  ssl_certificate_key ${certs.key.replace(/\\/g, "/")};\n`;
          conf += `  ssl_protocols TLSv1.2 TLSv1.3;\n  ssl_session_cache shared:SSL:10m;\n\n`;
          if (
            settings.hsts_enabled && dom ? Boolean(dom.hsts_enabled ?? 1) : settings.hsts_enabled
          ) {
            conf += `  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n`;
          }
          conf += acmeBlock + upstreamBlock(r.port) + `}\n\n`;
        }
      }

      fs.writeFileSync(siteConfPath, conf, "utf8");
    }
  }

  /**
   * Read the OpenResty Lua management API (analytics / logs / health).
   */
  async readEdgeMgmt(pathname = "/health") {
    const attempt = (host, port) =>
      new Promise((resolve) => {
        const req = http.request(
          { hostname: host, port, path: pathname, method: "GET", timeout: 2500 },
          (res) => {
            let body = "";
            res.on("data", (d) => (body += d.toString()));
            res.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve({ ok: false, raw: body });
              }
            });
          },
        );
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
        req.on("error", () => resolve(null));
        req.end();
      });

    const direct = await attempt("127.0.0.1", this.mgmtPort);
    if (direct) return direct;

    // Containerized edge: mgmt API is bound to the container's loopback.
    const out = await new Promise((resolve) => {
      let buf = "";
      const child = spawn("docker", [
        "exec",
        "hx_edge",
        "curl",
        "-s",
        `http://127.0.0.1:${this.mgmtPort}${pathname}`,
      ]);
      child.stdout?.on("data", (d) => (buf += d.toString()));
      child.on("close", () => resolve(buf));
      child.on("error", () => resolve(""));
      setTimeout(() => resolve(buf), 3000);
    });
    try {
      return JSON.parse(out);
    } catch {
      return { ok: false, error: "edge management API unreachable" };
    }
  }

  /**
   * Hot-reload Caddy via Admin REST API or container
   */
  async reloadCaddy(settings) {
    const caddyfilePath = path.join(this.edgeDir, "Caddyfile");
    if (!fs.existsSync(caddyfilePath)) return;

    try {
      const caddyfileContent = fs.readFileSync(caddyfilePath, "utf8");
      // Attempt Zero-Downtime REST API Load on port 2019
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: settings.admin_port,
            path: "/load",
            method: "POST",
            headers: {
              "Content-Type": "text/caddyfile",
              "Content-Length": Buffer.byteLength(caddyfileContent),
            },
            timeout: 2000,
          },
          (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
            else reject(new Error(`Caddy API returned ${res.statusCode}`));
          },
        );
        req.on("error", (e) => reject(e));
        req.write(caddyfileContent);
        req.end();
      });
    } catch {
      // If REST API is not reachable (e.g. initial start), manage container
      await this.ensureEdgeContainerRunning("caddy", settings);
    }
  }

  /**
   * Hot-reload OpenResty container
   */
  async reloadOpenResty(settings) {
    await this.ensureEdgeContainerRunning("openresty", settings);
    try {
      await new Promise((resolve) => {
        const child = spawn("docker", ["exec", "hx_edge", "openresty", "-s", "reload"], {
          encoding: "utf8",
        });
        child.on("close", resolve);
        child.on("error", resolve);
        setTimeout(() => resolve(), 3000);
      });
    } catch {}
  }

  /**
   * Ensure hx_edge container is running with selected provider
   */
  async ensureEdgeContainerRunning(provider, settings) {
    if (provider === "external") {
      try {
        await new Promise((resolve) => {
          const child = spawn("docker", ["rm", "-f", "hx_edge"], { encoding: "utf8" });
          child.on("close", resolve);
          child.on("error", resolve);
        });
      } catch {}
      this.db.prepare("UPDATE edge_settings SET is_running=0 WHERE id=1").run();
      return;
    }

    const isCaddy = provider === "caddy";
    const image = isCaddy ? "caddy:2-alpine" : "openresty/openresty:alpine";

    // Clean previous edge container if switching provider
    try {
      await new Promise((resolve) => {
        const child = spawn("docker", ["rm", "-f", "hx_edge"], { encoding: "utf8" });
        child.on("close", resolve);
        child.on("error", resolve);
      });
    } catch {}

    const caddyfilePath = path.join(this.edgeDir, "Caddyfile");
    const nginxConfPath = path.join(this.edgeDir, "nginx.conf");

    const dockerArgs = [
      "run",
      "-d",
      "--name",
      "hx_edge",
      "--restart",
      "unless-stopped",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      `${settings.http_port}:80`,
      "-p",
      `${settings.https_port}:443`,
    ];

    if (isCaddy) {
      dockerArgs.push(
        "-p",
        `127.0.0.1:${settings.admin_port}:2019`,
        "-v",
        `${caddyfilePath}:/etc/caddy/Caddyfile`,
        "-v",
        `hx_edge_caddy_data:/data`,
        "-v",
        `hx_edge_caddy_config:/config`,
        image,
      );
    } else {
      dockerArgs.push(
        "-v",
        `${nginxConfPath}:/etc/nginx/nginx.conf`,
        "-v",
        `${this.openrestySitesDir}:/etc/nginx/conf.d`,
        "-v",
        `${this.acmeWebrootDir}:/var/www/acme-challenge`,
        "-v",
        `hx_edge_openresty_certs:/etc/letsencrypt`,
        image,
      );
    }

    await new Promise((resolve) => {
      const child = spawn("docker", dockerArgs, { encoding: "utf8" });
      child.on("close", resolve);
      child.on("error", resolve);
      setTimeout(() => resolve(), 5000);
    });

    this.db.prepare("UPDATE edge_settings SET is_running=1 WHERE id=1").run();
  }

  /**
   * Get edge status, container inspection, and active metrics
   */
  async getStatus() {
    const settings = this.getSettings();
    let containerStatus = "stopped";
    let memoryUsage = "0 MB";
    let uptime = "—";

    try {
      const inspectRes = await new Promise((resolve) => {
        const child = spawn(
          "docker",
          ["inspect", "--format", "{{.State.Status}}|{{.State.StartedAt}}", "hx_edge"],
          {
            encoding: "utf8",
          },
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("close", () => resolve(out.trim()));
        child.on("error", () => resolve(""));
        setTimeout(() => resolve(""), 2000);
      });

      if (inspectRes) {
        const [st, startedAt] = inspectRes.split("|");
        containerStatus = st || "stopped";
        uptime = startedAt ? new Date(startedAt).toLocaleString() : "—";
      }
    } catch {}

    const totalDomains = this.db.prepare("SELECT COUNT(*) c FROM domains").get().c;
    const activeSsl = this.db
      .prepare("SELECT COUNT(*) c FROM domains WHERE ssl_status='active'")
      .get().c;

    return {
      provider: settings.provider,
      containerName: "hx_edge",
      containerStatus,
      httpPort: settings.http_port,
      httpsPort: settings.https_port,
      adminPort: settings.admin_port,
      autoHttps: settings.auto_https,
      onDemandTls: settings.on_demand_tls,
      hstsEnabled: settings.hsts_enabled,
      acmeEmail: settings.acme_email,
      totalDomains,
      activeSslCertificates: activeSsl,
      uptime,
      lastSyncAt: settings.last_sync_at,
    };
  }
}
