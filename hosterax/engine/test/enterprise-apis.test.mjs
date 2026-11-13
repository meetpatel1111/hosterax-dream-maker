import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import WebSocket from "ws";

import { createHarness } from "./helpers/engine-harness.mjs";
import {
  validateReadOnlySql,
  maskSensitiveRow,
  normalizeGitRepoSlug,
  evaluateContainerPosture,
} from "../src/enterprise-apis.mjs";
import {
  compileCaddyMiddlewares,
  compileNginxMiddlewares,
} from "../src/edge-manager.mjs";
import { assertSafeLocalPath } from "../src/security.mjs";

const harness = createHarness("hosterax-enterprise-e2e-");
let engine;
let admin;
let receiverSrv;
let receiverUrl;
let receivedSiemPayloads = [];

before(async () => {
  receiverSrv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/siem") {
        receivedSiemPayloads.push({
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "healthy" }));
        return;
      }
      res.writeHead(503);
      res.end("down");
    });
  });
  await new Promise((r) => receiverSrv.listen(0, "127.0.0.1", r));
  receiverUrl = `http://127.0.0.1:${receiverSrv.address().port}`;

  engine = await harness.startEngine();
  admin = engine.bootstrap;
});

after(async () => {
  await harness.cleanup();
  if (receiverSrv) {
    await new Promise((r) => receiverSrv.close(r));
  }
});

// ───────────────────── Pure Helper Unit Tests ─────────────────────

test("validateReadOnlySql permits SELECT/WITH/PRAGMA and rejects writes or multi-statements", () => {
  assert.equal(validateReadOnlySql("  SELECT * FROM projects; "), "SELECT * FROM projects");
  assert.equal(
    validateReadOnlySql("WITH t AS (SELECT 1) SELECT * FROM t"),
    "WITH t AS (SELECT 1) SELECT * FROM t",
  );
  assert.equal(validateReadOnlySql("PRAGMA table_info('projects')"), "PRAGMA table_info('projects')");
  assert.equal(
    validateReadOnlySql("SELECT ';' AS semi, 'DROP TABLE projects' AS label"),
    "SELECT ';' AS semi, 'DROP TABLE projects' AS label",
  );

  for (const bad of [
    "",
    "DELETE FROM projects",
    "DROP TABLE users",
    "INSERT INTO tokens VALUES ('a')",
    "SELECT 1; SELECT 2",
    "PRAGMA writable_schema = ON",
    "ATTACH DATABASE '/tmp/x.db' AS x",
  ]) {
    assert.throws(() => validateReadOnlySql(bad), /Error|SQL|read-only|Multiple|Mutating|required/i);
  }
});

test("maskSensitiveRow masks secrets and preserves non-sensitive fields", () => {
  const row = maskSensitiveRow({
    id: "u1",
    email: "ops@example.com",
    password_hash: "scrypt$abc$def",
    token: "hxt_secret123",
    value_enc: "enc:abc",
    clone_token: "ghp_123",
    empty_secret: "",
    role: "admin",
  });
  assert.equal(row.id, "u1");
  assert.equal(row.email, "ops@example.com");
  assert.equal(row.role, "admin");
  assert.equal(row.password_hash, "••••••••");
  assert.equal(row.token, "••••••••");
  assert.equal(row.value_enc, "••••••••");
  assert.equal(row.clone_token, "••••••••");
  assert.equal(row.empty_secret, "");
});

test("normalizeGitRepoSlug handles SSH and HTTPS git remotes", () => {
  assert.equal(normalizeGitRepoSlug("git@github.com:AcmeCorp/Web-App.git"), "acmecorp/web-app");
  assert.equal(normalizeGitRepoSlug("https://github.com/AcmeCorp/Web-App.git"), "acmecorp/web-app");
  assert.equal(normalizeGitRepoSlug("https://gitlab.com/group/service"), "group/service");
  assert.equal(normalizeGitRepoSlug(""), "");
});

