import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import Database from "better-sqlite3";

const engineDir = dirname(dirname(fileURLToPath(import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "hosterax-envenc-"));

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** Boots a real engine on `home`; resolves once /health answers. */
async function startEngine() {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/index.mjs"], {
    cwd: engineDir,
    env: {
      ...process.env,
      HOSTERAX_PORT: String(port),
      HOSTERAX_HOME: home,
      HOSTERAX_EDGE_PROVIDER: "external", // never start a proxy container on the developer's Docker
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`engine did not start: ${output.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const bootstrap = /hxt_[0-9a-f]{48}/.exec(output)?.[0] ?? "";
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill();
      setTimeout(resolve, 3000);
    });
  return { baseUrl, bootstrap, stop };
}

const call = async (engine, token, method, path, body) => {
  const r = await fetch(`${engine.baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: r.status, data, text };
};

const rawDb = (fn) => {
  const db = new Database(join(home, "hosterax.db"));
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

let engine;
let admin = "";
let readToken = "";

before(async () => {
  engine = await startEngine();
  const minted = await call(engine, engine.bootstrap, "POST", "/api/tokens", {
    name: "admin-test",
    scopes: ["admin"],
  });
  admin = minted.data.token;
  const ro = await call(engine, admin, "POST", "/api/tokens", { name: "ro", scopes: ["read"] });
  readToken = ro.data.token;
});

after(async () => {
  await engine?.stop();
  rmSync(home, { recursive: true, force: true });
});

test("environment values are encrypted at rest", async () => {
  const created = await call(engine, admin, "POST", "/api/projects", {
    name: "enc-app",
    source: "x",
    target: "docker",
    env: { DB_PASSWORD: "plain-db-password-1" },
  });
  assert.ok(created.status < 300, created.text);
  const patched = await call(engine, admin, "PATCH", "/api/projects/enc-app/env", {
    upserts: [{ key: "API_KEY", value: "plain-api-key-2", isSecret: true }],
  });
  assert.equal(patched.status, 200, patched.text);

  rawDb((db) => {
    for (const row of db.prepare("SELECT key, value FROM project_env").all()) {
      assert.match(row.value, /^enc:v1:/, `${row.key} is stored in clear text`);
    }
    const { env_json } = db.prepare("SELECT env_json FROM projects WHERE name=?").get("enc-app");
    assert.match(env_json, /^enc:v1:/);
  });

  // The secrets must not appear anywhere in the database files either.
  for (const f of ["hosterax.db", "hosterax.db-wal"]) {
    const file = join(home, f);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file).toString("latin1");
    assert.ok(!bytes.includes("plain-db-password-1"), `${f} contains a plaintext value`);
    assert.ok(!bytes.includes("plain-api-key-2"), `${f} contains a plaintext value`);
  }
});

test("values still round-trip for tokens allowed to read them", async () => {
  const env = await call(engine, admin, "GET", "/api/projects/enc-app/env");
  assert.equal(env.status, 200, env.text);
  const byKey = Object.fromEntries(env.data.map((e) => [e.key, e]));
  assert.equal(byKey.DB_PASSWORD.value, "plain-db-password-1");
  assert.equal(byKey.API_KEY.isSecret, true);
  assert.notEqual(byKey.API_KEY.value, "plain-api-key-2", "secret values stay masked in the API");
});

test("a read-scoped token never receives environment values through the project JSON", async () => {
  const one = await call(engine, readToken, "GET", "/api/projects/enc-app");
  assert.equal(one.status, 200, one.text);
  const list = await call(engine, readToken, "GET", "/api/projects");
  assert.equal(list.status, 200, list.text);
  for (const body of [one.text, list.text]) {
    assert.ok(!body.includes("env_json"), "env_json must not be part of the project JSON");
    assert.ok(!body.includes("plain-db-password-1"));
    assert.ok(!body.includes("plain-api-key-2"));
  }
  const direct = await call(engine, readToken, "GET", "/api/projects/enc-app/env");
  assert.equal(direct.status, 403);
});

test("existing plaintext values are encrypted on the next start", async () => {
  await call(engine, admin, "POST", "/api/projects", { name: "legacy-a", source: "x" });
  await call(engine, admin, "POST", "/api/projects", { name: "legacy-b", source: "x" });
  await call(engine, admin, "PATCH", "/api/projects/legacy-a/env", {
    upserts: [{ key: "OLD_KEY", value: "old-plain-value" }],
  });
  await engine.stop();

  // Simulate a database written by an older version.
  rawDb((db) => {
    db.prepare("UPDATE project_env SET value=? WHERE project='legacy-a' AND key='OLD_KEY'").run(
      "old-plain-value",
    );
    db.prepare("UPDATE projects SET env_json=? WHERE name='legacy-a'").run(
      JSON.stringify({ OLD_KEY: "old-plain-value" }),
    );
    // legacy-b only ever had its env in the derived cache column
    db.prepare("UPDATE projects SET env_json=? WHERE name='legacy-b'").run(
      JSON.stringify({ CACHE_ONLY: "cache-only-value" }),
    );
  });

  engine = await startEngine();

  rawDb((db) => {
    const rows = db.prepare("SELECT project, key, value FROM project_env").all();
    for (const r of rows) assert.match(r.value, /^enc:v1:/, `${r.project}.${r.key} not encrypted`);
    assert.ok(rows.some((r) => r.project === "legacy-b" && r.key === "CACHE_ONLY"));
    for (const p of db.prepare("SELECT name, env_json FROM projects").all()) {
      if (p.env_json && p.env_json !== "{}") assert.match(p.env_json, /^enc:v1:/, p.name);
    }
  });

  const a = await call(engine, admin, "GET", "/api/projects/legacy-a/env");
  assert.equal(a.data.find((e) => e.key === "OLD_KEY").value, "old-plain-value");
  const b = await call(engine, admin, "GET", "/api/projects/legacy-b/env");
  assert.equal(b.data.find((e) => e.key === "CACHE_ONLY").value, "cache-only-value");
});
