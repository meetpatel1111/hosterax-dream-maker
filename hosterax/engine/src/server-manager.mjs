// hosterax/engine/src/server-manager.mjs
// Multi-Node Compute Infrastructure & Remote VPS Management Subsystem for HosteraX
// Supports agentless SSH management, automated Docker bootstrap, remote health polling, and local node supervision.

import { encryptSecret, decryptSecret } from "./secrets.mjs";
import { isSafeHostname } from "./security.mjs";
import crypto from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";
import { spawnSync } from "./safe-exec.mjs";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

export class ServerManager {
  constructor({ db, HOME }) {
    this.db = db;
    this.HOME = HOME;
    this.keysDir = path.join(this.HOME, "ssh_keys");
    fs.mkdirSync(this.keysDir, { recursive: true });

    this.initSchema();
    this.ensureLocalNode();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'remote',
        host TEXT,
        port INTEGER DEFAULT 22,
        username TEXT DEFAULT 'root',
        auth_type TEXT DEFAULT 'key',
        private_key TEXT,
        password TEXT,
        status TEXT NOT NULL DEFAULT 'online',
        docker_version TEXT,
        os_info TEXT,
        cpu_cores INTEGER,
        total_ram_mb INTEGER,
        cpu_usage_pct REAL DEFAULT 0,
        ram_usage_pct REAL DEFAULT 0,
        disk_usage_pct REAL DEFAULT 0,
        containers_count INTEGER DEFAULT 0,
        is_default INTEGER DEFAULT 0,
        last_ping_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pr_previews (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_title TEXT,
        branch TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        subdomain TEXT NOT NULL,
        preview_url TEXT NOT NULL,
        container_name TEXT,
        port INTEGER,
        status TEXT NOT NULL DEFAULT 'deploying',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Migrate any missing columns in servers table
    const cols = this.db
      .prepare("PRAGMA table_info(servers)")
      .all()
      .map((c) => c.name);
    const needed = [
      ["type", "TEXT NOT NULL DEFAULT 'remote'"],
      ["host", "TEXT"],
      ["port", "INTEGER DEFAULT 22"],
      ["username", "TEXT DEFAULT 'root'"],
      ["auth_type", "TEXT DEFAULT 'key'"],
      ["private_key", "TEXT"],
      ["password", "TEXT"],
      ["status", "TEXT NOT NULL DEFAULT 'online'"],
      ["docker_version", "TEXT"],
      ["os_info", "TEXT"],
      ["cpu_cores", "INTEGER"],
      ["total_ram_mb", "INTEGER"],
      ["cpu_usage_pct", "REAL DEFAULT 0"],
      ["ram_usage_pct", "REAL DEFAULT 0"],
      ["disk_usage_pct", "REAL DEFAULT 0"],
      ["containers_count", "INTEGER DEFAULT 0"],
      ["is_default", "INTEGER DEFAULT 0"],
      ["last_ping_at", "INTEGER"],
      ["created_at", "INTEGER NOT NULL DEFAULT 0"],
      ["updated_at", "INTEGER NOT NULL DEFAULT 0"],
    ];

    for (const [colName, colDef] of needed) {
      if (!cols.includes(colName)) {
        try {
          this.db.exec(`ALTER TABLE servers ADD COLUMN ${colName} ${colDef}`);
        } catch {}
      }
    }
  }

  ensureLocalNode() {
    const existing = this.db.prepare("SELECT * FROM servers WHERE id='local'").get();
    const totalMem = Math.round(os.totalmem() / 1048576);
    const cpuCores = os.cpus().length;
    const osInfo = `${os.type()} ${os.release()} (${os.arch()})`;
    const now = Date.now();

    let dockerVer = "not detected";
    try {
      // Runs while the engine boots, so it must be bounded: a hung Docker daemon cannot stall startup.
      const dRes = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
      });
      if (dRes.stdout && dRes.stdout.trim()) {
        dockerVer = `Docker v${dRes.stdout.trim()}`;
      }
    } catch {}

