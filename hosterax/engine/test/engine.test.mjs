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
  const t = await api("GET", "/api/token");
  if (t?.token) bearer = t.token;
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

test("s3 storage configuration and remote sync api", async () => {
  const cfg = await api("GET", "/api/backups/s3-config");
  assert.equal(typeof cfg.configured, "boolean");

  const updated = await api("POST", "/api/backups/s3-config", {
    name: "Cloudflare R2 Test",
    provider_type: "r2",
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucket: "hosterax-test-bucket",
    access_key_id: "test-key-id",
    secret_access_key: "test-secret-key",
    auto_sync: 1,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.config.bucket, "hosterax-test-bucket");
  assert.equal(updated.config.auto_sync, 1);
});

test("cron jobs engine CRUD and manual execution", async () => {
  const job = await api("POST", "/api/jobs", {
    name: "Test Echo Job",
    cron_expression: "*/5 * * * *",
    job_type: "command",
    command: "echo 'HosteraX Cron Engine Active'",
  });
  assert.ok(job.id.startsWith("job_"));
  assert.equal(job.name, "Test Echo Job");

  const list = await api("GET", "/api/jobs");
  assert.ok(list.some((j) => j.id === job.id));

  const run = await api("POST", `/api/jobs/${job.id}/run`);
  assert.ok(run.id.startsWith("run_"));
  assert.equal(run.status, "success");
  assert.ok(run.stdout.includes("HosteraX Cron Engine Active"));

  const runs = await api("GET", `/api/jobs/${job.id}/runs`);
  assert.ok(runs.length >= 1);
  assert.equal(runs[0].id, run.id);

  const del = await api("DELETE", `/api/jobs/${job.id}`);
  assert.equal(del.ok, true);
});

test("model context protocol (MCP) JSON-RPC 2.0 server", async () => {
  // Discovery endpoint
  const discovery = await api("GET", "/api/mcp");
  assert.equal(discovery.mcp, "2024-11-05");
  assert.ok(discovery.toolsCount >= 10);

  // JSON-RPC initialize
  const initRes = await api("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  assert.equal(initRes.jsonrpc, "2.0");
  assert.equal(initRes.result.serverInfo.name, "hosterax-engine");

  // JSON-RPC tools/list
  const toolsList = await api("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.ok(Array.isArray(toolsList.result.tools));
  const toolNames = toolsList.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes("get_system_stats"));
  assert.ok(toolNames.includes("list_projects"));
  assert.ok(toolNames.includes("list_cron_jobs"));
  assert.ok(toolNames.includes("search_catalog"));

  // JSON-RPC tools/call: get_system_stats
  const callStats = await api("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_system_stats" },
  });
  assert.equal(callStats.jsonrpc, "2.0");
  assert.ok(callStats.result.content[0].text.includes("HosteraX"));

  // JSON-RPC tools/call: search_catalog
  const callCatalog = await api("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "search_catalog", arguments: { query: "postgres" } },
  });
  assert.equal(callCatalog.jsonrpc, "2.0");
  assert.ok(Array.isArray(JSON.parse(callCatalog.result.content[0].text)));
});

test("multi-node server management CRUD and connection test", async () => {
  const list = await api("GET", "/api/servers");
  assert.ok(Array.isArray(list));
  const local = list.find((s) => s.id === "local");
  assert.ok(local);
  assert.equal(local.type, "local");
  assert.equal(local.status, "online");

  const created = await api("POST", "/api/servers", {
    name: "Production VPS Node #1",
    type: "remote",
    host: "192.168.1.100",
    port: 22,
    username: "ubuntu",
  });
  assert.ok(created.id.startsWith("srv_"));
  assert.equal(created.name, "Production VPS Node #1");

  const tok = await api("GET", "/api/token");
  const bootstrap = await fetch(`${baseUrl}/api/servers/${created.id}/bootstrap`, {
    headers: { authorization: `Bearer ${tok.token}` },
  }).then((r) => r.text());
  assert.ok(bootstrap.includes("HosteraX Autonomous Node Provisioner"));

  const testConn = await api("POST", `/api/servers/local/test`);
  assert.equal(testConn.ok, true);

  const del = await api("DELETE", `/api/servers/${created.id}`);
  assert.equal(del.ok, true);
});

