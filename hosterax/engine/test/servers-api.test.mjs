// End-to-end: a real engine managing a "remote" server that is a real OpenSSH server on loopback.
// The server's Docker is a stand-in (see helpers/ssh-fixture.mjs); everything on the SSH side is real.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";

const HAVE_SSH = sshToolsAvailable();
const skip = HAVE_SSH ? false : "OpenSSH client/server is not installed";
const h = createHarness("hosterax-servers-api-");

let fx;
let engine;
let admin;
const api = (method, path, body, token = admin) => h.call(engine, token, method, path, body);

before(async () => {
  if (!HAVE_SSH) return;
  fx = await startSshFixture();
  engine = await h.startEngine({ env: { HOSTERAX_SERVER_POLL_MS: "700" } });
  admin = engine.bootstrap;
});
after(async () => {
  await h.cleanup();
  await fx?.stop();
});

let srv; // the server created in the first test

test("adding a server generates a key and shows only the public half", { skip }, async () => {
  const r = await api("POST", "/api/servers", {
    name: "Loopback",
    type: "remote",
    host: fx.host,
    port: fx.port,
    username: fx.username,
  });
  assert.equal(r.status, 201, r.text);
  srv = r.data;
  assert.match(srv.public_key, /^ssh-ed25519 \S+ hosterax$/);
  assert.equal(srv.has_key, true);
  assert.equal(srv.host_key_pinned, false);
  assert.equal(srv.status, "provisioning");
  assert.equal(srv.ready, false);
  assert.ok(!r.text.includes("PRIVATE KEY"), "the private key is never returned");
  assert.ok(!(await api("GET", "/api/servers")).text.includes("PRIVATE KEY"));
});

test("nothing connects before a host key is pinned", { skip }, async () => {
  const r = await api("POST", `/api/servers/${srv.id}/test`);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.code, "no_host_key");
});

test(
  "the host key fingerprint is shown, checked against what the server presents, and pinned",
  {
    skip,
  },
  async () => {
    const scan = await api("GET", `/api/servers/${srv.id}/host-key`);
    assert.equal(scan.status, 200, scan.text);
    const ref = spawnSync("ssh-keygen", ["-lf", `${fx.hostKeyFile}.pub`], { encoding: "utf8" });
    const real = ref.stdout.split(/\s+/)[1];
    assert.ok(scan.data.keys.some((k) => k.fingerprint === real));
    assert.equal(scan.data.pinned, null);

    const wrong = await api("POST", `/api/servers/${srv.id}/host-key`, {
      fingerprint: "SHA256:" + "A".repeat(43),
    });
    assert.equal(wrong.status, 409);
    assert.match(wrong.data.error, /does not present a key with that fingerprint/);
    assert.equal((await api("GET", `/api/servers/${srv.id}`)).data.host_key_pinned, false);

    const malformed = await api("POST", `/api/servers/${srv.id}/host-key`, { fingerprint: "abc" });
    assert.equal(malformed.status, 400);

    const ok = await api("POST", `/api/servers/${srv.id}/host-key`, { fingerprint: real });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.data.host_key_pinned, true);
    assert.equal(ok.data.host_key_fingerprint, real);

    const again = await api("POST", `/api/servers/${srv.id}/host-key`, { fingerprint: real });
    assert.equal(again.status, 400, "replacing a pin needs an explicit flag");
    srv.fingerprint = real;
  },
);

test(
  "until the public key is installed on the server, login is rejected with a fix",
  { skip },
  async () => {
    const r = await api("POST", `/api/servers/${srv.id}/test`);
    assert.equal(r.data.ok, false);
    assert.equal(r.data.code, "auth_failed");
    assert.match(r.data.message, /authorized_keys/);
    assert.equal((await api("GET", `/api/servers/${srv.id}`)).data.status, "error");
  },
);

test(
  "once authorised, the test connects and the server reports real figures",
  { skip },
  async () => {
    fx.authorizeKey(srv.public_key);
    const r = await api("POST", `/api/servers/${srv.id}/test`);
    assert.equal(r.data.ok, true, r.text);
    const s = (await api("GET", `/api/servers/${srv.id}`)).data;
    assert.equal(s.status, "online");
    assert.equal(s.ready, true);
    assert.equal(s.docker_version, "Docker v27.0.1-fake");
    assert.equal(s.containers_count, 2);
    assert.ok(s.cpu_cores >= 1);
    assert.ok(s.total_ram_mb > 0);
    assert.equal(s.last_error, null);
  },
);

test("the monitor keeps status current without anyone asking", { skip }, async () => {
  fx.dockerMode("down");
  await h.until(
    async () => (await api("GET", `/api/servers/${srv.id}`)).data.last_error_code === "docker_down",
    12000,
    "the monitor to notice Docker stopped",
  );
  assert.equal((await api("GET", `/api/servers/${srv.id}`)).data.status, "error");
  fx.dockerMode("ok");
  await h.until(
    async () => (await api("GET", `/api/servers/${srv.id}`)).data.status === "online",
    12000,
    "the monitor to notice Docker is back",
  );
  const events = (await api("GET", "/api/self-heal/events")).text;
  assert.match(events, /server_status/);
});

