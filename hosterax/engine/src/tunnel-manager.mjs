// hosterax/engine/src/tunnel-manager.mjs
// Public access for apps on a machine that has no public address of its own.
//
// A tunnel is a small program that makes an outbound connection to a relay and gets back a public
// URL that forwards to a local port: no router settings, no public IP, works behind CGNAT. This
// module runs those programs, reads the public URL out of their output, keeps them alive, and
// remembers which projects should be public across restarts.
//
// What a tunnel may point at is deliberately narrow: a deployed project's port, or the HosteraX edge
// proxy. The engine API and the dashboard are never reachable through one. Tokens (Cloudflare,
// ngrok) are stored encrypted, passed to the child through its environment rather than its command
// line, and never returned by the API. Children get a minimal environment, not the engine's.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { spawnSync } from "./safe-exec.mjs";
import { killTree } from "./process-tree.mjs";
import { splitArgs, isSafeHostname, isSafeImageRef } from "./security.mjs";
import { encryptJson, decryptJson } from "./secrets.mjs";

const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const MAX_LOG_LINES = 300;
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_RE = /https?:\/\/[^\s"'<>|)\]\\]+/gi;
const STABLE_MS = 120000;

/**
 * The programs the Docker fallback runs, pinned by version and digest so a compromised or broken
 * "latest" can never start on its own. Read from Docker Hub on 2026-10-24 (the multi-architecture
 * index digest of each tag). Set HOSTERAX_CLOUDFLARED_IMAGE, HOSTERAX_NGROK_IMAGE or
 * HOSTERAX_BORE_IMAGE to use another reference, for example to move to a newer release.
 */
export const IMAGES = {
  cloudflared:
    "cloudflare/cloudflared:2026.10.3@sha256:faa8e0a1475f137c910be6025f43c8e4092fdd35461b31e19fd1390657a1ff39",
  ngrok:
    "ngrok/ngrok:3.39.13-debian@sha256:ff3b5c3674432d14a786349908b7bdf28ee56c25662637afcbe7180d471993ef",
  bore: "ekzhang/bore:0.6.0@sha256:add9294ed874251ca1737f1d4e10a8681c3b885048888b3022cb327e4133c988",
};

/**
 * Providers tried, in this order, when a tunnel is created with provider "auto". localtunnel is left
 * out on purpose: it downloads and runs npm packages at start-up, which should be a choice, not a surprise.
 */
export const AUTO_ORDER = ["cloudflare", "localhost-run", "pinggy", "serveo"];

class NotReady extends Error {}

const hostPort = (host, port) => `${host.includes(":") ? `[${host}]` : host}:${port}`;

// ───────────── what is installed ─────────────

/** Finds an executable on PATH, or at HOSTERAX_<NAME>_PATH when someone keeps it somewhere else. */
export function findBinary(name, env = process.env) {
  const override = env[`HOSTERAX_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PATH`];
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (override && isFile(override)) return override;
  const dirs = String(env.PATH || env.Path || "")
    .split(path.delimiter)
    .filter(Boolean);
  // Only real executables: a .cmd shim cannot be started without a shell.
  const exts = process.platform === "win32" ? [".exe", ".com"] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!isFile(candidate)) continue;
      if (process.platform !== "win32") {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
        } catch {
          continue;
        }
      }
      return candidate;
    }
  }
  return null;
}

/** The npm "npx" entry point that belongs to the running Node, so no shell is needed to run it. */
export function findNpxCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function dockerReachable() {
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return r.status === 0 && Boolean(String(r.stdout || "").trim());
  } catch {
    return false;
  }
}

function makeTools(env) {
  let dockerAt = 0;
  let dockerOk = false;
  return {
    bin: (name) => findBinary(name, env),
    docker: () => {
      if (Date.now() - dockerAt > 30000) {
        dockerOk = dockerReachable();
        dockerAt = Date.now();
      }
      return dockerOk;
    },
    npx: () => findNpxCli(),
  };
}

// ───────────── providers ─────────────

const SSH_HINT = "an OpenSSH client (`ssh`, included with Windows 10+, macOS and Linux)";

/**
 * ssh options shared by the providers that are just `ssh -R`. Nothing from the user's own ssh setup
 * is used or offered to the relay: no config file, no keys, no agent, no password prompts.
 */
function sshBase(dirs) {
  return [
    "-T",
    "-F",
    dirs.sshConfig,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `IdentityFile="${dirs.noKey}"`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile="${dirs.knownHosts}"`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=15",
  ];
}

const sshRunner = (build) => ({
  type: "bin",
  bin: "ssh",
  need: SSH_HINT,
  args: (c) => [...sshBase(c.dirs), ...build(c)],
});

/** Public URLs (and only those) on the provider's own domains; everything else in the output is noise. */
function urlOnHosts(line, hosts, deny = []) {
  const clean = line.replace(ANSI_RE, "");
  for (const m of clean.matchAll(URL_RE)) {
    let u;
    try {
      u = new URL(m[0].replace(/[.,;:]+$/, ""));
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase();
    if (deny.includes(host)) continue;
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return `https://${u.host}`;
  }
  return null;
}

const hostDetect = (hosts, deny) => (line) => {
  const url = urlOnHosts(line, hosts, deny);
  return url ? { url } : null;
};