test("evaluateContainerPosture flags privileged, root user, writable rootfs, unbounded limits, and docker.sock", () => {
  const res = evaluateContainerPosture({
    Name: "/untrusted-worker",
    Config: { Image: "alpine:3.19", User: "" },
    HostConfig: { Privileged: true, NetworkMode: "host", ReadonlyRootfs: false },
    State: { Running: true },
    Mounts: [{ Source: "/var/run/docker.sock" }],
  });
  assert.equal(res.container, "untrusted-worker");
  assert.equal(res.running, true);
  assert.equal(res.counts.critical, 1);
  assert.equal(res.counts.high, 2);
  assert.equal(res.counts.medium, 1);
  assert.equal(res.counts.low, 2);

  // hx_edge is explicitly allowed to use host network
  const edgeRes = evaluateContainerPosture({
    Name: "/hx_edge",
    Config: { Image: "caddy:2", User: "1000" },
    HostConfig: { Privileged: false, NetworkMode: "host", ReadonlyRootfs: true, Memory: 128000000 },
    State: { Running: true },
    Mounts: [],
  });
  assert.equal(edgeRes.counts.critical, 0);
  assert.equal(edgeRes.counts.high, 0);
  assert.equal(edgeRes.counts.medium, 0);
  assert.equal(edgeRes.counts.low, 0);
});

test("compileCaddyMiddlewares and compileNginxMiddlewares generate valid directives for enabled middlewares", () => {
  const mws = [
    { id: "1", kind: "security_headers", enabled: true, config: { frameOptions: "DENY" } },
    { id: "2", kind: "cors", enabled: true, config: { allowOrigin: "https://app.example.com" } },
    { id: "3", kind: "ip_block", enabled: true, config: { ip: "10.0.0.5, 192.168.1.0/24" } },
    { id: "4", kind: "custom_header", enabled: false, config: { name: "X-Skip", value: "1" } },
  ];
  const caddy = compileCaddyMiddlewares(mws).join("\n");
  assert.match(caddy, /X-Frame-Options "DENY"/);
  assert.match(caddy, /Access-Control-Allow-Origin "https:\/\/app\.example\.com"/);
  assert.match(caddy, /remote_ip 10\.0\.0\.5 192\.168\.1\.0\/24/);
  assert.doesNotMatch(caddy, /X-Skip/);

  const nginx = compileNginxMiddlewares(mws).join("\n");
  assert.match(nginx, /add_header X-Frame-Options "DENY" always;/);
  assert.match(nginx, /add_header Access-Control-Allow-Origin "https:\/\/app\.example\.com" always;/);
  assert.match(nginx, /deny 10\.0\.0\.5;/);
  assert.match(nginx, /deny 192\.168\.1\.0\/24;/);
  assert.doesNotMatch(nginx, /X-Skip/);
});

test("assertSafeLocalPath blocks sensitive system directories and enforces workspace roots", () => {
  assert.throws(() => assertSafeLocalPath("/etc/passwd"), /protected system path/i);
  assert.throws(() => assertSafeLocalPath(join(os.homedir(), ".ssh", "id_rsa")), /protected system path|SSH/i);
  assert.throws(() => assertSafeLocalPath("/var/run/docker.sock"), /protected system path/i);
  assert.throws(
    () => assertSafeLocalPath("/tmp/other-dir", { HOSTERAX_WORKSPACE_ROOTS: "/tmp/allowed-ws" }),
    /HOSTERAX_WORKSPACE_ROOTS/i,
  );
  const ok = assertSafeLocalPath("/tmp/allowed-ws/myapp", { HOSTERAX_WORKSPACE_ROOTS: "/tmp/allowed-ws" });
  assert.equal(ok, "/tmp/allowed-ws/myapp");
});

// ───────────────────── Live HTTP & WS Integration Tests ─────────────────────