test(
  "a changed host key is refused, shown as changed, and re-pinning is deliberate",
  { skip },
  async () => {
    fx.regenerateHostKey();
    await new Promise((r) => setTimeout(r, 400));
    // Existing multiplexed connections would still carry the old session; the monitor/tests open new ones.
    const r = await h.until(
      async () => {
        const t = (await api("POST", `/api/servers/${srv.id}/test`)).data;
        return t.code === "host_key_mismatch" ? t : null;
      },
      15000,
      "the changed key to be refused",
    );
    assert.equal(r.ok, false);
    assert.equal((await api("GET", `/api/servers/${srv.id}`)).data.status, "error");
    const scan = (await api("GET", `/api/servers/${srv.id}/host-key`)).data;
    assert.equal(scan.changed, true);

    const refused = await api("POST", `/api/servers/${srv.id}/host-key`, {
      fingerprint: scan.keys[0].fingerprint,
    });
    assert.equal(refused.status, 400, "no silent re-pin");
    const ok = await api("POST", `/api/servers/${srv.id}/host-key`, {
      fingerprint: scan.keys[0].fingerprint,
      replace: true,
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await api("POST", `/api/servers/${srv.id}/test`)).data.ok, true);
  },
);

test(
  "only name, address, user and key can be edited; the address change drops the pin",
  { skip },
  async () => {
    let r = await api("PATCH", `/api/servers/${srv.id}`, {
      status: "offline",
      cpu_cores: 999,
      name: "Renamed",
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.name, "Renamed");
    assert.notEqual(r.data.status, "offline");
    assert.notEqual(r.data.cpu_cores, 999);

    r = await api("PATCH", `/api/servers/${srv.id}`, {
      username: "x\n  ProxyCommand touch /tmp/pwned",
    });
    assert.equal(r.status, 400);
    r = await api("PATCH", `/api/servers/${srv.id}`, { host: "-oProxyCommand=id" });
    assert.equal(r.status, 400);
    r = await api("PATCH", `/api/servers/${srv.id}`, { password: "hunter2" });
    assert.equal(r.status, 400);

    r = await api("PATCH", `/api/servers/${srv.id}`, { port: fx.port + 1 });
    assert.equal(
      r.data.host_key_pinned,
      false,
      "a different address needs its key confirmed again",
    );
    assert.equal(r.data.status, "provisioning");
    r = await api("PATCH", `/api/servers/${srv.id}`, { port: fx.port });
    assert.equal(r.data.host_key_pinned, false);
  },
);

test("the bootstrap script authorises the public key and is safe to paste", { skip }, async () => {
  const added = await api("POST", "/api/servers", {
    name: "Rm -rf; $(touch /tmp/x) `id`",
    host: "deploy.example.com",
    username: "deploy",
  });
  assert.equal(added.status, 201, added.text);
  const sh = await fetch(`${engine.base}/api/servers/${added.data.id}/bootstrap`, {
    headers: { authorization: `Bearer ${admin}`, "x-forwarded-for": "203.0.113.7" },
  }).then((r) => r.text());
  assert.ok(sh.includes(added.data.public_key));
  assert.match(sh, /usermod -aG docker deploy/);
  assert.ok(!sh.includes("$(touch"), "the server name cannot inject shell");
  assert.ok(!sh.includes("`id`"));
  const syntax = spawnSync("bash", ["-n"], { input: sh, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  await api("DELETE", `/api/servers/${added.data.id}`);
});

test("pasted keys are validated; passwords are refused", { skip }, async () => {
  let r = await api("POST", "/api/servers", {
    name: "bad",
    host: "a.example.com",
    private_key: "not a key",
  });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/servers", { name: "pw", host: "a.example.com", password: "x" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /SSH key/);
  r = await api("POST", "/api/servers", { name: "x", host: "bad host!", username: "u" });
  assert.equal(r.status, 400);
});

test("scanning a port nobody listens on reports it instead of hanging", { skip }, async () => {
  const added = await api("POST", "/api/servers", {
    name: "closed",
    host: "127.0.0.1",
    port: 1,
    type: "remote",
  });
  assert.equal(added.status, 201, added.text);
  const r = await api("GET", `/api/servers/${added.data.id}/host-key`);
  assert.equal(r.status, 502);
  assert.ok(r.data.error);
  await api("DELETE", `/api/servers/${added.data.id}`);
});

test("only admin tokens can manage servers", { skip }, async () => {
  const t = await api("POST", "/api/tokens", { name: "reader", scope: "read" });
  assert.ok([200, 201].includes(t.status), t.text);
  const read = t.data.token;
  assert.equal((await api("GET", "/api/servers", null, read)).status, 403);
  assert.equal((await api("POST", `/api/servers/${srv.id}/host-key`, {}, read)).status, 403);
});

// Where a server's key material lives: under the engine's HOME, or under a short temp directory when
// HOME is too deep for a unix socket path (the case for long temp paths, e.g. on macOS).
const keyDirs = (id) =>
  [
    join(engine.home, "ssh", id),
    ...readdirSync(tmpdir())
      .filter((n) => n.startsWith("hx-") && !n.startsWith("hx-sshd") && !n.startsWith("hx-ssh-"))
      .map((n) => join(tmpdir(), n, id.slice(-12))),
  ].filter((d) => existsSync(join(d, "id")));

test("deleting a server removes its key material", { skip }, async () => {
  assert.equal(keyDirs(srv.id).length, 1, "the key is stored in exactly one place");
  const r = await api("DELETE", `/api/servers/${srv.id}`);
  assert.equal(r.data.ok, true, r.text);
  assert.equal((await api("GET", `/api/servers/${srv.id}`)).status, 404);
  await h.until(() => keyDirs(srv.id).length === 0, 8000, "the key directory to be removed");
});

test("the engine leaves no ssh helper processes behind when it stops", { skip }, async () => {
  const before = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  await engine.stop();
  await new Promise((r) => setTimeout(r, 1200));
  const left = spawnSync("pgrep", ["-f", "ssh-bridge-worker"], { encoding: "utf8" }).stdout.trim();
  assert.equal(left, "", "no bridge worker survives the engine");
  assert.ok(before.length > 0);
});
