// hosterax/engine/src/edge-manager.mjs
// Pluggable Managed Edge Gateway Subsystem for HosteraX
// Supports Caddy 2 (Recommended Native Automatic HTTPS) & OpenResty (Nginx + Lua Engine)

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

export class EdgeManager {
  constructor(db, homeDir, tlsManager) {
    this.db = db;
    this.homeDir = homeDir;
    this.tlsManager = tlsManager;
    this.edgeDir = path.join(homeDir, "edge");
    this.caddyDataDir = path.join(this.edgeDir, "caddy-data");
    this.caddyConfigDir = path.join(this.edgeDir, "caddy-config");
    this.openrestySitesDir = path.join(this.edgeDir, "sites-enabled");
    this.acmeWebrootDir = path.join(this.edgeDir, "acme-webroot");

    fs.mkdirSync(this.edgeDir, { recursive: true });
    fs.mkdirSync(this.caddyDataDir, { recursive: true });
    fs.mkdirSync(this.caddyConfigDir, { recursive: true });
    fs.mkdirSync(this.openrestySitesDir, { recursive: true });
    fs.mkdirSync(this.acmeWebrootDir, { recursive: true });

    this.ensureSchema();
    this.settings = this.getSettings();
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
           VALUES (1, 'caddy', 80, 443, 2019, '', 1, 1, 1, 0, 0, ?)`
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
       WHERE id=1`
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
        Date.now()
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
    const dom = this.db.prepare("SELECT 1 FROM domains WHERE LOWER(hostname)=? AND verified=1").get(clean);
    return Boolean(dom);
  }

  /**
   * Check if host is loopback/private IP vs real public IP
   */
  isPrivateOrLoopbackHost(host) {
    if (!host) return true;
    const clean = host.toLowerCase().trim();
    if (clean === "localhost" || clean.endsWith(".localhost")) return true;

    const ipMatch = clean.match(/(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})\.(sslip\.io|nip\.io|traefik\.me|ipq\.co|fdns\.uk)$/);
    if (ipMatch) {
      const a = Number(ipMatch[1]);
      const b = Number(ipMatch[2]);
      if (a === 127) return true; // 127.0.0.0/8 loopback
      if (a === 10) return true;  // 10.0.0.0/8 private
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
    const emailDirective = settings.acme_email ? `email ${settings.acme_email}` : "# No ACME email specified";

    let content = `# Generated automatically by HosteraX Managed Edge Subsystem
# Provider: Caddy 2 (Automatic HTTPS & Zero-Downtime Hot Reload)

{
  admin 0.0.0.0:${settings.admin_port}
  ${emailDirective}
  ${settings.on_demand_tls ? `on_demand_tls {
    ask http://host.docker.internal:7777/api/edge/check-domain
  }` : ""}
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
          const tlsDirective = settings.on_demand_tls
            ? "tls {\n    on_demand\n  }"
            : "";

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
        const child = spawn("docker", ["exec", "hx_edge", "cat", "/data/caddy/pki/authorities/local/root.crt"]);
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("close", (code) => (code === 0 && out.includes("BEGIN CERTIFICATE") ? resolve(out) : reject(new Error("no cert"))));
        child.on("error", reject);
      });
      fs.writeFileSync(caFile, cert, "utf8");
      return cert;
    } catch {
      return null;
    }
  }

  /**
   * Generate OpenResty / Nginx Configuration Files
   */
  async generateOpenRestyConfigs(routeList, settings) {
    const nginxConfPath = path.join(this.edgeDir, "nginx.conf");
    const mainConf = `worker_processes auto;
events { worker_connections 1024; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  keepalive_timeout 65;

  # ACME Challenge & Global Upstreams
  include /etc/nginx/conf.d/*.conf;
  include ${this.openrestySitesDir.replace(/\\/g, "/")}/*.conf;
}
`;
    fs.writeFileSync(nginxConfPath, mainConf, "utf8");

    // Clean old site configs
    const existing = fs.readdirSync(this.openrestySitesDir);
    for (const f of existing) {
      if (f.endsWith(".conf")) fs.unlinkSync(path.join(this.openrestySitesDir, f));
    }

    for (const r of routeList) {
      const siteConfPath = path.join(this.openrestySitesDir, `${r.project}.conf`);
      let conf = `# OpenResty configuration for project: ${r.project}\n`;

      for (const host of r.hostnames) {
        conf += `server {\n`;
        conf += `  listen ${settings.http_port};\n`;
        conf += `  server_name ${host};\n\n`;

        // ACME challenge location for Certbot / HTTP-01
        conf += `  location /.well-known/acme-challenge/ {\n`;
        conf += `    root /var/www/acme-challenge;\n`;
        conf += `  }\n\n`;

        conf += `  location / {\n`;
        conf += `    proxy_pass http://host.docker.internal:${r.port};\n`;
        conf += `    proxy_http_version 1.1;\n`;
        conf += `    proxy_set_header Upgrade $http_upgrade;\n`;
        conf += `    proxy_set_header Connection "upgrade";\n`;
        conf += `    proxy_set_header Host $host;\n`;
        conf += `    proxy_set_header X-Real-IP $remote_addr;\n`;
        conf += `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
        conf += `    proxy_set_header X-Forwarded-Proto $scheme;\n`;
        conf += `  }\n`;
        conf += `}\n\n`;
      }

      fs.writeFileSync(siteConfPath, conf, "utf8");
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
          }
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
        const child = spawn("docker", ["exec", "hx_edge", "openresty", "-s", "reload"], { encoding: "utf8" });
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
        image
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
        image
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
        const child = spawn("docker", ["inspect", "--format", "{{.State.Status}}|{{.State.StartedAt}}", "hx_edge"], {
          encoding: "utf8",
        });
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
    const activeSsl = this.db.prepare("SELECT COUNT(*) c FROM domains WHERE ssl_status='active'").get().c;

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
