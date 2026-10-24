// hosterax/engine/src/ssh-transport.mjs
// Agentless SSH transport for remote servers.
//
// Nothing is installed on the remote machine. Every remote action is the system `ssh` client running
// `docker …` (or a short `sh -s` probe) there, and Docker itself is reached through a local unix socket
// that the engine serves: each connection to it is bridged to `ssh … docker system dial-stdio`, which is
// the same mechanism Docker's own `ssh://` support uses. That one socket is then usable by both the
// Docker CLI (`DOCKER_HOST=unix://…`) and the engine's HTTP Docker client.
//
// Security properties, all enforced here rather than left to ssh defaults:
//   - the host key is pinned: nothing connects until an operator has confirmed a fingerprint, and a key
//     that later changes is refused, never silently accepted;
//   - key authentication only — no password prompts, no agent, no forwarded agent, no TTY;
//   - the ssh client is always run with an explicit -F config generated from validated fields, so the
//     user's own ~/.ssh/config (ProxyCommand, Include, …) never influences a connection;
//   - the private key lives in a 0600 file inside a 0700 per-server directory and is removed with the server.

import { fork, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSafeHostname } from "./security.mjs";

const KEY_TYPE_ORDER = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
];
const HOST_KEY_ALGORITHMS = {
  "ssh-ed25519": "ssh-ed25519",
  "ecdsa-sha2-nistp256": "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384": "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521": "ecdsa-sha2-nistp521",
  "ssh-rsa": "rsa-sha2-512,rsa-sha2-256,ssh-rsa",
};
const WORKER = fileURLToPath(new URL("./ssh-bridge-worker.mjs", import.meta.url));
// Unix socket paths are limited to ~104 bytes on macOS and 108 on Linux. The longest name in a server's
// directory is ssh's control socket, which it creates with a 17 character temporary suffix.
const MAX_SOCKET_DIR = 80;

export const SSH_USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/i;

/** Throws unless host/port/username are safe to write into an ssh config and an argv. */
export function validateSshTarget({ host, port, username }) {
  const h = String(host || "").trim();
  if (!h || !(isSafeHostname(h) || net.isIP(h)))
    throw new Error("host must be a valid hostname or IP address");
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("port must be 1-65535");
  const u = String(username || "").trim();
  if (!SSH_USERNAME_RE.test(u)) throw new Error("username contains invalid characters");
  return { host: h, port: p, username: u };
}

/** `SHA256:…` fingerprint of a base64 SSH public key blob, in the same format `ssh-keygen -l` prints. */
export function fingerprintOf(base64Blob) {
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(base64Blob, "base64"))
    .digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** The key type is stored inside the blob itself; a line whose declared type disagrees is rejected. */
function blobKeyType(base64Blob) {
  const buf = Buffer.from(base64Blob, "base64");
  if (buf.length < 4) return null;
  const len = buf.readUInt32BE(0);
  if (len < 1 || len > 64 || buf.length < 4 + len) return null;
  return buf.subarray(4, 4 + len).toString("latin1");
}

/** Parse `ssh-keyscan` output (or a known_hosts-style list) into verified, de-duplicated host keys. */
export function parseHostKeys(output) {
  const keys = new Map();
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const [, type, blob] = parts;
    if (!KEY_TYPE_ORDER.includes(type)) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) continue;
    if (blobKeyType(blob) !== type) continue;
    keys.set(`${type} ${blob}`, { type, key: blob, fingerprint: fingerprintOf(blob) });
  }
  return [...keys.values()].sort(
    (a, b) => KEY_TYPE_ORDER.indexOf(a.type) - KEY_TYPE_ORDER.indexOf(b.type),
  );
}

/** Turn ssh's stderr into a stable code plus an operator-readable explanation. */
export function classifySshFailure(stderr, { timedOut = false } = {}) {
  const s = String(stderr || "");
  if (timedOut) return { code: "timeout", message: "The server did not answer in time." };
  if (
    /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key for .* has changed/i.test(
      s,
    )
  )
    return {
      code: "host_key_mismatch",
      message:
        "The server presented a different host key than the one pinned. This can mean the server was reinstalled, or that someone is intercepting the connection. Nothing was sent.",
    };
  if (/incorrect passphrase|passphrase/i.test(s))
    return {
      code: "bad_key",
      message: "The private key is protected by a passphrase. Use a key without one.",
    };
  if (/invalid format|error in libcrypto|Load key .*: /i.test(s))
    return { code: "bad_key", message: "The private key could not be read." };
  if (/Permission denied \(/i.test(s))
    return {
      code: "auth_failed",
      message:
        "The server rejected the key. Add the public key to ~/.ssh/authorized_keys for that user.",
    };
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(s))
    return { code: "dns", message: "The host name does not resolve." };
  if (/Connection refused/i.test(s))
    return { code: "refused", message: "Nothing is listening on that SSH port." };
  if (/timed out|No route to host|Network is unreachable/i.test(s))
    return { code: "unreachable", message: "The server cannot be reached from this machine." };
  if (/Connection closed|Connection reset|kex_exchange_identification/i.test(s))
    return { code: "closed", message: "The server closed the connection during the handshake." };
  return { code: "ssh_error", message: s.trim().split("\n").pop()?.slice(0, 300) || "SSH failed." };
}

