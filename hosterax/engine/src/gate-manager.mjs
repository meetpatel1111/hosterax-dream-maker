// hosterax/engine/src/gate-manager.mjs
// A password in front of an app.
//
// Turning the gate on for a project starts a small listener that sits between the outside world (the
// edge proxy, a public tunnel, or a browser) and the app. Visitors see a password page; once they pass
// they get a signed cookie and everything is proxied to the app, WebSockets included. Routes and tunnels
// point at the gate instead of the app, so protecting an app does not depend on which edge is in use.
//
// The password is stored as PBKDF2-SHA256 (never the password itself); the session cookie is an
// HMAC-signed, expiring token tied to a per-project secret, so changing the password signs everyone out.
// Failed attempts are rate limited per visitor.

import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { encryptSecret, decryptSecret } from "./secrets.mjs";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_PATH = "/__hx_gate/login";
const LOGOUT_PATH = "/__hx_gate/logout";
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha8 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

function pbkdf2(password, salt, iterations) {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(password, salt, iterations, 32, "sha256", (e, k) => (e ? reject(e) : resolve(k))),
  );
}

const isLocalPeer = (addr = "") =>
  /^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/.test(
    addr,
  );

const PAGE = (error, next) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Password required</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#14171c;--muted:#5d6672;--line:#d6dbe1;--accent:#2b6cb0;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--fg:#e8ebef;--muted:#9aa4b0;--line:#2a313a;--accent:#7cb4f2;--err:#ff8a80}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(92vw,22rem);padding:1.5rem}
h1{font-size:1.2rem;margin:0 0 .25rem}p{margin:0 0 1rem;color:var(--muted);font-size:.9rem}
input,button{width:100%;box-sizing:border-box;font:inherit;padding:.65rem .75rem;border-radius:.4rem;border:1px solid var(--line);background:transparent;color:var(--fg)}
button{margin-top:.75rem;background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600;cursor:pointer}
.err{color:var(--err);margin:.5rem 0 0;font-size:.9rem}
</style></head><body><main>
<h1>This app is protected</h1><p>Enter the password to continue.</p>
<form method="post" action="${LOGIN_PATH}">
<input type="hidden" name="next" value="${next.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c])}">
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="Password">
<button type="submit">Continue</button>
${error ? `<p class="err" role="alert">${error}</p>` : ""}
</form></main></body></html>`;

export class GateManager {
  /**
   * @param {{ db: any, bindHost?: string, iterations?: number, upstream: (project: string) => number | null,
   *   onPortChange?: (project: string, port: number | null) => void, now?: () => number }} opts
   */
  constructor({
    db,
    bindHost = "127.0.0.1",
    iterations,
    upstream,
    onPortChange,
    now = () => Date.now(),
  }) {
    this.db = db;
    this.bindHost = bindHost;
    this.iterations = iterations || Number(process.env.HOSTERAX_GATE_ITERATIONS) || 600000;
    this.upstream = upstream;
    this.onPortChange = onPortChange || (() => {});
    this.now = now;
    this.listeners = new Map(); // project -> http.Server
    this.failures = new Map();
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_gates (
        project TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        session_secret TEXT NOT NULL,
        port INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────

  isEnabled(project) {
    return Boolean(this.db.prepare("SELECT 1 FROM project_gates WHERE project=?").get(project));
  }

  /** The port that traffic for a gated project must be sent to, or null when it is not gated. */
  portFor(project) {
    return (
      this.db.prepare("SELECT port FROM project_gates WHERE project=?").get(project)?.port ?? null
    );
  }

  status(project) {
    const r = this.db
      .prepare("SELECT port, updated_at FROM project_gates WHERE project=?")
      .get(project);
    return r ? { enabled: true, port: r.port, updatedAt: r.updated_at } : { enabled: false };
  }

  // ── password ─────────────────────────────────────────────────────────────────────────────────

  /** Turn the gate on (or change its password). Resolves with the port the gate listens on. */
  async enable(project, password) {
    if (typeof password !== "string" || password.length < 8)
      throw new Error("The password must be at least 8 characters.");
    if (password.length > 200)
      throw new Error("The password is too long (200 characters at most).");
    const salt = crypto.randomBytes(16);
    const hash = await pbkdf2(password, salt, this.iterations);
    const secret = crypto.randomBytes(32);
    const now = this.now();
    const prev = this.db.prepare("SELECT port FROM project_gates WHERE project=?").get(project);
    this.db
      .prepare(
        `INSERT INTO project_gates (project, salt, hash, iterations, session_secret, port, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(project) DO UPDATE SET salt=excluded.salt, hash=excluded.hash, iterations=excluded.iterations,
           session_secret=excluded.session_secret, updated_at=excluded.updated_at`,
      )
      .run(
        project,
        salt.toString("hex"),
        hash.toString("hex"),
        this.iterations,
        encryptSecret(secret.toString("hex")),
        prev?.port ?? null,
        now,
        now,
      );
    // a new password signs everyone out: the old listener keeps running but now checks the new secret
    return this._listen(project);
  }

  async disable(project) {
    await this._close(project);
    this.db.prepare("DELETE FROM project_gates WHERE project=?").run(project);
    this.onPortChange(project, null);
  }

  async _verify(project, password) {
    const r = this.db.prepare("SELECT * FROM project_gates WHERE project=?").get(project);
    if (!r) return false;
    const expect = Buffer.from(r.hash, "hex");
    const got = await pbkdf2(String(password), Buffer.from(r.salt, "hex"), r.iterations);
    return got.length === expect.length && crypto.timingSafeEqual(got, expect);
  }

  // ── sessions ─────────────────────────────────────────────────────────────────────────────────

  _secret(project) {
    const r = this.db
      .prepare("SELECT session_secret FROM project_gates WHERE project=?")
      .get(project);
    return r ? Buffer.from(decryptSecret(r.session_secret), "hex") : null;
  }

  _cookieName(project) {
    return `hx_gate_${sha8(project)}`;
  }

  _issue(project) {
    const payload = b64u(
      JSON.stringify({
        p: project,
        exp: this.now() + SESSION_TTL_MS,
        n: crypto.randomBytes(6).toString("hex"),
      }),
    );
    const sig = crypto
      .createHmac("sha256", this._secret(project))
      .update(payload)
      .digest("base64url");
    return `${payload}.${sig}`;
  }

  _valid(project, token) {
    const secret = this._secret(project);
    if (!secret || typeof token !== "string") return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const want = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    try {
      const p = JSON.parse(Buffer.from(payload, "base64url").toString());
      return p.p === project && p.exp > this.now();
    } catch {
      return false;
    }
  }

  _cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  _authed(project, req) {
    return this._valid(project, this._cookies(req)[this._cookieName(project)]);
  }

  // ── rate limiting ────────────────────────────────────────────────────────────────────────────

  _visitor(req) {
    const peer = req.socket.remoteAddress || "";
    const fwd = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    // only believe X-Forwarded-For from our own edge / a local tunnel, never from a stranger
    return isLocalPeer(peer) && fwd ? fwd : peer;
  }

  _blocked(project, visitor) {
    const f = this.failures.get(`${project}|${visitor}`);
    if (!f) return 0;
    if (this.now() - f.first > FAILURE_WINDOW_MS) {
      this.failures.delete(`${project}|${visitor}`);
      return 0;
    }
    return f.count >= MAX_FAILURES
      ? Math.ceil((FAILURE_WINDOW_MS - (this.now() - f.first)) / 1000)
      : 0;
  }

  _fail(project, visitor) {
    const key = `${project}|${visitor}`;
    const f = this.failures.get(key);
    if (!f || this.now() - f.first > FAILURE_WINDOW_MS)
      this.failures.set(key, { count: 1, first: this.now() });
    else f.count += 1;
    if (this.failures.size > 5000) this.failures.delete(this.failures.keys().next().value);
  }

  // ── the listener ─────────────────────────────────────────────────────────────────────────────

  async start() {
    for (const r of this.db.prepare("SELECT project FROM project_gates").all())
      await this._listen(r.project).catch(() => {});
  }

  async stop() {
    for (const p of [...this.listeners.keys()]) await this._close(p);
  }

  async _close(project) {
    const s = this.listeners.get(project);
    if (!s) return;
    this.listeners.delete(project);
    s.closeAllConnections?.();
    await new Promise((r) => s.close(() => r()));
  }

  async _listen(project) {
    if (this.listeners.has(project)) return this.portFor(project);
    const row = this.db.prepare("SELECT port FROM project_gates WHERE project=?").get(project);
    const server = http.createServer((req, res) =>
      this._handle(project, req, res).catch(() => this._end(res, 500, "Gate error")),
    );
    server.on("upgrade", (req, socket, head) => this._upgrade(project, req, socket, head));
    const listen = (port) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, this.bindHost, () => {
          server.off("error", reject);
          resolve(server.address().port);
        });
      });
    let port;
    try {
      port = await listen(row?.port || 0);
    } catch {
      port = await listen(0); // the old port is taken: move, and tell whoever routes to it
    }
    this.listeners.set(project, server);
    if (port !== row?.port) {
      this.db.prepare("UPDATE project_gates SET port=? WHERE project=?").run(port, project);
      this.onPortChange(project, port);
    } else if (!row?.port) this.onPortChange(project, port);
    return port;
  }

  _end(res, status, text, headers = {}) {
    if (res.headersSent) return res.end();
    res.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    });
    res.end(text);
  }

  async _handle(project, req, res) {
    const url = new URL(req.url, "http://gate");
    if (url.pathname === LOGOUT_PATH) {
      res.writeHead(303, {
        "set-cookie": `${this._cookieName(project)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        location: "/",
        "cache-control": "no-store",
      });
      return res.end();
    }
    if (url.pathname === LOGIN_PATH && req.method === "POST") return this._login(project, req, res);
    if (this._authed(project, req)) return this._proxy(project, req, res);

    const wantsPage =
      req.method === "GET" && String(req.headers.accept || "").includes("text/html");
    if (wantsPage) {
      res.writeHead(401, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex",
      });
      return res.end(PAGE("", url.pathname + url.search));
    }
    return this._end(res, 401, "Password required", { "www-authenticate": 'Cookie realm="gate"' });
  }

  async _login(project, req, res) {
    const visitor = this._visitor(req);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return this._end(res, 413, "Too large");
    }
    const form = new URLSearchParams(body);
    // only ever return the visitor to a path on this same site
    let next = form.get("next") || "/";
    if (
      !next.startsWith("/") ||
      next.startsWith("//") ||
      next.startsWith("/\\") ||
      /[\r\n]/.test(next)
    )
      next = "/";

    const wait = this._blocked(project, visitor);
    if (wait) {
      res.writeHead(429, {
        "content-type": "text/html; charset=utf-8",
        "retry-after": String(wait),
        "cache-control": "no-store",
      });
      return res.end(
        PAGE(`Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, next),
      );
    }
    if (await this._verify(project, form.get("password") || "")) {
      this.failures.delete(`${project}|${visitor}`);
      const secure =
        String(req.headers["x-forwarded-proto"] || "")
          .split(",")[0]
          .trim() === "https";
      res.writeHead(303, {
        "set-cookie": `${this._cookieName(project)}=${this._issue(project)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`,
        location: next,
        "cache-control": "no-store",
      });
      return res.end();
    }
    this._fail(project, visitor);
    res.writeHead(401, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
    });
    res.end(PAGE("That password is not right.", next));
  }

  /** The request the app should see: no hop-by-hop headers, and never our own session cookie. */
  _forwardHeaders(project, req) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .filter((c) => !c.trim().startsWith(`${this._cookieName(project)}=`))
      .join(";")
      .trim();
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
    const peer = req.socket.remoteAddress || "";
    headers["x-forwarded-for"] = [req.headers["x-forwarded-for"], peer].filter(Boolean).join(", ");
    headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";
    headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
    return headers;
  }

  _proxy(project, req, res) {
    const port = this.upstream(project);
    if (!port) return this._end(res, 502, "The app has no address yet.");
    const up = http.request(
      {
        host: "127.0.0.1",
        port,
        method: req.method,
        path: req.url,
        headers: this._forwardHeaders(project, req),
      },
      (ur) => {
        const headers = {
          ...ur.headers,
          "cache-control": ur.headers["cache-control"] ?? "private",
        };
        res.writeHead(ur.statusCode, ur.statusMessage, headers);
        ur.pipe(res);
      },
    );
    up.on("error", () => this._end(res, 502, "The app is not answering."));
    res.on("close", () => up.destroy());
    req.pipe(up);
  }

  _upgrade(project, req, socket, head) {
    socket.on("error", () => {});
    if (!this._authed(project, req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    const port = this.upstream(project);
    if (!port)
      return socket.end(
        "HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
      );
    const up = net.connect(port, "127.0.0.1", () => {
      const headers = this._forwardHeaders(project, req);
      headers.connection = "Upgrade";
      headers.upgrade = req.headers.upgrade;
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers))
        for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`;
      up.write(`${raw}\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("close", () => up.destroy());
  }
}