export const PROVIDERS = {
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Quick Tunnel",
    kind: "http",
    account: false,
    summary:
      "Free, no account. A random https://….trycloudflare.com address that changes whenever the tunnel restarts.",
    limits:
      "Cloudflare presents quick tunnels as a testing tool: no uptime promise, and a handful at once per machine.",
    options: [],
    runners: [
      {
        type: "bin",
        bin: "cloudflared",
        need: "cloudflared (winget install Cloudflare.cloudflared · brew install cloudflared · Cloudflare's .deb/.rpm)",
        args: (c) => ["tunnel", "--no-autoupdate", "--url", `http://${hostPort(c.host, c.port)}`],
      },
      {
        type: "docker",
        image: IMAGES.cloudflared,
        imageEnv: "HOSTERAX_CLOUDFLARED_IMAGE",
        args: (c, h) => ["tunnel", "--no-autoupdate", "--url", `http://${hostPort(h, c.port)}`],
      },
    ],
    detect: hostDetect(["trycloudflare.com"], ["api.trycloudflare.com"]),
  },
  "cloudflare-token": {
    id: "cloudflare-token",
    label: "Cloudflare Tunnel (your domain)",
    kind: "http",
    account: true,
    targetOnly: "edge",
    summary:
      "Free Cloudflare account and a domain on Cloudflare. A stable address on your own domain, with every app routed by hostname through the HosteraX edge.",
    limits:
      "In the Cloudflare dashboard (Zero Trust → Networks → Tunnels) create a tunnel, copy its token here, and point the public hostname at http://localhost:80.",
    options: [
      { key: "token", label: "Tunnel token", secret: true, required: true },
      { key: "hostname", label: "Public hostname (for display)", secret: false },
    ],
    runners: [
      {
        type: "bin",
        bin: "cloudflared",
        need: "cloudflared (winget install Cloudflare.cloudflared · brew install cloudflared)",
        args: () => ["tunnel", "--no-autoupdate", "run"],
        env: (c) => ({ TUNNEL_TOKEN: c.opts.token }),
      },
      {
        type: "docker",
        image: IMAGES.cloudflared,
        imageEnv: "HOSTERAX_CLOUDFLARED_IMAGE",
        args: () => ["tunnel", "--no-autoupdate", "run"],
        env: (c) => ({ TUNNEL_TOKEN: c.opts.token }),
      },
    ],
    detect: (line, opts) =>
      /registered tunnel connection/i.test(line)
        ? { url: opts.hostname ? `https://${opts.hostname}` : null }
        : null,
  },
  "localhost-run": {
    id: "localhost-run",
    label: "localhost.run",
    kind: "http",
    account: false,
    summary:
      "Free, no account, no software to install: it only needs ssh. A random https://….lhr.life address.",
    limits: "The address changes on every restart; a fixed one needs a paid plan.",
    options: [],
    runners: [sshRunner((c) => ["-R", `80:${hostPort(c.host, c.port)}`, "nokey@localhost.run"])],
    detect: hostDetect(["lhr.life", "localhost.run"], ["localhost.run", "admin.localhost.run"]),
  },
  pinggy: {
    id: "pinggy",
    label: "Pinggy",
    kind: "http",
    account: false,
    summary:
      "Free, no account, only needs ssh (over port 443, so it works on restrictive networks). A random https://….pinggy.link address.",
    limits:
      "Free tunnels last 60 minutes; HosteraX reconnects automatically, and the address changes each time.",
    options: [],
    runners: [sshRunner((c) => ["-p", "443", `-R0:${hostPort(c.host, c.port)}`, "a.pinggy.io"])],
    detect: hostDetect(["pinggy.link", "pinggy.online"]),
  },
  localtunnel: {
    id: "localtunnel",
    label: "localtunnel",
    kind: "http",
    account: false,
    summary:
      "Free, no account. Runs the open-source localtunnel client through npx. A random https://….loca.lt address.",
    limits:
      "Visitors first see a click-through reminder page, the public relay is often slow or down, and it downloads the client from npm each time it starts, so auto never picks it.",
    options: [],
    runners: [
      {
        type: "npx",
        pkg: "localtunnel@2.0.2",
        need: "Node.js with npm (for npx)",
        args: (c) => ["--port", String(c.port), "--local-host", c.host],
      },
    ],
    detect: hostDetect(["loca.lt"]),
  },
  serveo: {
    id: "serveo",
    label: "Serveo",
    kind: "http",
    account: false,
    summary: "Free, no account, only needs ssh. A random https address on serveousercontent.com.",
    limits: "A community service that is frequently unavailable. Keep it as a last resort.",
    options: [],
    runners: [sshRunner((c) => ["-R", `80:${hostPort(c.host, c.port)}`, "serveo.net"])],
    detect: hostDetect(["serveousercontent.com", "serveo.net"], ["serveo.net"]),
  },
  ngrok: {
    id: "ngrok",
    label: "ngrok",
    kind: "http",
    account: true,
    summary:
      "Free ngrok account. Includes one free static domain, so the address can stay the same. Visitors see an interstitial warning page once.",
    limits: "The free plan allows one agent online at a time and has monthly transfer limits.",
    options: [
      { key: "authtoken", label: "ngrok authtoken", secret: true, required: true },
      { key: "domain", label: "Static domain (optional)", secret: false },
    ],
    runners: [
      {
        type: "bin",
        bin: "ngrok",
        need: "ngrok (https://ngrok.com/download · brew install ngrok · winget install ngrok.ngrok)",
        args: (c) => ngrokArgs(c, c.host),
        env: (c) => ({ NGROK_AUTHTOKEN: c.opts.authtoken }),
      },
      {
        type: "docker",
        image: IMAGES.ngrok,
        imageEnv: "HOSTERAX_NGROK_IMAGE",
        args: (c, h) => ngrokArgs(c, h),
        env: (c) => ({ NGROK_AUTHTOKEN: c.opts.authtoken }),
      },
    ],
    detect: hostDetect(["ngrok-free.app", "ngrok-free.dev", "ngrok.app", "ngrok.io", "ngrok.dev"]),
  },
  tailscale: {
    id: "tailscale",
    label: "Tailscale Funnel",
    kind: "http",
    account: true,
    summary:
      "Free Tailscale account. Publishes the app on https://<machine>.<tailnet>.ts.net, open to anyone on the internet.",
    limits:
      "Tailscale must be installed and signed in, and Funnel enabled for this machine (the error shows the link if it is not). One public app per machine.",
    options: [],
    runners: [
      {
        type: "bin",
        bin: "tailscale",
        need: "Tailscale (https://tailscale.com/download) signed in on this machine",
        args: (c) => ["funnel", String(c.port)],
      },
    ],
    detect: hostDetect(["ts.net"]),
  },
  bore: {
    id: "bore",
    label: "bore (raw TCP)",
    kind: "tcp",
    account: false,
    summary:
      "Free, no account. Forwards a raw TCP port (game servers, databases, SSH), not web traffic: you get bore.pub:<port>.",
    limits:
      "No encryption or HTTPS from the relay; protect the service itself. Use --to for your own bore server.",
    options: [
      { key: "server", label: "Relay server (default bore.pub)", secret: false },
      { key: "secret", label: "Relay secret (if the server needs one)", secret: true },
    ],
    runners: [
      {
        type: "bin",
        bin: "bore",
        need: "bore (cargo install bore-cli · brew install bore-cli · release binaries on GitHub)",
        args: (c) => boreArgs(c, c.host),
        env: (c) => (c.opts.secret ? { BORE_SECRET: c.opts.secret } : {}),
      },
      {
        type: "docker",
        image: IMAGES.bore,
        imageEnv: "HOSTERAX_BORE_IMAGE",
        args: (c, h) => boreArgs(c, h),
        env: (c) => (c.opts.secret ? { BORE_SECRET: c.opts.secret } : {}),
      },
    ],
    detect: (line, opts) => {
      const m = /listening at ([A-Za-z0-9.-]+:\d+)/.exec(line.replace(ANSI_RE, ""));
      return m ? { url: `tcp://${m[1]}` } : null;
    },
  },
  custom: {
    id: "custom",
    label: "Custom command",
    kind: "http",
    account: false,
    custom: true,
    summary:
      "Any other tunnel program (zrok, frp, Loophole, Localtonet, playit.gg…): you give the command and a pattern that finds the public URL in its output.",
    limits:
      "Runs a command on this machine, so it is off unless HOSTERAX_ALLOW_CUSTOM_TUNNELS=1 is set where the engine runs. {host}, {port} and {target} are replaced; no shell is involved.",
    options: [
      {
        key: "command",
        label: "Command, e.g. zrok share public --headless {host}:{port}",
        required: true,
      },
      { key: "urlPattern", label: "Regex that matches the public URL", required: true },
    ],
    runners: [],
    detect: (line, opts) => {
      const m = new RegExp(opts.urlPattern, "i").exec(line.replace(ANSI_RE, ""));
      return m ? { url: m[1] || m[0] } : null;
    },
  },
};

