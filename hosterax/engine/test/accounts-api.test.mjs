import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { totp } from "../src/totp.mjs";

const engineDir = dirname(dirname(fileURLToPath(import.meta.url)));
const homes = [];
const engines = [];

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function startEngine(extraEnv = {}, port = null) {
  const home = mkdtempSync(join(tmpdir(), "hosterax-acct-"));
  homes.push(home);
  port ??= await freePort();
  const child = spawn(process.execPath, ["src/index.mjs"], {
    cwd: engineDir,
    env: { ...process.env, HOSTERAX_PORT: String(port), HOSTERAX_HOME: home, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`engine did not start: ${output.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const engine = {
    base,
    port,
    bootstrap: /hxt_[0-9a-f]{48}/.exec(output)?.[0] ?? "",
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
        setTimeout(resolve, 3000);
      }),
  };
  engines.push(engine);
  return engine;
}

// `remote: true` adds a proxy header, so the engine cannot mistake the caller for the local machine
const call = async (engine, token, method, path, body, { remote = true } = {}) => {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (remote) headers["x-forwarded-for"] = "203.0.113.7";
  const r = await fetch(`${engine.base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: r.status, data, text, headers: r.headers };
};

after(async () => {
  for (const e of engines) await e.stop();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const PW = "a-long-enough-password";

// ───────────────────────── accounts over HTTP ─────────────────────────

let engine;
let owner; // session token
const sessions = {};

before(async () => {
  engine = await startEngine();
});

test("first-run setup needs an admin credential and works once", async () => {
  const providers = await call(engine, null, "GET", "/api/auth/providers");
  assert.equal(providers.status, 200);
  assert.deepEqual(providers.data, { setupRequired: true, password: false, sso: null });

  const anon = await call(engine, null, "POST", "/api/auth/setup", {
    email: "o@example.com",
    password: PW,
  });
  assert.equal(
    anon.status,
    401,
    "an anonymous remote caller must not be able to claim the instance",
  );

  const weak = await call(engine, engine.bootstrap, "POST", "/api/auth/setup", {
    email: "o@example.com",
    password: "short",
  });
  assert.equal(weak.status, 400);

  const ok = await call(engine, engine.bootstrap, "POST", "/api/auth/setup", {
    email: "Owner@Example.com",
    name: "Olive",
    password: PW,
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.data.user.role, "owner");
  assert.match(ok.data.token, /^hxs_/);
  owner = ok.data.token;

  const again = await call(engine, engine.bootstrap, "POST", "/api/auth/setup", {
    email: "x@example.com",
    password: PW,
  });
  assert.equal(again.status, 409);
  assert.equal((await call(engine, null, "GET", "/api/auth/providers")).data.setupRequired, false);
});

test("first-run setup cannot be claimed with a token that is not an admin", async () => {
  const fresh = await startEngine();
  const minted = async (scope) =>
    (await call(fresh, fresh.bootstrap, "POST", "/api/tokens", { name: scope, scopes: [scope] }))
      .data.token;
  for (const scope of ["read", "deploy"]) {
    const token = await minted(scope);
    const r = await call(fresh, token, "POST", "/api/auth/setup", {
      email: "evil@example.com",
      password: PW,
    });
    assert.equal(r.status, 403, `a ${scope} token must not be able to create the owner account`);
  }
  assert.equal((await call(fresh, null, "GET", "/api/auth/providers")).data.setupRequired, true);
  const ok = await call(fresh, fresh.bootstrap, "POST", "/api/auth/setup", {
    email: "real@example.com",
    password: PW,
  });
  assert.equal(ok.status, 201);
});

test("sign-in, whoami and sign-out", async () => {
  const bad = await call(engine, null, "POST", "/api/auth/login", {
    email: "owner@example.com",
    password: "wrong-password",
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, "invalid email or password");
  const ghost = await call(engine, null, "POST", "/api/auth/login", {
    email: "ghost@example.com",
    password: "wrong-password",
  });
  assert.equal(ghost.data.error, bad.data.error, "unknown emails look the same as wrong passwords");

  const login = await call(engine, null, "POST", "/api/auth/login", {
    email: "OWNER@example.com",
    password: PW,
  });
  assert.equal(login.status, 200);
  const me = await call(engine, login.data.token, "GET", "/api/auth/me");
  assert.equal(me.data.user.email, "owner@example.com");
  assert.equal(me.data.role, "admin");
  assert.deepEqual(me.data.scopes, ["*"]);
  assert.equal(me.data.tokenName, null);

  assert.equal((await call(engine, login.data.token, "POST", "/api/auth/logout")).status, 200);
  assert.equal(
    (await call(engine, login.data.token, "GET", "/api/auth/me")).status,
    401,
    "a signed-out token is dead",
  );
});

test("roles are enforced on real routes", async () => {
  const mk = async (email, role) => {
    const r = await call(engine, owner, "POST", "/api/users", {
      email,
      name: role,
      role,
      password: PW,
    });
    assert.equal(r.status, 201, r.text);
    const l = await call(engine, null, "POST", "/api/auth/login", { email, password: PW });
    sessions[role] = l.data.token;
    return r.data;
  };
  await mk("viewer@example.com", "viewer");
  await mk("dev@example.com", "developer");
  await mk("admin@example.com", "admin");

  const project = (name) => ({ name, source: "x", target: "docker" });
  // viewer: read only
  assert.equal((await call(engine, sessions.viewer, "GET", "/api/projects")).status, 200);
  assert.equal(
    (await call(engine, sessions.viewer, "POST", "/api/projects", project("v1"))).status,
    403,
  );
  assert.equal((await call(engine, sessions.viewer, "GET", "/api/users")).status, 403);
  assert.equal((await call(engine, sessions.viewer, "GET", "/api/tokens")).status, 403);
  // developer: can deploy, cannot administer
  assert.ok(
    (await call(engine, sessions.developer, "POST", "/api/projects", project("d1"))).status < 300,
  );
  assert.equal((await call(engine, sessions.developer, "GET", "/api/users")).status, 403);
  assert.equal(
    (await call(engine, sessions.developer, "POST", "/api/tokens", { name: "t" })).status,
    403,
  );
  // admin: manages developers and viewers, but not owners or other admins
  assert.equal((await call(engine, sessions.admin, "GET", "/api/users")).status, 200);
  const made = await call(engine, sessions.admin, "POST", "/api/users", {
    email: "d2@example.com",
    role: "developer",
    password: PW,
  });
  assert.equal(made.status, 201);
  assert.equal(
    (
      await call(engine, sessions.admin, "POST", "/api/users", {
        email: "a2@example.com",
        role: "admin",
        password: PW,
      })
    ).status,
    403,
  );
  const users = (await call(engine, owner, "GET", "/api/users")).data;
  const ownerRow = users.find((u) => u.role === "owner");
  assert.equal(
    (await call(engine, sessions.admin, "DELETE", `/api/users/${ownerRow.id}`)).status,
    403,
  );
  assert.equal(
    (await call(engine, owner, "DELETE", `/api/users/${ownerRow.id}`)).status,
    409,
    "the only owner cannot be deleted",
  );

  // everyone can sign out and manage their own password, viewers included
  assert.equal(
    (
      await call(engine, sessions.viewer, "POST", "/api/auth/password", {
        current: PW,
        next: "another-long-password",
      })
    ).status,
    200,
  );
  const relog = await call(engine, null, "POST", "/api/auth/login", {
    email: "viewer@example.com",
    password: "another-long-password",
  });
  assert.equal(relog.status, 200);
  sessions.viewer = relog.data.token;
});

test("a session works as a bearer token for MCP, and its role limits the tools", async () => {
  const rpc = (token, name, args) =>
    call(engine, token, "POST", "/api/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
  const list = await rpc(sessions.viewer, "list_projects", {});
  assert.equal(list.status, 200);
  assert.ok(!list.data.error && !list.data.result?.isError, list.text);
  const write = await rpc(sessions.viewer, "create_project", { name: "via-mcp", source: "x" });
  assert.ok(
    write.data.error || write.data.result?.isError,
    "a viewer must not be able to create a project through MCP",
  );
  const allowed = await rpc(sessions.developer, "create_project", {
    name: "via-mcp-dev",
    source: "x",
  });
  assert.ok(!allowed.data.error && !allowed.data.result?.isError, allowed.text);
});

test("role changes, disabling and deleting take effect on live sessions", async () => {
  const users = (await call(engine, owner, "GET", "/api/users")).data;
  const dev = users.find((u) => u.email === "dev@example.com");
  const project = { name: "live-check", source: "x", target: "docker" };

  assert.ok(
    (await call(engine, sessions.developer, "POST", "/api/projects", project)).status < 300,
  );
  assert.equal(
    (await call(engine, owner, "PATCH", `/api/users/${dev.id}`, { role: "viewer" })).status,
    200,
  );
  assert.equal(
    (
      await call(engine, sessions.developer, "POST", "/api/projects", {
        ...project,
        name: "live-check-2",
      })
    ).status,
    403,
    "demotion applies to the session that already exists",
  );
  assert.equal(
    (await call(engine, owner, "PATCH", `/api/users/${dev.id}`, { disabled: true })).status,
    200,
  );
  assert.equal((await call(engine, sessions.developer, "GET", "/api/projects")).status, 401);
  assert.equal(
    (
      await call(engine, null, "POST", "/api/auth/login", {
        email: "dev@example.com",
        password: PW,
      })
    ).status,
    401,
  );
  assert.equal((await call(engine, owner, "DELETE", `/api/users/${dev.id}`)).status, 200);
});

test("two-factor authentication over HTTP", async () => {
  await call(engine, owner, "POST", "/api/users", {
    email: "mfa@example.com",
    role: "developer",
    password: PW,
  });
  const first = await call(engine, null, "POST", "/api/auth/login", {
    email: "mfa@example.com",
    password: PW,
  });
  const token = first.data.token;

  // API tokens (no user behind them) cannot manage a user's second factor
  assert.equal((await call(engine, engine.bootstrap, "POST", "/api/auth/2fa/setup")).status, 400);

  const setup = await call(engine, token, "POST", "/api/auth/2fa/setup");
  assert.equal(setup.status, 200);
  assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\//);
  const secret = setup.data.secret;
  assert.equal(
    (await call(engine, token, "POST", "/api/auth/2fa/enable", { code: "000000" })).status,
    400,
  );
  const enabled = await call(engine, token, "POST", "/api/auth/2fa/enable", { code: totp(secret) });
  assert.equal(enabled.status, 200, enabled.text);
  assert.equal(enabled.data.recoveryCodes.length, 8);

  const noCode = await call(engine, null, "POST", "/api/auth/login", {
    email: "mfa@example.com",
    password: PW,
  });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.twoFactorRequired, true);
  const wrong = await call(engine, null, "POST", "/api/auth/login", {
    email: "mfa@example.com",
    password: PW,
    code: "123456",
  });
  assert.equal(wrong.status, 401);
  // the code that enabled 2FA is spent; the next time-step's code is accepted (within clock tolerance)
  const good = await call(engine, null, "POST", "/api/auth/login", {
    email: "mfa@example.com",
    password: PW,
    code: totp(secret, Date.now() + 30000),
  });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.data.user.twoFactorEnabled, true);

  // a recovery code signs in once
  const rec = enabled.data.recoveryCodes[0];
  assert.equal(
    (
      await call(engine, null, "POST", "/api/auth/login", {
        email: "mfa@example.com",
        password: PW,
        code: rec,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(engine, null, "POST", "/api/auth/login", {
        email: "mfa@example.com",
        password: PW,
        code: rec,
      })
    ).status,
    401,
  );

  // an admin can recover the account, which also signs the user out
  const users = (await call(engine, owner, "GET", "/api/users")).data;
  const row = users.find((u) => u.email === "mfa@example.com");
  assert.equal((await call(engine, owner, "POST", `/api/users/${row.id}/2fa-reset`)).status, 200);
  assert.equal((await call(engine, good.data.token, "GET", "/api/auth/me")).status, 401);
  assert.equal(
    (
      await call(engine, null, "POST", "/api/auth/login", {
        email: "mfa@example.com",
        password: PW,
      })
    ).status,
    200,
  );
});

test("repeated wrong passwords lock the email and the audit log records it", async () => {
  await call(engine, owner, "POST", "/api/users", {
    email: "lock@example.com",
    role: "viewer",
    password: PW,
  });
  let last;
  for (let i = 0; i < 8; i++)
    last = await call(engine, null, "POST", "/api/auth/login", {
      email: "lock@example.com",
      password: "nope-nope-nope",
    });
  const locked = await call(engine, null, "POST", "/api/auth/login", {
    email: "lock@example.com",
    password: PW,
  });
  assert.equal(locked.status, 429, `${last.status} then ${locked.text}`);
  assert.ok(locked.headers.get("retry-after"));

  const events = await call(engine, owner, "GET", "/api/auth/events");
  assert.equal(events.status, 200);
  const kinds = events.data.map((e) => e.event);
  for (const k of ["user_created", "login_success", "login_failed", "login_locked"])
    assert.ok(kinds.includes(k), `missing ${k}`);
  assert.equal((await call(engine, sessions.viewer, "GET", "/api/auth/events")).status, 403);
  assert.ok(!JSON.stringify(events.data).includes(PW));
});

test("API tokens and the local machine keep working exactly as before", async () => {
  assert.equal((await call(engine, engine.bootstrap, "GET", "/api/projects")).status, 200);
  const local = await call(engine, null, "GET", "/api/projects", undefined, { remote: false });
  assert.equal(local.status, 200, "the machine running the engine is still trusted");
  assert.equal(
    (await call(engine, null, "GET", "/api/projects")).status,
    401,
    "a remote caller still needs a credential",
  );
  // a forged session-looking token is just an unknown token
  assert.equal((await call(engine, "hxs_" + "0".repeat(48), "GET", "/api/projects")).status, 401);
});

// ───────────────────────── single sign-on, end to end ─────────────────────────

test("SSO: the whole flow through a real engine and a mock identity provider", async () => {
  const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  const enginePort = await freePort();
  const idp = { claims: null };
  let issuer;
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration")
      return send({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (req.url === "/jwks") return send({ keys: [jwk] });
    if (req.url === "/token") {
      req.resume();
      req.on("end", () => {
        const data = `${b64({ alg: "RS256", kid: "k1" })}.${b64(idp.claims)}`;
        const sig = crypto.sign("sha256", Buffer.from(data), key.privateKey).toString("base64url");
        send({ id_token: `${data}.${sig}` });
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${server.address().port}`;

  const sso = await startEngine(
    {
      HOSTERAX_OIDC_ISSUER: issuer,
      HOSTERAX_OIDC_CLIENT_ID: "hosterax",
      HOSTERAX_OIDC_CLIENT_SECRET: "s3cret",
      HOSTERAX_PUBLIC_URL: `http://127.0.0.1:${enginePort}`,
      HOSTERAX_OIDC_ALLOWED_DOMAINS: "example.com",
      HOSTERAX_OIDC_NAME: "Acme SSO",
    },
    enginePort,
  );
  try {
    assert.deepEqual((await call(sso, null, "GET", "/api/auth/providers")).data.sso, {
      name: "Acme SSO",
    });

    const start = await call(sso, null, "GET", "/api/auth/oidc/login");
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get("location"));
    assert.equal(authorize.origin, issuer);
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      `http://127.0.0.1:${enginePort}/api/auth/oidc/callback`,
    );
    const state = authorize.searchParams.get("state");
    const claims = (extra = {}) => ({
      iss: issuer,
      aud: "hosterax",
      sub: "idp-user-1",
      email: "grace@example.com",
      email_verified: true,
      name: "Grace Hopper",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: authorize.searchParams.get("nonce"),
      ...extra,
    });

    idp.claims = claims();
    const back = await call(sso, null, "GET", `/api/auth/oidc/callback?code=abc&state=${state}`);
    assert.equal(back.status, 302);
    const target = back.headers.get("location");
    assert.match(target, /^\/auth#session=hxs_[0-9a-f]{48}$/);
    assert.equal(back.headers.get("referrer-policy"), "no-referrer");
    const session = target.split("#session=")[1];

    const me = await call(sso, session, "GET", "/api/auth/me");
    assert.equal(me.data.user.email, "grace@example.com");
    assert.equal(me.data.user.role, "viewer", "SSO provisions the least-privileged role");
    assert.equal(me.data.user.authSource, "oidc");
    assert.equal(
      (await call(sso, session, "POST", "/api/projects", { name: "p", source: "x" })).status,
      403,
    );

    // the same state cannot be used twice
    const replay = await call(sso, null, "GET", `/api/auth/oidc/callback?code=abc&state=${state}`);
    assert.match(replay.headers.get("location"), /^\/auth\?sso_error=/);

    // a token for another email domain is refused with a readable message
    const second = new URL(
      (await call(sso, null, "GET", "/api/auth/oidc/login")).headers.get("location"),
    );
    idp.claims = claims({ email: "mallory@evil.example", nonce: second.searchParams.get("nonce") });
    const refused = await call(
      sso,
      null,
      "GET",
      `/api/auth/oidc/callback?code=abc&state=${second.searchParams.get("state")}`,
    );
    assert.match(decodeURIComponent(refused.headers.get("location")), /domain is not allowed/);

    // the provider reporting an error is passed along, not swallowed
    const denied = await call(
      sso,
      null,
      "GET",
      "/api/auth/oidc/callback?error=access_denied&error_description=User%20said%20no",
    );
    assert.match(decodeURIComponent(denied.headers.get("location")), /User said no/);
  } finally {
    server.close();
  }
});

test("SSO is cleanly off when it is not configured, and a bad configuration says why", async () => {
  assert.equal((await call(engine, null, "GET", "/api/auth/oidc/login")).status, 404);
  assert.equal((await call(engine, null, "GET", "/api/auth/providers")).data.sso, null);

  const broken = await startEngine({
    HOSTERAX_OIDC_ISSUER: "https://idp.example.com",
    HOSTERAX_OIDC_CLIENT_ID: "x",
    HOSTERAX_OIDC_CLIENT_SECRET: "y",
  });
  assert.match(broken.output(), /\[sso\] disabled: set HOSTERAX_PUBLIC_URL/);
  assert.equal((await call(broken, null, "GET", "/api/auth/providers")).data.sso, null);
});
