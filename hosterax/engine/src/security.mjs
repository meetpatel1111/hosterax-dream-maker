// hosterax/engine/src/security.mjs
// Shared security helpers: trusted-local detection, API token hashing, scope levels
// and strict validators for values that end up in shell commands or proxy configs.

import crypto from "node:crypto";

// ───────────── API tokens ─────────────
// Tokens are shown to the user once. Only the SHA-256 digest is persisted.

export function generateToken() {
  return "hxt_" + crypto.randomBytes(24).toString("hex");
}

export function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

export function tokenPrefix(token) {
  return String(token || "").slice(0, 8);
}

export function bearerFrom(req) {
  return String(req.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

// ───────────── Trusted local requests ─────────────
// A request is "local" only when the TCP peer is a loopback address AND it does not look like
// it was relayed (reverse proxy), re-bound (DNS rebinding) or sent by a foreign web page (CSRF).

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function stripPort(host) {
  const h = String(host || "").toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

function trustedOrigins(enginePort) {
  const list = new Set([
    `http://localhost:${enginePort}`,
    `http://127.0.0.1:${enginePort}`,
    `http://[::1]:${enginePort}`,
  ]);
  if (process.env.HOSTERAX_DEV === "1") {
    for (const p of [8080, 5173, 3000]) {
      list.add(`http://localhost:${p}`);
      list.add(`http://127.0.0.1:${p}`);
    }
  }
  for (const o of String(process.env.HOSTERAX_TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    list.add(o.replace(/\/$/, ""));
  }
  return list;
}

export function isTrustedLocalRequest(req, enginePort = Number(process.env.HOSTERAX_PORT || 7777)) {
  if (process.env.HOSTERAX_REQUIRE_AUTH === "1") return false;
  const ip = req.socket?.remoteAddress || "";
  if (!LOOPBACK_ADDRS.has(ip)) return false;
  const h = req.headers || {};
  // Anything relayed by a reverse proxy running on this host is remote traffic.
  if (h["x-forwarded-for"] || h["x-real-ip"] || h["x-forwarded-host"] || h.forwarded) return false;
  // DNS-rebinding guard: the Host header must name a loopback host.
  const host = stripPort(h.host);
  if (host && !LOOPBACK_HOSTS.has(host)) return false;
  // Drive-by guard: browsers always send Origin on cross-origin requests and WebSocket upgrades.
  // Only the dashboard served by this engine (or explicitly trusted dev origins) may use implicit trust.
  const trusted = trustedOrigins(enginePort);
  const origin = h.origin;
  if (origin !== undefined && !trusted.has(String(origin).replace(/\/$/, ""))) return false;
  // Fetch-metadata guard: a `no-cors` GET from another local port carries no Origin header but is
  // flagged `same-site`/`cross-site`. Only an explicitly trusted Origin may use implicit trust then.
  const site = h["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none" && origin === undefined) return false;
  return true;
}

// ───────────── Scope levels ─────────────

const SCOPE_RANK = {
  "*": 3,
  admin: 3,
  "project:admin": 3,
  deploy: 2,
  write: 2,
  "project:write": 2,
  read: 1,
  list: 1,
  "project:read": 1,
  "project:list": 1,
  "project:deployment:list": 1,
};

export function scopesLevel(scopes) {
  let level = 0;
  for (const s of scopes || []) level = Math.max(level, SCOPE_RANK[s] ?? 0);
  return level;
}

const ADMIN_ONLY = [
  /^\/api\/tokens(\/|$)/,
  /^\/api\/users(\/|$)/,
  /^\/api\/auth\/setup$/,
  /^\/api\/auth\/events$/,
  /^\/api\/servers(\/|$)/,
  /^\/api\/org(\/|$)/,
  /^\/api\/settings(\/|$)/,
  /^\/api\/edge\/settings$/,
  /^\/api\/email\/smtp-relays(\/|$)/,
  /^\/api\/backups\/s3-config$/,
  /^\/api\/docker\/system\/prune$/,
  /^\/api\/projects\/[^/]+\/chaos-test$/,
  /^\/api\/docker\/containers\/[^/]+\/exec$/,
  /^\/api\/ai\/config$/,
];
const SECRET_READS = [
  /\/env(\/|$)/,
  /\/download$/,
  /\/webhook(-config)?$/,
  /^\/api\/servers/,
  /^\/api\/tokens/,
];

/** Minimum scope level (1=read, 2=deploy, 3=admin) a token needs for this request. */
export function requiredLevel(method, pathname) {
  // MCP enforces a per-tool level itself (read-only tools work with read tokens).
  if (pathname === "/api/mcp" || pathname === "/mcp") return 1;
  // Signing out and managing your own password / two-factor must work for every role, viewers included.
  if (/^\/api\/auth\/(logout|password|2fa(\/|$))/.test(pathname)) return 1;
  if (ADMIN_ONLY.some((re) => re.test(pathname))) return 3;
  const m = String(method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
    return SECRET_READS.some((re) => re.test(pathname)) ? 2 : 1;
  }
  return 2;
}

// ───────────── Validators ─────────────

/** Docker image reference: [registry[:port]/]path[:tag][@sha256:digest]. No shell metacharacters. */
export function isSafeImageRef(ref) {
  const s = String(ref || "");
  if (!s || s.length > 255) return false;
  if (s.startsWith("-")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/.test(s) && !s.includes("..") && !s.includes("//");
}

export function assertSafeImageRef(ref) {
  if (!isSafeImageRef(ref))
    throw new Error(`Invalid Docker image reference: ${JSON.stringify(ref)}`);
  return String(ref);
}

/** RFC 1123 hostname (optionally with a leading `*.` wildcard). */
export function isSafeHostname(host) {
  const s = String(host || "").toLowerCase();
  if (!s || s.length > 253) return false;
  const body = s.startsWith("*.") ? s.slice(2) : s;
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
    body,
  );
}

export function assertSafeHostname(host) {
  if (!isSafeHostname(host)) throw new Error(`Invalid hostname: ${JSON.stringify(host)}`);
  return String(host).toLowerCase();
}

export function isSafeContainerName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(name || ""));
}

/** POSIX single-quote escaping for the rare case a value must be placed in a shell string. */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Salted scrypt hash for passwords: `scrypt$<salt>$<hash>`. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const s = String(stored || "");
  if (s.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = s.split("$");
    const expected = Buffer.from(hashHex || "", "hex");
    const actual = crypto.scryptSync(
      String(password),
      Buffer.from(saltHex || "", "hex"),
      expected.length || 32,
    );
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  // Legacy unsalted SHA-256 (hex)
  const legacy = crypto.createHash("sha256").update(String(password)).digest("hex");
  return legacy.length === s.length && crypto.timingSafeEqual(Buffer.from(legacy), Buffer.from(s));
}

export function isLegacyPasswordHash(stored) {
  return !String(stored || "").startsWith("scrypt$");
}

/** Splits a command string into argv honouring quotes — no expansion, no shell, no operators. */
export function splitArgs(input) {
  const out = [];
  let cur = "";
  let quote = null;
  let has = false;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1]))
        cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
    } else {
      cur += c;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
export function isValidEnvKey(key) {
  return ENV_KEY_RE.test(String(key));
}

/** Render argv for logs with `-e KEY=value` secrets masked. */
export function displayArgv(bin, args) {
  const shown = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((args[i - 1] === "-e" || args[i - 1] === "--env") && a.includes("=")) {
      shown.push(`${a.slice(0, a.indexOf("="))}=••••`);
    } else {
      shown.push(/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : shQuote(a));
    }
  }
  return [bin, ...shown].join(" ");
}