function ngrokArgs(c, host) {
  const args = ["http", hostPort(host, c.port), "--log=stdout", "--log-format=json"];
  if (c.opts.domain) args.push("--url", `https://${c.opts.domain}`);
  return args;
}

function boreArgs(c, host) {
  return ["local", String(c.port), "--to", c.opts.server || "bore.pub", "--local-host", host];
}

// ───────────── manager ─────────────

export class TunnelManager {
  /**
   * @param resolveTarget (target) => { host, port } | { waiting: reason } | { missing: true }
   *   Turns "my-app" or "edge" into somewhere to forward to; throws if that must never be exposed.
   */
  constructor({
    db,
    HOME,
    resolveTarget,
    recordEvent = () => {},
    env = process.env,
    tools = makeTools(env),
    spawnImpl = spawn,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    autoTargets = () => [],
    autoProvider = () => "auto",
    tickMs = 5000,
    startTimeoutMs = 45000,
    retryBaseMs = 5000,
    retryMaxMs = 300000,
  }) {
    this.db = db;
    this.resolveTarget = resolveTarget;
    this.recordEvent = recordEvent;
    this.env = env;
    this.tools = tools;
    this.spawnImpl = spawnImpl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.autoTargets = autoTargets;
    this.autoProvider = autoProvider;
    this.tickMs = tickMs;
    this.startTimeoutMs = startTimeoutMs;
    this.retryBaseMs = retryBaseMs;
    this.retryMaxMs = retryMaxMs;
    this.allowCustom = env.HOSTERAX_ALLOW_CUSTOM_TUNNELS === "1";
    this.probeEnabled = env.HOSTERAX_TUNNEL_PROBE !== "0";
    this.timer = null;
    this.rt = new Map();

    const dir = path.join(HOME, "tunnels");
    fs.mkdirSync(dir, { recursive: true });
    this.dirs = {
      sshConfig: path.join(dir, "ssh_config"),
      knownHosts: path.join(dir, "known_hosts"),
      noKey: path.join(dir, "no-key"),
    };
    if (!fs.existsSync(this.dirs.sshConfig)) fs.writeFileSync(this.dirs.sshConfig, "");
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tunnels (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_used TEXT,
        via TEXT,
        options_enc TEXT,
        desired TEXT NOT NULL DEFAULT 'running',
        status TEXT NOT NULL DEFAULT 'starting',
        public_url TEXT,
        reachable INTEGER,
        check_status INTEGER,
        last_check_at INTEGER,
        last_error TEXT,
        restarts INTEGER NOT NULL DEFAULT 0,
        pid INTEGER,
        pid_cmd TEXT,
        started_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (target, provider)
      );
    `);
  }

  // ───────────── reading ─────────────

  /** What each provider needs and whether this machine can run it right now. */
  providers() {
    return Object.values(PROVIDERS).map((d) => {
      const r = this._readiness(d);
      return {
        id: d.id,
        label: d.label,
        kind: d.kind,
        needsAccount: d.account,
        summary: d.summary,
        limits: d.limits,
        targetOnly: d.targetOnly || null,
        options: d.options.map(({ key, label, secret, required }) => ({
          key,
          label,
          secret: Boolean(secret),
          required: Boolean(required),
        })),
        inAuto: AUTO_ORDER.includes(d.id),
        ready: r.ready,
        runsWith: r.via || null,
        missing: r.ready ? null : r.missing,
      };
    });
  }

  _readiness(def) {
    if (def.custom) {
      return this.allowCustom
        ? { ready: true, via: "your command" }
        : { ready: false, missing: "set HOSTERAX_ALLOW_CUSTOM_TUNNELS=1 where the engine runs" };
    }
    const needs = [];
    for (const r of def.runners) {
      const via = this._usable(r);
      if (via) return { ready: true, via };
      needs.push(r.type === "docker" ? "a running Docker" : r.need);
    }
    return { ready: false, missing: `needs ${[...new Set(needs)].join(", or ")}` };
  }

  _usable(runner) {
    if (runner.type === "bin") return this.tools.bin(runner.bin) ? runner.bin : null;
    if (runner.type === "docker") return this.tools.docker() ? "Docker" : null;
    if (runner.type === "npx") return this.tools.npx() ? "npx" : null;
    return null;
  }

  list() {
    return this.db
      .prepare("SELECT * FROM tunnels ORDER BY created_at ASC")
      .all()
      .map((r) => this._shape(r));
  }

  get(id) {
    const r = this._row(id);
    return r ? this._shape(r) : null;
  }

  logs(id) {
    if (!this._row(id)) return null;
    return [...this._rt(id).lines];
  }

  _row(id) {
    return this.db.prepare("SELECT * FROM tunnels WHERE id=?").get(id);
  }

  _rt(id) {
    let rt = this.rt.get(id);
    if (!rt) {
      rt = {
        child: null,
        busy: false,
        retryAt: 0,
        failures: 0,
        port: null,
        lines: [],
        attempts: [],
      };
      this.rt.set(id, rt);
    }
    return rt;
  }

  _options(row) {
    return row.options_enc ? decryptJson(row.options_enc, {}) : {};
  }

  _shape(r) {
    const def = PROVIDERS[r.provider];
    const opts = this._options(r);
    const secretKeys = new Set((def?.options || []).filter((o) => o.secret).map((o) => o.key));
    const rt = this.rt.get(r.id);
    return {
      id: r.id,
      target: r.target,
      provider: r.provider,
      providerUsed: r.provider_used,
      runsWith: r.via,
      kind: PROVIDERS[r.provider_used || r.provider]?.kind || "http",
      desired: r.desired,
      status: r.status,
      publicUrl: r.public_url,
      reachable: r.reachable === null || r.reachable === undefined ? null : Boolean(r.reachable),
      checkStatus: r.check_status,
      lastCheckAt: r.last_check_at,
      lastError: r.last_error,
      restarts: r.restarts,
      startedAt: r.started_at,
      createdAt: r.created_at,
      // secrets are write-only: only the fact that they are set is returned
      options: Object.fromEntries(Object.entries(opts).filter(([k]) => !secretKeys.has(k))),
      secretsSet: [...secretKeys].filter((k) => opts[k]),
      attempts: rt ? [...rt.attempts] : [],
    };
  }

  _set(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.db
      .prepare(
        `UPDATE tunnels SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=? WHERE id=?`,
      )
      .run(...keys.map((k) => patch[k]), this.now(), id);
  }

  // ───────────── managing ─────────────

  _validateOptions(def, input, previous = {}) {
    const known = new Set(def.options.map((o) => o.key));
    for (const key of Object.keys(input || {})) {
      if (!known.has(key)) throw new Error(`${def.label} has no option "${key}"`);
    }
    const out = { ...previous };
    for (const o of def.options) {
      if (input?.[o.key] === undefined) continue;
      const v = String(input[o.key] ?? "").trim();
      if (v.length > 2000) throw new Error(`${o.label} is too long`);
      if (v) out[o.key] = v;
      else delete out[o.key];
    }
    for (const o of def.options) {
      if (o.required && !out[o.key]) throw new Error(`${def.label} needs: ${o.label}`);
    }
    if (out.token && !/^[A-Za-z0-9_.=+/-]{20,}$/.test(out.token))
      throw new Error("the tunnel token does not look right (copy it again from Cloudflare)");
    if (out.authtoken && !/^[A-Za-z0-9_.-]{10,}$/.test(out.authtoken))
      throw new Error("the ngrok authtoken does not look right");
    for (const key of ["hostname", "domain"]) {
      if (out[key] && !isSafeHostname(out[key])) throw new Error(`${key} is not a valid hostname`);
    }
    if (out.server && !/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(out.server))
      throw new Error("server must be a host name, optionally with :port");
    if (def.custom) {
      if (!this.allowCustom)
        throw new Error(
          "custom tunnels are off: set HOSTERAX_ALLOW_CUSTOM_TUNNELS=1 where the engine runs",
        );
      if (!splitArgs(out.command).length) throw new Error("command is empty");
      if (out.urlPattern.length > 200) throw new Error("urlPattern is too long");
      try {
        new RegExp(out.urlPattern, "i");
      } catch (e) {
        throw new Error(`urlPattern is not a valid regular expression: ${e.message}`);
      }
    }
    return out;
  }

  /** Makes a target public, or updates and restarts the tunnel it already has. */
  create({ target, provider = "auto", options = {} }) {
    target = String(target || "").trim();
    if (target !== "edge" && !TARGET_RE.test(target))
      throw new Error('target must be a project name or "edge"');
    provider = String(provider || "auto");
    if (provider !== "auto" && !PROVIDERS[provider])
      throw new Error(`unknown provider "${provider}"`);
    const def = provider === "auto" ? null : PROVIDERS[provider];
    if (def?.targetOnly && def.targetOnly !== target)
      throw new Error(`${def.label} serves everything through the edge proxy: use target "edge"`);
    if (provider === "auto" && Object.keys(options || {}).length)
      throw new Error("options belong to a specific provider, not to auto");
    const t = this.resolveTarget(target);
    if (t.missing) throw new Error(`project "${target}" does not exist`);

    const existing = this.db
      .prepare("SELECT * FROM tunnels WHERE target=? AND provider=?")
      .get(target, provider);
    const opts = def
      ? this._validateOptions(def, options, existing ? this._options(existing) : {})
      : {};
    const options_enc = Object.keys(opts).length ? encryptJson(opts) : null;
    const now = this.now();
    let id;
    if (existing) {
      id = existing.id;
      this._set(id, { options_enc, desired: "running" });
      this._kill(this._rt(id));
    } else {
      id = crypto.randomBytes(5).toString("hex");
      this.db
        .prepare(
          `INSERT INTO tunnels (id, target, provider, options_enc, desired, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(id, target, provider, options_enc, "running", "starting", now, now);
    }
    this._rt(id).failures = 0;
    this._rt(id).retryAt = 0;
    this._run(id).catch(() => {});
    return this.get(id);
  }

