// End-to-end: a real engine telling a receiver what happened.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHarness } from "./helpers/engine-harness.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";

const h = createHarness("hosterax-notify-api-");
let receiver;
let hook;
const got = [];
let engine;
let admin;
const api = (method, path, body, token = admin) => h.call(engine, token, method, path, body);

before(async () => {
  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        got.push(JSON.parse(body));
      } catch {}
      res.end("ok");
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
  hook = `http://127.0.0.1:${receiver.address().port}/hook`;
  engine = await h.startEngine({ env: { HOSTERAX_SERVER_POLL_MS: "800" } });
  admin = engine.bootstrap;
});
after(async () => {
  await h.cleanup();
  await new Promise((r) => receiver.close(r));
});

let channel;
test("channels are managed by admins, listed without their secrets, and can be tested", async () => {
  const bad = await api("POST", "/api/notifications", {
    name: "x",
    type: "webhook",
    url: "ftp://nope",
  });
  assert.equal(bad.status, 400);
  const created = await api("POST", "/api/notifications", {
    name: "ops",
    type: "webhook",
    url: hook,
    secret: "topsecret",
  });
  assert.equal(created.status, 201, created.text);
  channel = created.data;
  assert.equal(channel.signed, true);
  const listing = await api("GET", "/api/notifications");
  assert.ok(!listing.text.includes("topsecret"));
  assert.ok(listing.data.events["deploy.failed"]);
  assert.deepEqual(listing.data.types.sort(), ["discord", "email", "ntfy", "slack", "webhook"]);

  const reader = (await api("POST", "/api/tokens", { name: "r", scopes: ["read"] })).data.token;
  assert.equal((await api("GET", "/api/notifications", null, reader)).status, 403);

  got.length = 0;
  const t = await api("POST", `/api/notifications/${channel.id}/test`);
  assert.equal(t.data.ok, true, t.text);
  assert.equal(got[0].kind, "test");
});

test("a failed deployment is reported with its project and the reason", async () => {
  got.length = 0;
  await api("POST", "/api/projects", {
    name: "broken-app",
    source: "/nonexistent/path/for/test",
    target: "process",
  });
  const dep = await api("POST", "/api/projects/broken-app/deploy", {});
  assert.equal(dep.status, 200, dep.text);
  const msg = await h.until(
    () => got.find((m) => m.kind === "deploy.failed"),
    20000,
    "the failure notice",
  );
  assert.equal(msg.project, "broken-app");
  assert.match(msg.title, /Deploy of broken-app failed/);
  assert.equal(msg.severity, "error");
  assert.equal(
    got.filter((m) => m.kind === "deploy.failed").length,
    1,
    "once, not once per phase change",
  );
});

test("channels can be edited, switched off and removed", async () => {
  const off = await api("PATCH", `/api/notifications/${channel.id}`, { enabled: false });
  assert.equal(off.data.enabled, false);
  got.length = 0;
  await api("POST", "/api/projects", {
    name: "broken-2",
    source: "/nonexistent/other",
    target: "process",
  });
  await api("POST", "/api/projects/broken-2/deploy", {});
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(
    got.filter((m) => m.kind === "deploy.failed").length,
    0,
    "a disabled channel stays silent",
  );
  assert.equal((await api("DELETE", `/api/notifications/${channel.id}`)).status, 200);
  assert.equal((await api("DELETE", `/api/notifications/${channel.id}`)).status, 404);
});

const skip = sshToolsAvailable() ? false : "OpenSSH client/server is not installed";
test(
  "a server going down is reported, and so is its recovery when asked for",
  { skip },
  async () => {
    const fx = await startSshFixture();
    try {
      const ch = (
        await api("POST", "/api/notifications", {
          name: "servers",
          type: "webhook",
          url: hook,
          events: ["server.down", "server.up"],
        })
      ).data;
      const srv = (
        await api("POST", "/api/servers", {
          name: "Edge VPS",
          type: "remote",
          host: fx.host,
          port: fx.port,
          username: fx.username,
        })
      ).data;
      const scan = (await api("GET", `/api/servers/${srv.id}/host-key`)).data;
      await api("POST", `/api/servers/${srv.id}/host-key`, {
        fingerprint: scan.keys[0].fingerprint,
      });
      fx.authorizeKey(srv.public_key);
      assert.equal((await api("POST", `/api/servers/${srv.id}/test`)).data.ok, true);

      got.length = 0;
      fx.dockerMode("down");
      const down = await h.until(
        () => got.find((m) => m.kind === "server.down"),
        15000,
        "the server.down notice",
      );
      assert.match(down.title, /Edge VPS/);
      assert.match(down.text, /Docker/);

      fx.dockerMode("ok");
      const up = await h.until(
        () => got.find((m) => m.kind === "server.up"),
        15000,
        "the server.up notice",
      );
      assert.match(up.title, /Edge VPS/);
      await api("DELETE", `/api/notifications/${ch.id}`);
      await api("DELETE", `/api/servers/${srv.id}`);
    } finally {
      await fx.stop();
    }
  },
);