test("github webhooks and ephemeral pr previews lifecycle", async () => {
  const proj = `whk-test-${Date.now()}`;
  await api("POST", "/api/projects", { name: proj, source: "https://github.com/example/demo" });

  // Webhook ping
  const pingRes = await fetch(`${baseUrl}/api/projects/${proj}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
    },
    body: JSON.stringify({ zen: "Responsive is better than fast." }),
  }).then((r) => r.json());
  assert.equal(pingRes.ok, true);

  // PR Opened event (Ephemeral Preview)
  const prRes = await fetch(`${baseUrl}/api/projects/${proj}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
    },
    body: JSON.stringify({
      action: "opened",
      number: 42,
      pull_request: {
        title: "feat: new checkout workflow",
        head: { ref: "feature/checkout", sha: "abc1234" },
      },
    }),
  }).then((r) => r.json());
  assert.equal(prRes.ok, true);
  assert.equal(prRes.action, "preview_provisioned");
  assert.equal(prRes.prNumber, 42);

  // List previews
  const previews = await api("GET", `/api/projects/${proj}/previews`);
  assert.ok(previews.some((p) => p.pr_number === 42));

  // PR Closed event (Teardown)
  const closeRes = await fetch(`${baseUrl}/api/projects/${proj}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
    },
    body: JSON.stringify({
      action: "closed",
      number: 42,
    }),
  }).then((r) => r.json());
  assert.equal(closeRes.ok, true);
  assert.equal(closeRes.action, "preview_torn_down");

  await api("DELETE", `/api/projects/${proj}`);
});

test("multi-tenant organizations and rbac member management", async () => {
  const orgs = await api("GET", "/api/orgs");
  assert.ok(Array.isArray(orgs));
  assert.ok(orgs.length >= 1);

  const newOrg = await api("POST", "/api/orgs", { name: "Acme Cloud Engineering", slug: "acme-cloud" });
  assert.ok(newOrg.id.startsWith("org_"));
  assert.equal(newOrg.name, "Acme Cloud Engineering");
  assert.equal(newOrg.slug, "acme-cloud");

  // Add member
  const memberRes = await api("POST", `/api/orgs/${newOrg.id}/members`, {
    user_email: "dev@acme.com",
    user_name: "Lead Developer",
    role: "member",
  });
  const devMember = memberRes.members.find((m) => m.user_email === "dev@acme.com");
  assert.ok(devMember);
  assert.equal(devMember.role, "member");

  // Update role to admin
  const updateRes = await api("PATCH", `/api/orgs/${newOrg.id}/members/${devMember.id}`, { role: "admin" });
  const updatedDev = updateRes.members.find((m) => m.id === devMember.id);
  assert.equal(updatedDev.role, "admin");

  // Generate invite
  const inv = await api("POST", `/api/orgs/${newOrg.id}/invites`, {
    email: "designer@acme.com",
    role: "viewer",
  });
  assert.ok(inv.id.startsWith("inv_"));
  assert.ok(inv.invite_url.includes("token="));

  // Delete org
  const del = await api("DELETE", `/api/orgs/${newOrg.id}`);
  assert.equal(del.ok, true);
});

test("self-hosted email stack, dns records, mailboxes, and webmail messages", async () => {
  const doms = await api("GET", "/api/email/domains");
  assert.ok(Array.isArray(doms));
  assert.ok(doms.length >= 1);

  const testDom = await api("POST", "/api/email/domains", { domain: "mailtest.internal" });
  assert.ok(testDom.id.startsWith("edom_"));
  assert.equal(testDom.domain, "mailtest.internal");
  assert.ok(Array.isArray(testDom.dns_records));
  assert.equal(testDom.dns_records.length, 4); // MX, SPF, DKIM, DMARC

  const spf = testDom.dns_records.find((r) => r.purpose.includes("SPF"));
  assert.ok(spf && spf.value.includes("v=spf1"));

  const dkim = testDom.dns_records.find((r) => r.purpose.includes("DKIM"));
  assert.ok(dkim && dkim.value.includes("v=DKIM1"));

  // Create mailbox
  const mbox = await api("POST", "/api/email/mailboxes", {
    domain_id: testDom.id,
    email: "support@mailtest.internal",
    name: "Customer Support",
  });
  assert.ok(mbox.id.startsWith("mbox_"));
  assert.equal(mbox.email, "support@mailtest.internal");

  // Send message
  const msg = await api("POST", "/api/email/send", {
    mailbox_id: mbox.id,
    to: "client@example.com",
    subject: "Ticket #1042 Resolved",
    body_text: "Your support request has been completed successfully.",
  });
  assert.ok(msg.id.startsWith("msg_"));
  assert.equal(msg.subject, "Ticket #1042 Resolved");

  // List sent messages
  const sentMsgs = await api("GET", `/api/email/mailboxes/${mbox.id}/messages?folder=sent`);
  assert.ok(sentMsgs.some((m) => m.id === msg.id));

  // Cleanup
  await api("DELETE", `/api/email/domains/${testDom.id}`);
});