  enable(id) {
    if (!this._row(id)) return null;
    const rt = this._rt(id);
    rt.failures = 0;
    rt.retryAt = 0;
    this._set(id, { desired: "running", status: "starting", last_error: null });
    this._run(id).catch(() => {});
    return this.get(id);
  }

  disable(id) {
    if (!this._row(id)) return null;
    this._set(id, { desired: "stopped", status: "stopped", public_url: null, reachable: null });
    this._kill(this._rt(id));
    return this.get(id);
  }

  restart(id) {
    if (!this._row(id)) return null;
    this._kill(this._rt(id));
    return this.enable(id);
  }

  remove(id) {
    const row = this._row(id);
    if (!row) return false;
    this._kill(this._rt(id));
    this.db.prepare("DELETE FROM tunnels WHERE id=?").run(id);
    this.rt.delete(id);
    this.recordEvent(
      row.target,
      "tunnel_removed",
      `public access (${row.provider}) removed`,
      "completed",
    );
    return true;
  }

  // ───────────── running ─────────────

  /** Resume what was public before the engine stopped, and keep reconciling. */
  start() {
    this._cleanupStale();
    this.db
      .prepare(
        "UPDATE tunnels SET status='stopped', public_url=NULL, reachable=NULL, pid=NULL WHERE desired='running'",
      )
      .run();
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.tickMs);
    this.timer.unref?.();
    this.tick().catch(() => {});
  }

  /** Stops the children without forgetting that they should be running (they resume on next start). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [id, rt] of this.rt) {
      this._kill(rt);
      this._set(id, { pid: null });
    }
  }

  /**
   * Gives every target the owner asked to have public automatically a tunnel of its own. A target that
   * already has any tunnel, even a stopped one, is left alone, so switching one off sticks.
   */
  _autoExpose() {
    let targets = [];
    try {
      targets = this.autoTargets();
    } catch {
      return;
    }
    for (const target of targets) {
      if (this.db.prepare("SELECT 1 FROM tunnels WHERE target=?").get(target)) continue;
      try {
        this.create({ target, provider: this.autoProvider() });
      } catch {}
    }
  }

  async tick() {
    this._autoExpose();
    const rows = this.db.prepare("SELECT * FROM tunnels WHERE desired='running'").all();
    for (const row of rows) {
      const rt = this._rt(row.id);
      if (rt.busy) continue;
      let t;
      try {
        t = this.resolveTarget(row.target);
      } catch (e) {
        t = { waiting: e.message };
      }
      if (t.missing) {
        this.remove(row.id);
        continue;
      }
      if (rt.child && row.status === "running") {
        if (t.port && rt.port && t.port !== rt.port) {
          // the project was redeployed on another port
          this._kill(rt);
          rt.retryAt = 0;
          this._set(row.id, { status: "restarting", public_url: null });
          this._run(row.id).catch(() => {});
        }
        continue;
      }
      if (this.now() >= rt.retryAt) this._run(row.id).catch(() => {});
    }
  }

  _backoff(failures) {
    return Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.max(0, failures - 1));
  }

  _plan(def, c) {
    if (def.custom) {
      const argv = splitArgs(c.opts.command).map((a) =>
        a
          .replaceAll("{host}", c.host)
          .replaceAll("{port}", String(c.port))
          .replaceAll("{target}", hostPort(c.host, c.port)),
      );
      if (!argv.length) throw new NotReady("the command is empty");
      return { cmd: argv[0], args: argv.slice(1), env: {}, via: "your command" };
    }
    const notes = [];
    for (const r of def.runners) {
      const via = this._usable(r);
      if (!via) {
        notes.push(r.type === "docker" ? "a running Docker" : r.need);
        continue;
      }
      const secrets = r.env ? r.env(c) : {};
      if (r.type === "bin") {
        return { cmd: this.tools.bin(r.bin), args: r.args(c), env: secrets, via: r.bin };
      }
      if (r.type === "npx") {
        return {
          cmd: process.execPath,
          args: [this.tools.npx(), "--yes", r.pkg, ...r.args(c)],
          env: { ...secrets, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
          via: "npx",
        };
      }
      // Docker: on Linux the container shares the host network so "localhost" is this machine; Docker
      // Desktop cannot do that and reaches the host as host.docker.internal.
      const image = String(this.env[r.imageEnv] || "").trim() || r.image;
      if (!isSafeImageRef(image))
        throw new NotReady(`${r.imageEnv} is not a valid image reference`);
      const linux = process.platform === "linux";
      const name = `hx_tunnel_${c.id}`;
      const dockerHost = linux ? c.host : "host.docker.internal";
      const args = [
        "run",
        "--rm",
        "--init",
        "--name",
        name,
        ...(linux ? ["--network", "host"] : ["--add-host", "host.docker.internal:host-gateway"]),
        ...Object.keys(secrets).flatMap((k) => ["-e", k]),
        image,
        ...r.args(c, dockerHost),
      ];
      return { cmd: "docker", args, env: secrets, via: "Docker", container: name };
    }
    throw new NotReady(`needs ${[...new Set(notes)].join(", or ")}`);
  }

  async _run(id) {
    const rt = this._rt(id);
    if (rt.busy) return;
    rt.busy = true;
    try {
      const row = this._row(id);
      if (!row || row.desired !== "running") return;
      let t;
      try {
        t = this.resolveTarget(row.target);
      } catch (e) {
        t = { waiting: e.message };
      }
      if (t.missing) {
        this.remove(id);
        return;
      }
      if (t.waiting) {
        this._set(id, { status: "waiting", last_error: t.waiting, public_url: null });
        rt.retryAt = this.now() + this.tickMs;
        return;
      }
      rt.port = t.port;
      rt.attempts = [];
      this._set(id, { status: "starting", last_error: null, public_url: null, reachable: null });

      const opts = this._options(row);
      const candidates = row.provider === "auto" ? AUTO_ORDER : [row.provider];
      for (const pid of candidates) {
        if (this._row(id)?.desired !== "running") return;
        const def = PROVIDERS[pid];
        let plan;
        try {
          plan = this._plan(def, { id, host: t.host, port: t.port, opts, dirs: this.dirs });
        } catch (e) {
          rt.attempts.push(`${def.label}: ${e.message}`);
          continue;
        }
        try {
          rt.lines.push(`── ${def.label} (${plan.via}) ──`);
          const hit = await this._spawnAndWait(id, def, plan, opts);
          if (this._row(id)?.desired !== "running") return;
          rt.startedAt = this.now();
          rt.attempts.push(`${def.label}: connected`);
          this._set(id, {
            status: "running",
            provider_used: def.id,
            via: plan.via,
            public_url: hit.url,
            started_at: rt.startedAt,
            last_error: null,
            reachable: null,
            check_status: null,
          });
          this.recordEvent(
            row.target,
            "tunnel_started",
            `${hit.url || def.label} is public through ${def.label}`,
            "completed",
          );
          if (hit.url && def.kind === "http") this._probe(id, hit.url, rt.child).catch(() => {});
          return;
        } catch (e) {
          rt.attempts.push(`${def.label}: ${e.message}`);
          this._kill(rt);
        }
      }
      if (this._row(id)?.desired !== "running") return;
      rt.failures += 1;
      rt.retryAt = this.now() + this._backoff(rt.failures);
      const summary = rt.attempts.join("\n");
      this._set(id, {
        status: "failed",
        last_error: this._redact(row, summary),
        restarts: row.restarts + 1,
        public_url: null,
      });
      this.recordEvent(row.target, "tunnel_failed", summary.split("\n")[0], "failed");
    } finally {
      rt.busy = false;
    }
  }

  _childEnv(extra) {
    const keep = [
      "PATH",
      "Path",
      "PATHEXT",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "SystemRoot",
      "SYSTEMROOT",
      "ComSpec",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "DOCKER_HOST",
      "DOCKER_CONFIG",
      "DOCKER_CONTEXT",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
      "all_proxy",
    ];
    const env = {};
    for (const k of keep) if (this.env[k] !== undefined) env[k] = this.env[k];
    return { ...env, ...extra };
  }

  _spawnAndWait(id, def, plan, opts) {
    const rt = this._rt(id);
    return new Promise((resolve, reject) => {
      let settled = false;
      let connected = false;
      let timer = null;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (fn === resolve) connected = true;
        fn(value);
      };
      let child;
      try {
        child = this.spawnImpl(plan.cmd, plan.args, {
          env: this._childEnv(plan.env),
          // keep stdin open: some relays end the session when it closes
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          detached: process.platform !== "win32",
        });
      } catch (e) {
        return reject(new Error(`could not start ${path.basename(plan.cmd)}: ${e.message}`));
      }
      rt.child = child;
      rt.container = plan.container || null;
      rt.cmdName = path.basename(plan.cmd);
      if (child.pid) this._set(id, { pid: child.pid, pid_cmd: rt.cmdName });
      child.stdin?.on("error", () => {});

      const row = this._row(id);
      const buffers = { out: "", err: "" };
      const feed = (key) => (chunk) => {
        buffers[key] += chunk.toString("utf8");
        let i;
        while ((i = buffers[key].indexOf("\n")) >= 0) {
          const line = buffers[key].slice(0, i).replace(/\r$/, "");
          buffers[key] = buffers[key].slice(i + 1);
          this._line(id, row, line);
          if (!settled) this._detect(def, line, opts, (hit) => settle(resolve, hit));
        }
        if (!settled && buffers[key])
          this._detect(def, buffers[key], opts, (hit) => settle(resolve, hit));
        if (buffers[key].length > 8192) buffers[key] = buffers[key].slice(-1024);
      };
      child.stdout?.on("data", feed("out"));
      child.stderr?.on("data", feed("err"));
      child.on("error", (e) =>
        settle(reject, new Error(`could not start ${path.basename(plan.cmd)}: ${e.message}`)),
      );
      const ended = (code, signal) => {
        const tail = rt.lines.slice(-3).join(" | ");
        settle(
          reject,
          new Error(
            `${path.basename(plan.cmd)} stopped (${code ?? signal}) before it gave a public address${tail ? `: ${tail}` : ""}`,
          ),
        );
      };
      // "close" comes after the output has been read, so an address printed just before exiting is seen
      child.on("close", ended);
      child.on("exit", (code, signal) => {
        if (settled) {
          if (!connected) return;
          this._onExit(id, child, code, signal);
          return;
        }
        // a grandchild holding the pipes open would delay "close"
        setTimeout(() => ended(code, signal), 1500).unref?.();
      });
      timer = setTimeout(
        () =>
          settle(
            reject,
            new Error(`no public address after ${Math.round(this.startTimeoutMs / 1000)}s`),
          ),
        this.startTimeoutMs,
      );
    });
  }

  _detect(def, text, opts, onHit) {
    let hit = null;
    try {
      hit = def.detect(text, opts);
    } catch {
      return;
    }
    if (hit) onHit(hit);
  }

  _line(id, row, line) {
    const rt = this._rt(id);
    rt.lines.push(this._redact(row, line));
    if (rt.lines.length > MAX_LOG_LINES) rt.lines.splice(0, rt.lines.length - MAX_LOG_LINES);
  }

  _redact(row, text) {
    let out = String(text);
    const def = PROVIDERS[row.provider];
    const opts = this._options(row);
    for (const o of def?.options || []) {
      const v = opts[o.key];
      if (o.secret && v && v.length >= 6) out = out.split(v).join("***");
    }
    return out;
  }

  _onExit(id, child, code, signal) {
    const rt = this._rt(id);
    if (rt.child !== child) return; // already replaced
    rt.child = null;
    this._set(id, { pid: null });
    const row = this._row(id);
    if (!row || row.desired !== "running") return;
    if (rt.startedAt && this.now() - rt.startedAt >= STABLE_MS) rt.failures = 0;
    rt.failures += 1;
    rt.retryAt = this.now() + this._backoff(rt.failures);
    this._set(id, {
      status: "restarting",
      public_url: null,
      reachable: null,
      last_error: `the tunnel stopped (${code ?? signal}); reconnecting`,
      restarts: row.restarts + 1,
    });
    this.recordEvent(
      row.target,
      "tunnel_failed",
      `tunnel stopped (${code ?? signal}); reconnecting`,
      "failed",
    );
  }

  _kill(rt) {
    const child = rt.child;
    rt.child = null;
    if (rt.container) {
      execFile("docker", ["rm", "-f", rt.container], { timeout: 8000 }, () => {});
      rt.container = null;
    }
    if (!child || child.exitCode !== null || child.killed) return;
    killTree(child.pid, child);
  }

  /** Checks, from this machine, that the public address answers; informational only. */
  async _probe(id, url, child) {
    if (!this.probeEnabled || typeof this.fetchImpl !== "function") return;
    let last = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (this._rt(id).child !== child) return;
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        // any answer means the relay is forwarding; a 5xx usually means the app itself is not up
        this._set(id, { reachable: 1, check_status: res.status, last_check_at: this.now() });
        return;
      } catch (e) {
        last = e;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (this._rt(id).child === child)
      this._set(id, {
        reachable: 0,
        check_status: null,
        last_check_at: this.now(),
        last_error: `the public address did not answer from this machine (${last?.cause?.code || last?.message || "no answer"})`,
      });
  }

  /** Whatever a previous engine process left behind is stopped before anything new starts. */
  _cleanupStale() {
    const rows = this.db
      .prepare("SELECT id, pid, pid_cmd FROM tunnels WHERE pid IS NOT NULL")
      .all();
    for (const r of rows) {
      try {
        if (processNameOf(r.pid) === r.pid_cmd) killTree(r.pid);
      } catch {}
    }
    this.db.prepare("UPDATE tunnels SET pid=NULL, pid_cmd=NULL").run();
    execFile(
      "docker",
      ["ps", "-aq", "--filter", "name=hx_tunnel_"],
      { timeout: 8000 },
      (err, stdout) => {
        const ids = String(stdout || "")
          .split(/\s+/)
          .filter((s) => /^[0-9a-f]{6,64}$/.test(s));
        if (!err && ids.length)
          execFile("docker", ["rm", "-f", ...ids], { timeout: 15000 }, () => {});
      },
    );
  }
}