const PROBE_SCRIPT = `
echo "HX_OS=$(uname -s 2>/dev/null)"
echo "HX_MACHINE=$(uname -m 2>/dev/null)"
echo "HX_USER=$(id -un 2>/dev/null)"
echo "HX_OSREL=$( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "HX_CPUS=$(nproc 2>/dev/null)"
echo "HX_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)"
echo "HX_DISK_PCT=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
echo "HX_LOAD=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)"
if ! command -v docker >/dev/null 2>&1; then
  echo "HX_DOCKER=missing"
  exit 0
fi
out=$(docker version --format '{{.Server.Version}}' 2>&1)
rc=$?
if [ $rc -eq 0 ]; then
  echo "HX_DOCKER=ok"
  echo "HX_DOCKER_VERSION=$out"
  echo "HX_CONTAINERS=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
elif echo "$out" | grep -qi 'permission denied'; then
  echo "HX_DOCKER=denied"
else
  echo "HX_DOCKER=down"
fi
`;

/** Parse the `HX_KEY=value` lines the probe script prints. */
export function parseProbe(stdout) {
  const kv = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const m = line.match(/^HX_([A-Z_]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  const num = (v) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
  };
  return {
    os: kv.OS || null,
    machine: kv.MACHINE || null,
    user: kv.USER || null,
    osRelease: kv.OSREL || null,
    cpuCores: num(kv.CPUS),
    totalRamMb: num(kv.MEM_MB),
    diskUsagePct: num(kv.DISK_PCT),
    load: num(kv.LOAD),
    docker: kv.DOCKER || "unknown",
    dockerVersion: kv.DOCKER_VERSION || null,
    containers: num(kv.CONTAINERS),
  };
}

function quoteConfigValue(v) {
  const s = String(v);
  if (/["\r\n\0]/.test(s))
    throw new Error("path contains characters that cannot be used in an ssh config");
  return `"${s}"`;
}

export class SshTransport {
  /**
   * @param {{ HOME: string, env?: NodeJS.ProcessEnv, platform?: string }} opts
   */
  constructor({ HOME, env = process.env, platform = process.platform }) {
    this.HOME = HOME;
    this.env = env;
    this.platform = platform;
    this.root = path.join(HOME, "ssh");
    this.sshBin = env.HOSTERAX_SSH_PATH || "ssh";
    this.keyscanBin = env.HOSTERAX_SSH_KEYSCAN_PATH || "ssh-keyscan";
    this.keygenBin = env.HOSTERAX_SSH_KEYGEN_PATH || "ssh-keygen";
    this.bridges = new Map();
    this.starting = new Map();
    this.shortRoot = null;
  }

  /** Remote servers need OpenSSH and unix sockets; Windows engines are not supported for them yet. */
  get unsupportedReason() {
    if (this.platform === "win32")
      return "Remote servers are not supported when the engine runs on Windows yet (they need OpenSSH config files and unix sockets). Run the engine on Linux or macOS, or inside WSL.";
    return null;
  }

  /** Per-server directory (0700). Falls back to a short temp path when HOME is too deep for a unix socket. */
  dirFor(serverId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(serverId)) throw new Error("invalid server id");
    let dir = path.join(this.root, serverId);
    if (Buffer.byteLength(dir) > MAX_SOCKET_DIR) {
      if (!this.shortRoot) {
        this.shortRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hx-"));
        fs.chmodSync(this.shortRoot, 0o700);
      }
      dir = path.join(this.shortRoot, serverId.slice(-12));
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {}
    return dir;
  }

  socketPath(serverId) {
    return path.join(this.dirFor(serverId), "d.sock");
  }

  _childEnv() {
    const keep = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SystemRoot", "TZ"];
    const out = { LC_ALL: "C", LANG: "C" };
    for (const k of keep) if (this.env[k]) out[k] = this.env[k];
    return out;
  }

  /**
   * Write the generated ssh config, the key and the pinned known_hosts for a server.
   * `target` = { id, host, port, username, privateKey, hostKey? } with plain-text key material.
   */
  prepare(target) {
    const reason = this.unsupportedReason;
    if (reason) throw new Error(reason);
    const { host, port, username } = validateSshTarget(target);
    const dir = this.dirFor(target.id);
    const keyPath = path.join(dir, "id");
    const configPath = path.join(dir, "config");
    const knownHosts = path.join(dir, "known_hosts");

    if (target.privateKey) {
      let pem = String(target.privateKey).replace(/\r\n/g, "\n").trim();
      pem += "\n";
      fs.writeFileSync(keyPath, pem, { mode: 0o600 });
      fs.chmodSync(keyPath, 0o600);
    }
    const alias = `hx-${target.id}`;
    const lines = [
      `Host ${alias}`,
      `  HostName ${host}`,
      `  Port ${port}`,
      `  User ${username}`,
      `  HostKeyAlias ${alias}`,
      `  IdentityFile ${quoteConfigValue(keyPath)}`,
      "  IdentitiesOnly yes",
      "  IdentityAgent none",
      "  BatchMode yes",
      "  PasswordAuthentication no",
      "  KbdInteractiveAuthentication no",
      "  PubkeyAuthentication yes",
      "  StrictHostKeyChecking yes",
      `  UserKnownHostsFile ${quoteConfigValue(knownHosts)}`,
      "  GlobalKnownHostsFile /dev/null",
      "  VerifyHostKeyDNS no",
      "  UpdateHostKeys no",
      "  CheckHostIP no",
      "  ForwardAgent no",
      "  ForwardX11 no",
      "  RequestTTY no",
      "  PermitLocalCommand no",
      "  ConnectTimeout 10",
      "  ServerAliveInterval 15",
      "  ServerAliveCountMax 3",
      "  LogLevel ERROR",
      "  ControlMaster auto",
      `  ControlPath ${quoteConfigValue(path.join(dir, "c"))}`,
      "  ControlPersist 60",
    ];
    if (target.hostKey) {
      const [type, blob] = String(target.hostKey).split(/\s+/);
      if (!KEY_TYPE_ORDER.includes(type) || !blob || blobKeyType(blob) !== type)
        throw new Error("stored host key is malformed");
      lines.push(`  HostKeyAlgorithms ${HOST_KEY_ALGORITHMS[type]}`);
      fs.writeFileSync(knownHosts, `${alias} ${type} ${blob}\n`, { mode: 0o600 });
    } else {
      // No pin yet: an empty known_hosts plus StrictHostKeyChecking=yes means every connection is refused.
      fs.writeFileSync(knownHosts, "", { mode: 0o600 });
    }
    fs.writeFileSync(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
    return { dir, alias, configPath, keyPath, knownHosts };
  }

  /** Ask the server for its public host keys. Returns every key it offers, best type first. */
  async scanHostKeys(host, port = 22, { timeoutMs = 10000 } = {}) {
    const reason = this.unsupportedReason;
    if (reason) throw new Error(reason);
    const t = validateSshTarget({ host, port, username: "x" });
    const args = ["-T", String(Math.ceil(timeoutMs / 1000)), "-p", String(t.port)];
    args.push("-t", "ed25519,ecdsa,rsa", "--", t.host);
    const res = await this._run(this.keyscanBin, args, { timeoutMs: timeoutMs + 3000 });
    const keys = parseHostKeys(res.stdout);
    if (!keys.length) {
      const f = classifySshFailure(res.stderr, { timedOut: res.timedOut });
      const e = new Error(
        res.code === "ENOENT"
          ? "ssh-keyscan is not installed on this machine (install the OpenSSH client)."
          : keys.length === 0 && !res.stderr && !res.timedOut
            ? `No SSH server answered at ${t.host}:${t.port}.`
            : f.message,
      );
      e.code = res.code === "ENOENT" ? "no_ssh_client" : f.code;
      throw e;
    }
    return keys;
  }

  /** Generate an unencrypted ed25519 key pair; returns the PEM-ish private key and the public key line. */
  generateKeyPair(comment = "hosterax") {
    const reason = this.unsupportedReason;
    if (reason) throw new Error(reason);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hxkey-"));
    try {
      fs.chmodSync(tmp, 0o700);
      const keyPath = path.join(tmp, "k");
      const r = spawnSync(
        this.keygenBin,
        ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", keyPath],
        { encoding: "utf8", timeout: 15000, windowsHide: true, env: this._childEnv() },
      );
      if (r.error?.code === "ENOENT")
        throw new Error(
          "ssh-keygen is not installed on this machine (install the OpenSSH client).",
        );
      if (r.status !== 0) throw new Error(`ssh-keygen failed: ${(r.stderr || "").trim()}`);
      return {
        privateKey: fs.readFileSync(keyPath, "utf8"),
        publicKey: fs.readFileSync(`${keyPath}.pub`, "utf8").trim(),
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Public key for a private key, or throw a helpful error if it is malformed / passphrase-protected. */
  derivePublicKey(privateKey) {
    const reason = this.unsupportedReason;
    if (reason) throw new Error(reason);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hxkey-"));
    try {
      fs.chmodSync(tmp, 0o700);
      const keyPath = path.join(tmp, "k");
      fs.writeFileSync(keyPath, `${String(privateKey).replace(/\r\n/g, "\n").trim()}\n`, {
        mode: 0o600,
      });
      const r = spawnSync(this.keygenBin, ["-y", "-P", "", "-f", keyPath], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        env: this._childEnv(),
      });
      if (r.error?.code === "ENOENT")
        throw new Error(
          "ssh-keygen is not installed on this machine (install the OpenSSH client).",
        );
      if (r.status !== 0) {
        const f = classifySshFailure(r.stderr);
        throw new Error(
          f.code === "bad_key" ? f.message : "The private key could not be read as an SSH key.",
        );
      }
      return r.stdout.trim();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  _run(bin, args, { input, timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(bin, args, {
          env: this._childEnv(),
          stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (err) {
        return resolve({ code: err.code || "ESPAWN", stdout: "", stderr: String(err.message) });
      }
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = (s, d) => (s.length > 262144 ? s : s + d);
      child.stdout.on("data", (d) => (stdout = cap(stdout, d)));
      child.stderr.on("data", (d) => (stderr = cap(stderr, d)));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: err.code || "ESPAWN", stdout, stderr: stderr || String(err.message) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
      if (input !== undefined) {
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      }
    });
  }

  /**
   * Run a remote command string. Only ever pass fixed text or values that have been shell-quoted: the
   * remote login shell interprets it.
   */
  async exec(target, command, { input, timeoutMs = 20000 } = {}) {
    const { alias, configPath } = this.prepare(target);
    const res = await this._run(this.sshBin, ["-F", configPath, "--", alias, command], {
      input,
      timeoutMs,
    });
    if (res.code === "ENOENT")
      return {
        ...res,
        failure: { code: "no_ssh_client", message: "The OpenSSH client (ssh) is not installed." },
      };
    if (res.code !== 0 && res.code !== null) {
      // ssh itself exits 255 for connection-level failures; anything else is the remote command's status.
      if (res.code === 255 || res.timedOut)
        return { ...res, failure: classifySshFailure(res.stderr, { timedOut: res.timedOut }) };
    } else if (res.timedOut) {
      return { ...res, failure: classifySshFailure("", { timedOut: true }) };
    }
    return res;
  }

  /** Connect, authenticate against the pinned key, and report what the machine has. */
  async probe(target, { timeoutMs = 25000 } = {}) {
    if (!target.hostKey)
      return {
        ok: false,
        code: "no_host_key",
        message: "Confirm the server's host key fingerprint before connecting.",
      };
    const started = Date.now();
    const res = await this.exec(target, "sh -s", { input: PROBE_SCRIPT, timeoutMs });
    const latencyMs = Date.now() - started;
    if (res.failure) return { ok: false, latencyMs, ...res.failure };
    if (res.code !== 0)
      return {
        ok: false,
        latencyMs,
        code: "remote_error",
        message: `The remote shell exited with status ${res.code}: ${(res.stderr || "").trim().slice(0, 200)}`,
      };
    const info = parseProbe(res.stdout);
    if (info.os && info.os !== "Linux")
      return {
        ok: false,
        latencyMs,
        code: "unsupported_os",
        message: `Only Linux servers are supported (this one reports ${info.os}).`,
        info,
      };
    if (info.docker !== "ok") {
      const msg = {
        missing: "Docker is not installed on the server. Run the bootstrap script there first.",
        denied: `The user "${info.user || target.username}" may not use Docker. Add it to the docker group (usermod -aG docker ${info.user || target.username}) and reconnect.`,
        down: "Docker is installed but its daemon is not running.",
      }[info.docker];
      return {
        ok: false,
        latencyMs,
        code: `docker_${info.docker}`,
        message: msg || "Docker could not be queried.",
        info,
      };
    }
    return { ok: true, latencyMs, info };
  }

  /** The env vars that make the Docker CLI talk to this server through the bridge. */
  dockerEnv(serverId) {
    const bridge = this.bridges.get(serverId);
    if (!bridge) throw new Error(`The connection to server ${serverId} is not open.`);
    return { DOCKER_HOST: `unix://${bridge.socketPath}` };
  }

  /** The running bridge for a server, or the one already being started, or a new one. */
  ensureBridge(target) {
    const running = this.bridges.get(target.id);
    if (running) return Promise.resolve(running);
    const pending = this.starting.get(target.id);
    if (pending) return pending;
    const p = this.startBridge(target).finally(() => this.starting.delete(target.id));
    this.starting.set(target.id, p);
    return p;
  }

  /**
   * (Re)start the bridge for a server: a worker process that listens on a unix socket and bridges every
   * connection to `docker system dial-stdio` over ssh (see ssh-bridge-worker.mjs for why it is a process).
   * Resolves once the socket is accepting connections.
   */
  async startBridge(target, { onExit } = {}) {
    await this.stopBridge(target.id);
    const { alias, configPath, dir } = this.prepare(target);
    const socketPath = path.join(dir, "d.sock");
    const bridge = {
      id: target.id,
      socketPath,
      configPath,
      alias,
      child: null,
      stats: { active: 0, total: 0, lastOkAt: null },
      lastFailure: null,
      stopping: false,
    };
    const child = fork(WORKER, [configPath, alias, socketPath, this.sshBin], {
      env: this._childEnv(),
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    bridge.child = child;
    let stderr = "";
    child.stderr.on("data", (d) => {
      if (stderr.length < 2048) stderr += d;
    });
    child.on("message", (m) => {
      if (m?.type === "stats")
        bridge.stats = { active: m.active, total: m.total, lastOkAt: m.lastOkAt };
      else if (m?.type === "failure") bridge.lastFailure = m.failure;
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the Docker bridge did not start in time")),
        8000,
      );
      child.once("message", function ready(m) {
        if (m?.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (m?.type === "fatal") {
          clearTimeout(timer);
          reject(new Error(m.message));
        } else child.once("message", ready);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`the Docker bridge exited (${code}): ${stderr.trim().slice(0, 200)}`));
      });
    }).catch((err) => {
      child.kill("SIGKILL");
      throw err;
    });
    this.bridges.set(target.id, bridge);
    child.on("exit", () => {
      if (this.bridges.get(target.id) === bridge) this.bridges.delete(target.id);
      if (!bridge.stopping) onExit?.(target.id);
    });
    return bridge;
  }

  bridgeStatus(serverId) {
    const b = this.bridges.get(serverId);
    if (!b) return null;
    return {
      socketPath: b.socketPath,
      activeConnections: b.stats.active,
      totalConnections: b.stats.total,
      lastFailure: b.lastFailure,
      lastOkAt: b.stats.lastOkAt,
    };
  }

  async stopBridge(serverId) {
    const b = this.bridges.get(serverId);
    if (!b) return;
    b.stopping = true;
    this.bridges.delete(serverId);
    await new Promise((resolve) => {
      if (b.child.exitCode !== null) return resolve();
      const timer = setTimeout(() => b.child.kill("SIGKILL"), 2000);
      b.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      b.child.kill("SIGTERM");
    });
    try {
      fs.rmSync(b.socketPath, { force: true });
    } catch {}
    await this.closeMaster(serverId, b.configPath, b.alias);
  }

  /** Ask a lingering ControlPersist master to exit so no ssh process outlives its server. */
  async closeMaster(serverId, configPath, alias) {
    try {
      const cfg = configPath || path.join(this.dirFor(serverId), "config");
      if (!fs.existsSync(cfg)) return;
      await this._run(this.sshBin, ["-F", cfg, "-O", "exit", "--", alias || `hx-${serverId}`], {
        timeoutMs: 5000,
      });
    } catch {}
  }

  async stopAll() {
    for (const id of [...this.bridges.keys()]) await this.stopBridge(id);
  }

  /** Remove everything stored for a server: bridge, control master, key, config and known_hosts. */
  async forget(serverId) {
    await this.stopBridge(serverId);
    await this.closeMaster(serverId);
    try {
      fs.rmSync(this.dirFor(serverId), { recursive: true, force: true });
    } catch {}
  }
}