test("Database query proxy runs read-only SQLite queries, masks tokens, and blocks writes", async () => {
  const okRes = await harness.call(engine, admin, "POST", "/api/databases/query", {
    target: "engine-sqlite",
    query: "SELECT name, token FROM tokens LIMIT 5",
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.data.ok, true);
  assert.ok(okRes.data.rows.length >= 1);
  assert.equal(okRes.data.rows[0].token, "••••••••");

  const badRes = await harness.call(engine, admin, "POST", "/api/databases/query", {
    target: "engine-sqlite",
    query: "DROP TABLE tokens",
  });
  assert.equal(badRes.status, 400);
});

test("Vault group create, masked read, reveal, sync to project, and audit trail recording", async () => {
  const proj = await harness.call(engine, admin, "POST", "/api/projects", { name: "vault-app" });
  assert.equal(proj.status, 201);

  const created = await harness.call(engine, admin, "POST", "/api/vault/groups", {
    name: "prod-secrets",
    description: "Production keys",
    linkedProjects: ["vault-app"],
    secrets: [{ key: "STRIPE_SECRET", value: "sk_live_abc123" }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.secrets[0].value, "••••••••");

  const revealed = await harness.call(
    engine,
    admin,
    "GET",
    `/api/vault/groups/${created.data.id}/reveal`,
  );
  assert.equal(revealed.status, 200);
  assert.equal(revealed.data[0].key, "STRIPE_SECRET");
  assert.equal(revealed.data[0].value, "sk_live_abc123");

  const synced = await harness.call(
    engine,
    admin,
    "POST",
    `/api/vault/groups/${created.data.id}/sync`,
    {},
  );
  assert.equal(synced.status, 200);
  assert.deepEqual(synced.data.synced, ["vault-app"]);

  const audits = await harness.call(engine, admin, "GET", "/api/audit-logs?limit=20");
  assert.equal(audits.status, 200);
  const actions = audits.data.map((a) => a.action);
  assert.ok(actions.includes("vault.group_created"));
  assert.ok(actions.includes("vault.secret_revealed"));
  assert.ok(actions.includes("vault.synced"));
});

test("OAuth client creation and PKCE /authorize -> /token flow validates code_verifier", async () => {
  const clientRes = await harness.call(engine, admin, "POST", "/api/oauth/clients", {
    name: "CLI Companion",
    clientType: "public",
    redirectUris: ["http://127.0.0.1:49100/cb"],
    scopes: ["read", "deploy"],
  });
  assert.equal(clientRes.status, 201);
  const { clientId } = clientRes.data;

  const verifier = "pkce_verifier_sample_0123456789_abcdef";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const authRes = await harness.call(engine, admin, "POST", "/api/oauth/authorize", {
    clientId,
    redirectUri: "http://127.0.0.1:49100/cb",
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  });
  assert.equal(authRes.status, 200);
  const code = authRes.data.code;

  const wrongRes = await harness.call(engine, admin, "POST", "/api/oauth/token", {
    code,
    codeVerifier: "wrong-verifier",
  });
  assert.equal(wrongRes.status, 401);

  const goodRes = await harness.call(engine, admin, "POST", "/api/oauth/token", {
    code,
    codeVerifier: verifier,
  });
  assert.equal(goodRes.status, 200);
  assert.equal(goodRes.data.token_type, "Bearer");
  assert.match(goodRes.data.access_token, /^hx_oauth_/);
});

test("SIEM sink test delivers real HTTP POST and records delivery metrics", async () => {
  const sink = await harness.call(engine, admin, "POST", "/api/siem/sinks", {
    name: "Local Collector",
    provider: "webhook",
    endpoint: `${receiverUrl}/siem`,
    apiKey: "siem_secret_key",
  });
  assert.equal(sink.status, 201);

  const testRes = await harness.call(
    engine,
    admin,
    "POST",
    `/api/siem/sinks/${sink.data.id}/test`,
  );
  assert.equal(testRes.status, 200);
  assert.equal(testRes.data.ok, true);
  assert.ok(receivedSiemPayloads.length >= 1);
  const last = receivedSiemPayloads[receivedSiemPayloads.length - 1];
  assert.equal(last.headers.authorization, "Bearer siem_secret_key");
  assert.equal(last.body.source, "siem-test");

  const deliveries = await harness.call(engine, admin, "GET", "/api/siem/deliveries");
  assert.equal(deliveries.status, 200);
  assert.ok(deliveries.data.some((d) => d.sink_id === sink.data.id && d.ok === true));
});

test("Status page component runs real HTTP probe and serves public status endpoint", async () => {
  const comp = await harness.call(engine, admin, "POST", "/api/status-page/components", {
    name: "Edge API",
    groupName: "Core",
    targetUrl: `${receiverUrl}/healthz`,
  });
  assert.equal(comp.status, 201);
  assert.equal(comp.data.status, "operational");

  const probe = await harness.call(
    engine,
    admin,
    "POST",
    `/api/status-page/probe/${comp.data.id}`,
  );
  assert.equal(probe.status, 200);
  assert.equal(probe.data.status, "operational");
  assert.equal(probe.data.statusCode, 200);

  const pub = await harness.call(engine, null, "GET", "/api/public/status");
  assert.equal(pub.status, 200);
  assert.ok(pub.data.components.some((c) => c.id === comp.data.id));
});

test("Edge middlewares validate comma-separated domain hostnames on POST and PATCH", async () => {
  const created = await harness.call(engine, admin, "POST", "/api/edge/middlewares", {
    name: "Multi-Domain Headers",
    kind: "security_headers",
    scopeType: "domain",
    scopeTarget: "app.example.com, api.example.com",
    config: { frameOptions: "DENY" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.scope_target, "app.example.com, api.example.com");

  const patched = await harness.call(
    engine,
    admin,
    "PATCH",
    `/api/edge/middlewares/${created.data.id}`,
    { scopeTarget: "cdn.example.com, admin.example.com" },
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.data.scope_target, "cdn.example.com, admin.example.com");

  const bad = await harness.call(engine, admin, "POST", "/api/edge/middlewares", {
    name: "Bad Scope",
    kind: "security_headers",
    scopeType: "domain",
    scopeTarget: "valid.example.com, bad host!!",
  });
  assert.equal(bad.status, 400);
});

test("Deployment diff returns base/target timing and masked environment differences", async () => {
  await harness.call(engine, admin, "POST", "/api/projects", {
    name: "diff-svc",
    env: { NODE_ENV: "production", API_SECRET: "super-secret-value" },
  });
  const now = Date.now();
  const db = new Database(join(engine.home, "hosterax.db"));
  db.pragma("busy_timeout = 5000");
  db.prepare(
    `INSERT INTO deployments (id, project, version, phase, trigger, started_at, finished_at, exit_code)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("dep_diff_1", "diff-svc", "v1", "ready", "manual", now - 20000, now - 15000, 0);
  db.prepare(
    `INSERT INTO deployments (id, project, version, phase, trigger, started_at, finished_at, exit_code)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("dep_diff_2", "diff-svc", "v2", "ready", "git-push", now - 10000, now - 3000, 0);
  db.close();

  const res = await harness.call(engine, admin, "GET", "/api/deployments/dep_diff_1/diff/dep_diff_2");
  assert.equal(res.status, 200);
  assert.equal(res.data.base.id, "dep_diff_1");
  assert.equal(res.data.target.id, "dep_diff_2");
  assert.equal(res.data.duration_diff_ms, 2000);
  assert.ok(!res.text.includes("super-secret-value"));
});

test("PR preview environments create, sleep, wake, and delete cleanly", async () => {
  await harness.call(engine, admin, "POST", "/api/projects", { name: "preview-svc" });

  const created = await harness.call(engine, admin, "POST", "/api/projects/preview-svc/previews", {
    prNumber: 42,
    prTitle: "Add billing webhook",
    branch: "feat/billing",
    commitSha: "abcdef12",
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, "live");

  const slept = await harness.call(engine, admin, "POST", `/api/previews/${created.data.id}/sleep`);
  assert.equal(slept.status, 200);
  assert.equal(slept.data.status, "sleeping");

  const woken = await harness.call(engine, admin, "POST", `/api/previews/${created.data.id}/wake`);
  assert.equal(woken.status, 200);
  assert.equal(woken.data.status, "live");

  const deleted = await harness.call(engine, admin, "DELETE", `/api/previews/${created.data.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.ok, true);
});

test("WebSocket rejects unauthenticated connections and accepts Bearer token when HOSTERAX_REQUIRE_AUTH=1", async () => {
  const locked = await harness.startEngine({ env: { HOSTERAX_REQUIRE_AUTH: "1" } });
  const wsUrl = `ws://127.0.0.1:${locked.port}/ws?system=1`;

  const unauthClose = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.once("error", reject);
  });
  assert.equal(unauthClose.code, 1008);

  const authedOk = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${locked.bootstrap}` },
    });
    ws.once("open", () => {
      ws.close();
      resolve(true);
    });
    ws.once("close", (code) => {
      if (code === 1008) reject(new Error("Expected authenticated WebSocket to stay open"));
    });
    ws.once("error", reject);
  });
  assert.equal(authedOk, true);
});