    if (!existing) {
      this.db
        .prepare(
          `
        INSERT INTO servers (
          id, name, type, host, port, username, auth_type, status,
          docker_version, os_info, cpu_cores, total_ram_mb, is_default,
          last_ping_at, created_at, updated_at
        ) VALUES (
          'local', 'Local Master Node', 'local', '127.0.0.1', 0, 'hosterax', 'none', 'online',
          ?, ?, ?, ?, 1, ?, ?, ?
        )
      `,
        )
        .run(dockerVer, osInfo, cpuCores, totalMem, now, now, now);
    } else {
      this.db
        .prepare(
          `
        UPDATE servers SET
          docker_version=?, os_info=?, cpu_cores=?, total_ram_mb=?, last_ping_at=?, updated_at=?
        WHERE id='local'
      `,
        )
        .run(dockerVer, osInfo, cpuCores, totalMem, now, now);
    }
  }

  listServers() {
    this.refreshLocalMetrics();
    const rows = this.db
      .prepare("SELECT * FROM servers ORDER BY is_default DESC, created_at ASC")
      .all();
    return rows.map((s) => ({
      ...s,
      private_key: s.private_key ? "••••••••••••" : "",
      has_key: Boolean(s.private_key),
      password: s.password ? "••••••••••••" : "",
      has_password: Boolean(s.password),
    }));
  }

  /** Raw row including encrypted credentials — internal use only. */
  _raw(id) {
    return this.db.prepare("SELECT * FROM servers WHERE id=?").get(id);
  }

  /** Public view of a server: credentials are never returned. */
  getServer(id) {
    if (id === "local") this.refreshLocalMetrics();
    const s = this._raw(id);
    if (!s) return s;
    return {
      ...s,
      private_key: s.private_key ? "••••••••••••" : "",
      has_key: Boolean(s.private_key),
      password: s.password ? "••••••••••••" : "",
      has_password: Boolean(s.password),
    };
  }

  /** Decrypted SSH credentials for the connection layer. */
  getServerCredentials(id) {
    const s = this._raw(id);
    if (!s) return null;
    return {
      host: s.host,
      port: s.port,
      username: s.username,
      privateKey: s.private_key ? decryptSecret(s.private_key) : "",
      password: s.password ? decryptSecret(s.password) : "",
    };
  }

  refreshLocalMetrics() {
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const ramUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }
      const cpuUsage = Math.round(((totalTick - totalIdle) / totalTick) * 100) || 0;

      let contCount = 0;
      try {
        const dCount = spawnSync("docker", ["ps", "-q"], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        });
        if (dCount.stdout) {
          contCount = dCount.stdout.trim().split("\n").filter(Boolean).length;
        }
      } catch {}

      this.db
        .prepare(
          `
        UPDATE servers SET
          cpu_usage_pct=?, ram_usage_pct=?, containers_count=?, last_ping_at=?
        WHERE id='local'
      `,
        )
        .run(cpuUsage, ramUsage, contCount, Date.now());
    } catch {}
  }

  createServer(data) {
    const id = `srv_${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();
    const type =
      data.type || (data.host === "127.0.0.1" || data.host === "localhost" ? "local" : "remote");
    if (!["local", "remote"].includes(type)) throw new Error("type must be 'local' or 'remote'");
    const host = String(data.host || "").trim();
    if (type === "remote") {
      if (!host || !(isSafeHostname(host) || net.isIP(host)))
        throw new Error("host must be a valid hostname or IP address");
      const p = data.port ? Number(data.port) : 22;
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("port must be 1-65535");
      if (data.username && !/^[a-z_][a-z0-9_-]{0,31}$/i.test(String(data.username).trim()))
        throw new Error("username contains invalid characters");
    }

    const record = {
      id,
      name: (data.name || "Remote Server").trim(),
      type,
      host: (data.host || "").trim(),
      port: data.port ? Number(data.port) : 22,
      username: (data.username || "root").trim(),
      auth_type: data.auth_type || "key",
      private_key: encryptSecret((data.private_key || "").trim()) || "",
      password: encryptSecret((data.password || "").trim()) || "",
      status: type === "local" ? "online" : "provisioning",
      // Remote specs are unknown until the node is reachable — never invent numbers.
      docker_version: type === "local" ? "not detected" : null,
      os_info: type === "local" ? `${os.type()} ${os.arch()}` : null,
      cpu_cores: type === "local" ? os.cpus().length : null,
      total_ram_mb: type === "local" ? Math.round(os.totalmem() / 1048576) : null,
      cpu_usage_pct: 0,
      ram_usage_pct: 0,
      disk_usage_pct: 0,
      containers_count: 0,
      is_default: 0,
      last_ping_at: now,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `
      INSERT INTO servers (
        id, name, type, host, port, username, auth_type, private_key, password,
        status, docker_version, os_info, cpu_cores, total_ram_mb, cpu_usage_pct,
        ram_usage_pct, disk_usage_pct, containers_count, is_default, last_ping_at,
        created_at, updated_at
      ) VALUES (
        @id, @name, @type, @host, @port, @username, @auth_type, @private_key, @password,
        @status, @docker_version, @os_info, @cpu_cores, @total_ram_mb, @cpu_usage_pct,
        @ram_usage_pct, @disk_usage_pct, @containers_count, @is_default, @last_ping_at,
        @created_at, @updated_at
      )
    `,
      )
      .run(record);

    return this.getServer(id);
  }

  updateServer(id, updates) {
    const srv = this._raw(id);
    if (!srv) throw new Error(`Server "${id}" not found.`);

    const now = Date.now();
    const clean = { ...updates };
    // Credentials are only replaced when a new, non-masked value is supplied.
    const fresh = (v) => (v && !String(v).includes("•") ? encryptSecret(String(v).trim()) : null);
    const merged = {
      ...srv,
      ...clean,
      private_key: fresh(clean.private_key) ?? srv.private_key,
      password: fresh(clean.password) ?? srv.password,
      updated_at: now,
    };

    this.db
      .prepare(
        `
      UPDATE servers SET
        name=@name,
        host=@host,
        port=@port,
        username=@username,
        auth_type=@auth_type,
        private_key=@private_key,
        password=@password,
        status=@status,
        docker_version=@docker_version,
        os_info=@os_info,
        cpu_cores=@cpu_cores,
        total_ram_mb=@total_ram_mb,
        cpu_usage_pct=@cpu_usage_pct,
        ram_usage_pct=@ram_usage_pct,
        disk_usage_pct=@disk_usage_pct,
        containers_count=@containers_count,
        updated_at=@updated_at
      WHERE id=@id
    `,
      )
      .run(merged);

    return this.getServer(id);
  }

  deleteServer(id) {
    if (id === "local") throw new Error("Cannot delete local master node.");
    const res = this.db.prepare("DELETE FROM servers WHERE id=?").run(id);
    return res.changes > 0;
  }

  /**
   * Test TCP / SSH port reachability
   */
  async testServerConnection(id) {
    const srv = this.getServer(id);
    if (!srv) throw new Error(`Server "${id}" not found.`);

    if (srv.type === "local") {
      return { ok: true, latencyMs: 1, message: "Local master node is active and responsive." };
    }

    const startTime = Date.now();
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(4000);

      socket.on("connect", () => {
        const latencyMs = Date.now() - startTime;
        socket.destroy();
        this.db
          .prepare("UPDATE servers SET status='online', last_ping_at=? WHERE id=?")
          .run(Date.now(), id);
        resolve({
          ok: true,
          latencyMs,
          message: `Successfully connected to ${srv.host}:${srv.port} in ${latencyMs}ms.`,
        });
      });

      socket.on("timeout", () => {
        socket.destroy();
        this.db
          .prepare("UPDATE servers SET status='unreachable', last_ping_at=? WHERE id=?")
          .run(Date.now(), id);
        resolve({
          ok: false,
          latencyMs: 4000,
          message: `Connection timed out after 4000ms connecting to ${srv.host}:${srv.port}`,
        });
      });

      socket.on("error", (err) => {
        socket.destroy();
        this.db
          .prepare("UPDATE servers SET status='unreachable', last_ping_at=? WHERE id=?")
          .run(Date.now(), id);
        resolve({
          ok: false,
          latencyMs: Date.now() - startTime,
          message: `SSH Socket error: ${err.message}`,
        });
      });

      socket.connect(srv.port || 22, srv.host);
    });
  }

  /**
   * Generate automated Docker & VPS bootstrap script
   */
  getBootstrapScript(serverId) {
    const srv = this.getServer(serverId);
    // The name ends up inside a bash script that an operator will run as root: keep it to a safe charset.
    const nodeName = String(srv?.name || "Remote Compute Node")
      .replace(/[^A-Za-z0-9 _.#:-]/g, "")
      .slice(0, 80);

    return `#!/usr/bin/env bash
# HosteraX Autonomous Node Provisioner
set -e
echo "==> [HosteraX] Provisioning node: ${nodeName}..."

if ! command -v docker &> /dev/null; then
    echo "==> [HosteraX] Installing Docker Engine & Compose Plugin..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
else
    echo "==> [HosteraX] Docker already installed: $(docker --version)"
fi

# Configure host firewall & docker bridge
echo "==> [HosteraX] Configuring Docker network & gateway..."
docker network create hosterax-net 2>/dev/null || true

echo "==> [HosteraX] Node bootstrap complete! Host is ready for deployments."
`;
  }
}
