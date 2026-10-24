// hosterax/engine/src/server-manager.mjs
// Multi-Node Compute Infrastructure & Remote VPS Management Subsystem for HosteraX
// Remote servers are reached over SSH with the system `ssh` client and key authentication; Docker on the
// remote machine is used through a bridge socket (see ssh-transport.mjs). The host key must be pinned by an
// operator before anything connects, and a changed key is refused.

import { encryptSecret, decryptSecret } from "./secrets.mjs";
import { SshTransport, validateSshTarget } from "./ssh-transport.mjs";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "./safe-exec.mjs";

const POLL_MS = 60_000;
// A fresh enough check that a deploy does not need to repeat it.
const FRESH_MS = 30_000;
// Two failed checks in a row before a server is called unreachable, so one dropped packet is not an outage.
const FAILURES_BEFORE_UNREACHABLE = 2;

export class ServerManager {
  /**
   * @param {{ db: any, HOME: string, transport?: SshTransport, env?: NodeJS.ProcessEnv,
   *   onStatusChange?: (server: any, from: string, to: string, detail: string) => void }} opts
   */
  constructor({ db, HOME, transport, env = process.env, onStatusChange }) {
    this.db = db;
    this.HOME = HOME;
    this.env = env;
    this.transport = transport || new SshTransport({ HOME, env });
    this.onStatusChange = onStatusChange || (() => {});
    this.pollMs = Number(env.HOSTERAX_SERVER_POLL_MS) || POLL_MS;
    this.timer = null;
    this.failures = new Map();
    this.probing = new Map();
    this.isInUse = () => false;

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
      ["host_key", "TEXT"],
      ["host_key_fingerprint", "TEXT"],
      ["host_key_pinned_at", "INTEGER"],
      ["public_key", "TEXT"],
      ["last_error", "TEXT"],
      ["last_error_code", "TEXT"],
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

  /** What clients may see of a row: never the key or the (unused) password, plus derived state. */
  _public(s) {
    if (!s) return s;
    const { private_key, password, host_key, ...rest } = s;
    return {
      ...rest,
      private_key: private_key ? "••••••••••••" : "",
      has_key: Boolean(private_key),
      password: "",
      has_password: false,
      host_key_type: host_key ? host_key.split(" ")[0] : null,
      host_key_pinned: Boolean(host_key),
      ready: s.type === "local" || this.isReady(s),
    };
  }

  listServers() {
    this.refreshLocalMetrics();
    const rows = this.db
      .prepare("SELECT * FROM servers ORDER BY is_default DESC, created_at ASC")
      .all();
    return rows.map((s) => this._public(s));
  }

  /** Raw row including encrypted credentials — internal use only. */
  _raw(id) {
    return this.db.prepare("SELECT * FROM servers WHERE id=?").get(id);
  }

  /** Public view of a server: credentials are never returned. */
  getServer(id) {
    if (id === "local") this.refreshLocalMetrics();
    return this._public(this._raw(id));
  }

  isReady(s) {
    return (
      s.type === "local" ||
      Boolean(s.host_key && s.status === "online" && this.transport.bridges.has(s.id))
    );
  }

  /** Decrypted connection details for the transport layer. */
  getTarget(id) {
    const s = this._raw(id);
    if (!s || s.type !== "remote") return null;
    return {
      id: s.id,
      host: s.host,
      port: s.port,
      username: s.username,
      privateKey: s.private_key ? decryptSecret(s.private_key) : "",
      hostKey: s.host_key || "",
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
    if (data.password)
      throw new Error(
        "Password login is not supported. Use an SSH key (paste one, or let HosteraX generate it).",
      );

    let target = { host: "", port: 22, username: "root" };
    let privateKey = "";
    let publicKey = "";
    if (type === "remote") {
      target = validateSshTarget({
        host: data.host,
        port: data.port ? Number(data.port) : 22,
        username: data.username || "root",
      });
      const reason = this.transport.unsupportedReason;
      if (reason) throw new Error(reason);
      if (data.generate_key || !String(data.private_key || "").trim()) {
        const pair = this.transport.generateKeyPair("hosterax");
        privateKey = pair.privateKey;
        publicKey = pair.publicKey;
      } else {
        privateKey = String(data.private_key).trim();
        publicKey = this.transport.derivePublicKey(privateKey);
      }
    }

    const record = {
      id,
      name:
        String(data.name || "Remote Server")
          .trim()
          .slice(0, 80) || "Remote Server",
      type,
      host: type === "remote" ? target.host : String(data.host || "").trim(),
      port: target.port,
      username: target.username,
      auth_type: type === "remote" ? "key" : "none",
      private_key: privateKey ? encryptSecret(privateKey) : "",
      password: "",
      public_key: publicKey || null,
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
        id, name, type, host, port, username, auth_type, private_key, password, public_key,
        status, docker_version, os_info, cpu_cores, total_ram_mb, cpu_usage_pct,
        ram_usage_pct, disk_usage_pct, containers_count, is_default, last_ping_at,
        created_at, updated_at
      ) VALUES (
        @id, @name, @type, @host, @port, @username, @auth_type, @private_key, @password, @public_key,
        @status, @docker_version, @os_info, @cpu_cores, @total_ram_mb, @cpu_usage_pct,
        @ram_usage_pct, @disk_usage_pct, @containers_count, @is_default, @last_ping_at,
        @created_at, @updated_at
      )
    `,
      )
      .run(record);

    return this.getServer(id);
  }

  /** Only these fields can be changed by a client; status and metrics are written by the engine itself. */
  updateServer(id, updates) {
    const srv = this._raw(id);
    if (!srv) throw new Error(`Server "${id}" not found.`);
    const u = updates || {};
    const now = Date.now();
    const next = { ...srv, updated_at: now };
    if (u.name !== undefined) next.name = String(u.name).trim().slice(0, 80) || srv.name;

    let resetPin = false;
    let keyChanged = false;
    if (srv.type === "remote") {
      const t = validateSshTarget({
        host: u.host !== undefined ? u.host : srv.host,
        port: u.port !== undefined ? Number(u.port) : srv.port,
        username: u.username !== undefined ? u.username : srv.username,
      });
      // A different address is a different machine until an operator confirms its key again.
      if (t.host !== srv.host || t.port !== srv.port) resetPin = true;
      Object.assign(next, t);
      // Credentials are only replaced when a new, non-masked value is supplied.
      if (u.private_key && !String(u.private_key).includes("•")) {
        const pem = String(u.private_key).trim();
        next.public_key = this.transport.derivePublicKey(pem);
        next.private_key = encryptSecret(pem);
        keyChanged = true;
      }
      if (u.password) throw new Error("Password login is not supported. Use an SSH key.");
      if (resetPin) {
        next.host_key = null;
        next.host_key_fingerprint = null;
        next.host_key_pinned_at = null;
        next.status = "provisioning";
        next.last_error = null;
        next.last_error_code = null;
      }
    }

    this.db
      .prepare(
        `
      UPDATE servers SET
        name=@name, host=@host, port=@port, username=@username,
        private_key=@private_key, public_key=@public_key,
        host_key=@host_key, host_key_fingerprint=@host_key_fingerprint,
        host_key_pinned_at=@host_key_pinned_at,
        status=@status, last_error=@last_error, last_error_code=@last_error_code,
        updated_at=@updated_at
      WHERE id=@id
    `,
      )
      .run(next);

    if (srv.type === "remote" && (resetPin || keyChanged)) {
      this.failures.delete(id);
      this.transport.stopBridge(id).catch(() => {});
    }
    return this.getServer(id);
  }

  deleteServer(id) {
    if (id === "local") throw new Error("Cannot delete local master node.");
    const inUse = this.isInUse(id);
    if (inUse)
      throw new Error(
        `Server is still running ${inUse} project${inUse === 1 ? "" : "s"}. Move or delete ${inUse === 1 ? "it" : "them"} first.`,
      );
    const res = this.db.prepare("DELETE FROM servers WHERE id=?").run(id);
    if (res.changes > 0) {
      this.failures.delete(id);
      this.transport.forget(id).catch(() => {});
    }
    return res.changes > 0;
  }

  // ── host keys ────────────────────────────────────────────────────────────────────────────────

  /**
   * What the server presents right now, compared with what is pinned. Pinning is a separate, explicit step
   * because the fingerprint should be checked against another source (the provider console, or
   * `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the server).
   */
  async scanHostKey(id) {
    const s = this._raw(id);
    if (!s || s.type !== "remote") throw new Error(`Remote server "${id}" not found.`);
    const keys = await this.transport.scanHostKeys(s.host, s.port);
    const pinned = s.host_key ? s.host_key.split(" ") : null;
    const pinnedPresent = pinned
      ? keys.some((k) => k.type === pinned[0] && k.key === pinned[1])
      : null;
    return {
      host: s.host,
      port: s.port,
      keys: keys.map(({ type, fingerprint }) => ({ type, fingerprint })),
      pinned: s.host_key
        ? {
            type: pinned[0],
            fingerprint: s.host_key_fingerprint,
            pinnedAt: s.host_key_pinned_at,
          }
        : null,
      // True when a key is pinned and the server no longer presents it.
      changed: pinnedPresent === false,
    };
  }

  /**
   * Pin a host key. The caller names the fingerprint they confirmed; it is only accepted if the server
   * presents exactly that key right now. Replacing an existing pin needs `replace: true`.
   */
  async pinHostKey(id, { fingerprint, replace = false } = {}) {
    const s = this._raw(id);
    if (!s || s.type !== "remote") throw new Error(`Remote server "${id}" not found.`);
    const want = String(fingerprint || "").trim();
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(want))
      throw new Error("fingerprint must look like SHA256:… (as printed by ssh-keygen -l)");
    if (s.host_key && !replace)
      throw new Error(
        "A host key is already pinned for this server. Pass replace=true only if you know the server was reinstalled.",
      );
    const keys = await this.transport.scanHostKeys(s.host, s.port);
    const match = keys.find((k) => k.fingerprint === want);
    if (!match)
      throw Object.assign(
        new Error(
          `The server does not present a key with that fingerprint. It presents: ${keys.map((k) => k.fingerprint).join(", ")}`,
        ),
        { code: "fingerprint_mismatch" },
      );
    this.db
      .prepare(
        `UPDATE servers SET host_key=?, host_key_fingerprint=?, host_key_pinned_at=?,
         status='provisioning', last_error=NULL, last_error_code=NULL, updated_at=? WHERE id=?`,
      )
      .run(`${match.type} ${match.key}`, match.fingerprint, Date.now(), Date.now(), id);
    this.failures.delete(id);
    await this.transport.stopBridge(id);
    return this.getServer(id);
  }

  // ── connection checks ────────────────────────────────────────────────────────────────────────

  /**
   * A real check: connect over SSH with the pinned key, authenticate, look at the machine, and make sure
   * Docker answers. Updates the stored status. Concurrent checks of one server share a single run.
   */
  testServerConnection(id) {
    if (this.probing.has(id)) return this.probing.get(id);
    const run = this._test(id).finally(() => this.probing.delete(id));
    this.probing.set(id, run);
    return run;
  }

  async _test(id) {
    const srv = this._raw(id);
    if (!srv) throw new Error(`Server "${id}" not found.`);
    if (srv.type === "local") {
      return { ok: true, latencyMs: 1, message: "Local master node is active and responsive." };
    }
    const target = this.getTarget(id);
    const res = await this.transport.probe(target);
    const now = Date.now();
    if (!res.ok) {
      this._recordFailure(srv, res);
      return {
        ok: false,
        latencyMs: res.latencyMs ?? null,
        code: res.code,
        message: res.message,
        status: this._raw(id).status,
      };
    }
    const { info } = res;
    this.failures.delete(id);
    const prev = srv.status;
    this.db
      .prepare(
        `UPDATE servers SET status='online', last_error=NULL, last_error_code=NULL, last_ping_at=?,
          docker_version=?, os_info=?, cpu_cores=?, total_ram_mb=?, disk_usage_pct=?,
          containers_count=?, updated_at=? WHERE id=?`,
      )
      .run(
        now,
        `Docker v${info.dockerVersion}`,
        info.osRelease || `${info.os} ${info.machine || ""}`.trim(),
        info.cpuCores,
        info.totalRamMb,
        info.diskUsagePct ?? 0,
        info.containers ?? 0,
        now,
        id,
      );
    if (prev !== "online") this.onStatusChange(this._public(this._raw(id)), prev, "online", "");
    await this._ensureBridge(id);
    return {
      ok: true,
      latencyMs: res.latencyMs,
      message: `Connected to ${srv.host}:${srv.port} as ${info.user || srv.username} in ${res.latencyMs}ms. Docker v${info.dockerVersion}.`,
      info,
    };
  }

  _recordFailure(srv, res) {
    const n = (this.failures.get(srv.id) || 0) + 1;
    this.failures.set(srv.id, n);
    // Anything that is not a transient network problem is a configuration problem: say so immediately.
    const transient = ["timeout", "unreachable", "closed", "refused", "dns"].includes(res.code);
    let status = srv.status;
    if (!srv.host_key || res.code === "no_host_key") status = "provisioning";
    else if (!transient) status = "error";
    else if (n >= FAILURES_BEFORE_UNREACHABLE || srv.status !== "online") status = "unreachable";
    this.db
      .prepare(
        "UPDATE servers SET status=?, last_error=?, last_error_code=?, last_ping_at=?, updated_at=? WHERE id=?",
      )
      .run(status, res.message, res.code, Date.now(), Date.now(), srv.id);
    if (status !== srv.status) {
      this.onStatusChange(this._public(this._raw(srv.id)), srv.status, status, res.message);
    }
    if (status !== "online") this.transport.stopBridge(srv.id).catch(() => {});
  }

  async _ensureBridge(id) {
    const target = this.getTarget(id);
    if (!target?.hostKey) return;
    // A bridge that dies is brought back by the next check.
    await this.transport.ensureBridge(target);
  }

  /** The Docker CLI environment for a server: empty for the local node. Throws if it is not connected. */
  dockerEnv(id) {
    if (!id || id === "local") return {};
    const s = this._raw(id);
    if (!s) throw new Error(`Server "${id}" not found.`);
    if (s.type === "local") return {};
    if (!s.host_key) throw new Error(`Server "${s.name}" has no confirmed host key yet.`);
    try {
      return this.transport.dockerEnv(id);
    } catch {
      throw new Error(
        `Server "${s.name}" is not connected${s.last_error ? `: ${s.last_error}` : ""}.`,
      );
    }
  }

  /**
   * Make sure a server can take a deploy right now, checking afresh unless it was verified moments ago.
   * Throws with the reason otherwise. The local node is always ready.
   */
  async ensureReady(id) {
    if (!id || id === "local") return;
    const s = this._raw(id);
    if (!s) throw new Error(`Server "${id}" not found.`);
    if (s.type === "local") return;
    const fresh = s.status === "online" && Date.now() - (s.last_ping_at || 0) < FRESH_MS;
    if (fresh && this.transport.bridges.has(id)) return;
    const res = await this.testServerConnection(id);
    if (!res.ok) throw new Error(`Server "${s.name}" is not available: ${res.message}`);
    if (!this.transport.bridges.has(id)) await this._ensureBridge(id);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────

  /** Open the bridges for pinned servers and keep their status current. */
  start() {
    if (this.transport.unsupportedReason) return;
    const remotes = this.db
      .prepare("SELECT id FROM servers WHERE type='remote' AND host_key IS NOT NULL")
      .all();
    for (const { id } of remotes) {
      this._ensureBridge(id).catch(() => {});
    }
    this.timer = setInterval(() => this.tick().catch(() => {}), this.pollMs);
    this.timer.unref?.();
  }

  async tick() {
    const remotes = this.db
      .prepare("SELECT id FROM servers WHERE type='remote' AND host_key IS NOT NULL")
      .all();
    await Promise.all(remotes.map(({ id }) => this.testServerConnection(id).catch(() => {})));
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.transport.stopAll();
  }

  /**
   * Generate automated Docker & VPS bootstrap script
   */
  getBootstrapScript(serverId) {
    const srv = this._raw(serverId);
    // The name ends up inside a bash script that an operator will run as root: keep it to a safe charset.
    const nodeName = String(srv?.name || "Remote Compute Node")
      .replace(/[^A-Za-z0-9 _.#:-]/g, "")
      .slice(0, 80);
    // Both values were validated when stored (user: [a-z0-9_-], key: base64 words), and are re-checked here.
    const user =
      srv?.username && /^[a-z_][a-z0-9_-]{0,31}$/i.test(srv.username) ? srv.username : "";
    const pub =
      srv?.public_key &&
      /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( [\w@.-]+)?$/.test(srv.public_key)
        ? srv.public_key
        : "";
    const authorize =
      user && user !== "root" && pub
        ? `
# Let HosteraX log in as ${user}, and use Docker without root
id -u ${user} >/dev/null 2>&1 || useradd -m -s /bin/bash ${user}
usermod -aG docker ${user}
install -d -m 700 -o ${user} -g ${user} ~${user}/.ssh
grep -qxF '${pub}' ~${user}/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~${user}/.ssh/authorized_keys
chown ${user}:${user} ~${user}/.ssh/authorized_keys && chmod 600 ~${user}/.ssh/authorized_keys
`
        : user === "root" && pub
          ? `
# Let HosteraX log in as root
install -d -m 700 ~root/.ssh
grep -qxF '${pub}' ~root/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~root/.ssh/authorized_keys
chmod 600 ~root/.ssh/authorized_keys
`
          : "";

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
${authorize}
# Configure host firewall & docker bridge
echo "==> [HosteraX] Configuring Docker network & gateway..."
docker network create hosterax-net 2>/dev/null || true

echo "==> [HosteraX] Node bootstrap complete! Host is ready for deployments."
`;
  }
}