// ───────────── processes ─────────────

function processNameOf(pid) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      const m = /^"([^"]+)"/.exec(out.trim());
      return m ? m[1] : null;
    }
    const out = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      timeout: 5000,
    });
    return path.basename(out.trim()) || null;
  } catch {
    return null;
  }
}

// ───────────── where the apps are, from the tunnel's point of view ─────────────

/** The default gateway from a Linux routing table, e.g. 172.17.0.1 for a container on Docker's bridge. */
export function defaultGateway(routeTable) {
  for (const line of String(routeTable).split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] !== "00000000" || !/^[0-9A-Fa-f]{8}$/.test(f[2] || "") || f[2] === "00000000")
      continue;
    // the address is stored as little-endian hex
    return f[2]
      .match(/../g)
      .reverse()
      .map((h) => parseInt(h, 16))
      .join(".");
  }
  return null;
}

/**
 * Where a tunnel should send traffic for an app published on this machine. Normally that is the
 * machine itself; when the engine runs inside a container (the official Docker image) the apps are
 * published on the Docker host, so "127.0.0.1" would be the engine's own container. HOSTERAX_TUNNEL_HOST
 * overrides all of this.
 */
export function tunnelTargetHost({
  bindHost = "0.0.0.0",
  env = process.env,
  exists = fs.existsSync,
  read = (p) => fs.readFileSync(p, "utf8"),
} = {}) {
  const override = String(env.HOSTERAX_TUNNEL_HOST || "").trim();
  if (override) {
    if (!IPV4.test(override) && !isSafeHostname(override))
      throw new Error("HOSTERAX_TUNNEL_HOST must be an IPv4 address or a host name");
    return override;
  }
  const local = bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
  let containerized = false;
  try {
    containerized = exists("/.dockerenv") || exists("/run/.containerenv");
  } catch {}
  if (!containerized) return local;
  try {
    return defaultGateway(read("/proc/net/route")) || local;
  } catch {
    return local;
  }
}

// ───────────── this machine's public address ─────────────

const IP_SOURCES = ["https://api.ipify.org", "https://icanhazip.com", "https://ifconfig.me/ip"];
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{3,45}$/;

export function isPrivateAddress(ip) {
  if (!IPV4.test(ip)) return /^(::1|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}

/**
 * Asks a few public "what is my IP" services (one at a time) what address this machine appears as.
 * HOSTERAX_IP_LOOKUP_URLS (comma-separated) replaces the built-in list, e.g. with your own service.
 */
export async function detectPublicIp({
  fetchImpl = globalThis.fetch,
  env = process.env,
  sources = String(env.HOSTERAX_IP_LOOKUP_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s)),
} = {}) {
  if (!sources.length) sources = IP_SOURCES;
  for (const source of sources) {
    try {
      const res = await fetchImpl(source, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const ip = String(await res.text()).trim();
      if (IPV4.test(ip) || (IPV6.test(ip) && ip.includes(":"))) return { ip, source };
    } catch {}
  }
  return null;
}
