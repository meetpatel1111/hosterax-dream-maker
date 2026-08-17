import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const engineDir = dirname(dirname(fileURLToPath(import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "hosterax-test-"));

const port = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const child = spawn(process.execPath, ["src/index.mjs"], {
  cwd: engineDir,
  env: { ...process.env, HOSTERAX_PORT: String(port), HOSTERAX_HOME: home },
  stdio: ["ignore", "pipe", "pipe"],
});

const baseUrl = `http://127.0.0.1:${port}`;
let bearer = "";

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("engine did not become healthy");
}

async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!r.ok && r.status === 403 && !bearer) {
    const t = await api("GET", "/api/token");
    if (t.token) bearer = t.token;
    return api(method, path, body);
  }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text}`);
  return data;
}

before(async () => {
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(d));
  await waitForHealth();
});

after(async () => {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
  rmSync(home, { recursive: true, force: true });
});

test("health endpoint", async () => {
  const h = await api("GET", "/health");
  assert.equal(h.ok, true);
  assert.equal(typeof h.version, "string");
});

test("token bootstrap", async () => {
  const t = await api("GET", "/api/token");
  assert.equal(typeof t.token, "string");
});

test("projects CRUD", async () => {
  const name = `smoke-test-${Date.now()}`;
  const created = await api("POST", "/api/projects", {
    name,
    source: "https://github.com/example/demo",
  });
  assert.ok(created.id);
  assert.equal(created.name, name);
  const list = await api("GET", "/api/projects");
  assert.ok(list.some((p) => p.name === name));
  const del = await api("DELETE", `/api/projects/${name}`);
  assert.equal(del.ok, true);
  const list2 = await api("GET", "/api/projects");
  const leftover = list2.find((p) => p.name === name);
  assert.ok(!leftover || leftover.isArchived === true);
});

test("catalog endpoints serve from bundled JSON", async () => {
  const tags = await api("GET", "/api/catalog/tags");
  assert.ok(Array.isArray(tags.tags) && tags.tags.length > 0);
  const apps = await api("GET", "/api/catalog/apps?limit=5");
  assert.ok(Array.isArray(apps.apps));
  assert.ok(apps.apps.length > 0);
  assert.ok(apps.apps.length <= 5);
  const search = await api("GET", "/api/catalog/apps?q=nextcloud&limit=5");
  assert.ok(search.apps.length >= 1);
});

test("database provisioning + backup lifecycle", async () => {
  const proj = `smoke-db-${Date.now()}`;
  await api("POST", "/api/projects", { name: proj });
  const db = await api("POST", `/api/projects/${proj}/databases`, {
    name: "testdb",
    engine: "postgres",
  });
  assert.ok(db.id.startsWith("mdb_"));

  const bkp = await api("POST", `/api/databases/${db.id}/backup`);
  assert.ok(bkp.id.startsWith("bkp_"));
  assert.match(bkp.sha256, /^[0-9a-f]{64}$/);

  const list = await api("GET", "/api/backups");
  const row = list.find((b) => b.id === bkp.id);
  assert.ok(row);

  const deadline = Date.now() + 5000;
  let status = row.status;
  while (status !== "completed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const cur = await api("GET", "/api/backups");
    status = cur.find((b) => b.id === bkp.id)?.status;
  }
  assert.equal(status, "completed");
  await api("DELETE", `/api/projects/${proj}`);
});

test("tokens create + list + revoke", async () => {
  const created = await api("POST", "/api/tokens", { name: "smoke-token" });
  assert.match(created.token, /^hxt_/);
  const list = await api("GET", "/api/tokens");
  assert.ok(list.some((t) => t.token === created.token));
  const del = await api("DELETE", `/api/tokens/${created.token}`);
  assert.deepEqual(del, { ok: true });
  const list2 = await api("GET", "/api/tokens");
  assert.ok(!list2.some((t) => t.token === created.token));
});

test("system stats", async () => {
  const s = await api("GET", "/api/stats");
  assert.equal(typeof s.projects, "number");
  assert.equal(typeof s.deployments.total, "number");
  assert.equal(typeof s.system.cpu.percent, "number");
});
