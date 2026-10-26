import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSecrets } from "../src/secrets.mjs";
import { NotificationManager, EVENT_KINDS, assertNotifyUrl } from "../src/notification-manager.mjs";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-notify-"));
initSecrets(HOME);

// A receiver that records every request and answers with whatever status the test asks for.
let receiver;
let base;
let status = 200;
const got = [];
before(async () => {
  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      got.push({ url: req.url, headers: req.headers, body });
      if (req.url.startsWith("/redirect")) {
        res.writeHead(302, { location: "/elsewhere" });
        return res.end();
      }
      res.writeHead(status);
      res.end("ok");
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${receiver.address().port}`;
});
after(async () => {
  await new Promise((r) => receiver.close(r));
  fs.rmSync(HOME, { recursive: true, force: true });
});

let clock = 1_000_000;
const make = (extra = {}) => {
  const db = new Database(":memory:");
  const mails = [];
  const m = new NotificationManager({
    db,
    now: () => clock,
    sendEmail: async (mail) => mails.push(mail),
    ...extra,
  });
  m.mails = mails;
  return m;
};
const reset = () => {
  got.length = 0;
  status = 200;
};

test("a webhook gets a JSON event, signed when a secret is set", async () => {
  reset();
  const n = make();
  n.create({ name: "ops", type: "webhook", url: `${base}/hook`, secret: "s3cret" });
  await n.notify("deploy.failed", {
    title: "Deploy of shop failed (v0.3.0)",
    text: "build error",
    project: "shop",
  });
  assert.equal(got.length, 1);
  const body = JSON.parse(got[0].body);
  assert.equal(body.source, "hosterax");
  assert.equal(body.kind, "deploy.failed");
  assert.equal(body.project, "shop");
  assert.equal(body.severity, "error");
  const sig = crypto.createHmac("sha256", "s3cret").update(got[0].body).digest("hex");
  assert.equal(got[0].headers["x-hosterax-signature"], `sha256=${sig}`);
});

test("Slack, Discord and ntfy get the shape each of them expects", async () => {
  reset();
  const n = make();
  n.create({ name: "s", type: "slack", url: `${base}/slack` });
  n.create({ name: "d", type: "discord", url: `${base}/discord` });
  n.create({ name: "n", type: "ntfy", url: `${base}/ntfy` });
  await n.notify("server.down", {
    title: "A server became unreachable: Frankfurt",
    text: "Connection refused",
    project: "Frankfurt",
  });
  const by = Object.fromEntries(got.map((g) => [g.url, g]));
  assert.match(
    JSON.parse(by["/slack"].body).text,
    /\*A server became unreachable: Frankfurt\*\nConnection refused/,
  );
  assert.match(
    JSON.parse(by["/discord"].body).content,
    /\*\*A server became unreachable: Frankfurt\*\*/,
  );
  assert.equal(by["/ntfy"].body, "Connection refused");
  assert.equal(by["/ntfy"].headers.priority, "high");
  assert.match(by["/ntfy"].headers.title, /server became unreachable/);
});

test("email goes through the send function with every recipient", async () => {
  const n = make();
  n.create({ name: "mail", type: "email", to: "a@example.com, b@example.com" });
  await n.notify("backup.failed", {
    title: "A scheduled backup failed: shop",
    text: "disk full",
    project: "shop",
  });
  assert.equal(n.mails.length, 1);
  assert.deepEqual(n.mails[0].to, ["a@example.com", "b@example.com"]);
  assert.match(n.mails[0].subject, /^\[HosteraX\] A scheduled backup failed/);
  assert.throws(
    () => n.create({ name: "bad", type: "email", to: "not-an-address" }),
    /valid email/,
  );
  assert.throws(() => n.create({ name: "none", type: "email", to: "" }), /1 to 10/);
});

test("a channel only hears what it subscribed to; quiet events are off unless asked for", async () => {
  reset();
  const n = make();
  n.create({ name: "all", type: "webhook", url: `${base}/all` });
  n.create({
    name: "deploys",
    type: "webhook",
    url: `${base}/deploys`,
    events: ["deploy.failed", "deploy.succeeded"],
  });
  await n.notify("server.down", { title: "x", project: "a" });
  await n.notify("deploy.succeeded", { title: "ok", project: "a", severity: "info" });
  await n.notify("server.up", { title: "up", project: "a", severity: "info" });
  const urls = got.map((g) => g.url).sort();
  assert.deepEqual(
    urls,
    ["/all", "/deploys"],
    "server.down -> all only; deploy.succeeded -> deploys only; server.up -> nobody",
  );
  assert.throws(
    () => n.create({ name: "typo", type: "webhook", url: `${base}/x`, events: ["deploy.faild"] }),
    /events must be/,
  );
});

test("a flapping app does not flood: the same event for the same project is sent once in ten minutes", async () => {
  reset();
  const n = make();
  n.create({ name: "ops", type: "webhook", url: `${base}/flap` });
  for (let i = 0; i < 5; i++)
    await n.notify("project.unhealthy", { title: "crash", project: "api" });
  assert.equal(got.length, 1);
  await n.notify("project.unhealthy", { title: "crash", project: "worker" });
  assert.equal(got.length, 2, "another project is a different event");
  clock += 11 * 60 * 1000;
  await n.notify("project.unhealthy", { title: "crash", project: "api" });
  assert.equal(got.length, 3, "after ten minutes it is news again");
  // outcomes of single deployments are never merged
  await n.notify("deploy.failed", { title: "a", project: "api" });
  await n.notify("deploy.failed", { title: "b", project: "api" });
  assert.equal(got.length, 5);
});

test("engine events map onto notification kinds", async () => {
  reset();
  const n = make();
  n.create({ name: "ops", type: "webhook", url: `${base}/map` });
  const ev = (eventType, status, project = "shop", details = "details") => ({
    eventType,
    status,
    project,
    details,
  });
  await n.fromEvent(ev("crashloop_detected", "error"));
  await n.fromEvent(
    ev("server_status", "error", "Frankfurt", "went from online to error: Docker is down"),
  );
  await n.fromEvent(ev("tunnel_failed", "failed"));
  await n.fromEvent(ev("backup_failed", "failed"));
  await n.fromEvent(ev("daemon_unresponsive", "error", "system"));
  await n.fromEvent(ev("config_updated", "info")); // not worth a message
  await n.fromEvent(ev("server_status", "info", "Frankfurt")); // server.up is off by default
  const kinds = got.map((g) => JSON.parse(g.body).kind).sort();
  assert.deepEqual(kinds, [
    "backup.failed",
    "project.unhealthy",
    "server.down",
    "system.docker",
    "tunnel.failed",
  ]);
  assert.equal(
    JSON.parse(got.find((g) => JSON.parse(g.body).kind === "system.docker").body).project,
    null,
    "'system' is not a project",
  );
});

test("a channel that fails is marked, retried once on a server error, and never throws", async () => {
  reset();
  status = 500;
  const n = make();
  const ch = n.create({ name: "flaky", type: "webhook", url: `${base}/flaky` });
  const t0 = Date.now();
  await n.notify("deploy.failed", { title: "x", project: "a" });
  assert.equal(got.length, 2, "one retry after a 5xx");
  assert.ok(Date.now() - t0 >= 1400);
  let v = n.get(ch.id);
  assert.equal(v.lastStatus, "failed");
  assert.match(v.lastError, /answered 500/);

  reset();
  status = 404;
  await n.notify("deploy.failed", { title: "y", project: "a" });
  assert.equal(got.length, 1, "no retry for a 4xx");

  reset();
  status = 200;
  assert.equal((await n.test(ch.id)).ok, true);
  v = n.get(ch.id);
  assert.equal(v.lastStatus, "ok");
  assert.equal(v.lastError, null);
  assert.equal(JSON.parse(got[0].body).kind, "test");
  assert.ok(n.recentLog().some((l) => l.status === "failed"));
  assert.ok(n.recentLog().some((l) => l.status === "sent"));
});

test("a redirect is not followed and an unreachable URL is reported", async () => {
  reset();
  const n = make();
  const redirecting = n.create({ name: "r", type: "webhook", url: `${base}/redirect` });
  const r = await n.test(redirecting.id);
  assert.equal(r.ok, false);
  assert.match(r.error, /redirects/);
  assert.equal(got.length, 1, "the redirect target was never requested");
  const dead = n.create({ name: "dead", type: "webhook", url: "http://127.0.0.1:1/hook" });
  const d = await n.test(dead.id);
  assert.equal(d.ok, false);
  assert.ok(d.error);
});

test("URLs are checked, and secrets are never listed or stored in the clear", () => {
  const db = new Database(":memory:");
  const n = new NotificationManager({ db });
  for (const bad of [
    "ftp://x.example.com/a",
    "not a url",
    "http://169.254.169.254/latest",
    "http://metadata.google.internal/x",
  ])
    assert.throws(() => assertNotifyUrl(bad), /URL/);
  const c = n.create({
    name: "slack",
    type: "slack",
    url: "https://hooks.slack.com/services/T000/B000/SECRETSECRET",
  });
  const listed = JSON.stringify(n.list());
  assert.ok(!listed.includes("SECRETSECRET"));
  assert.ok(!listed.includes("T000"));
  const raw = db.prepare("SELECT config FROM notification_channels").get().config;
  assert.ok(!raw.includes("SECRETSECRET"), "stored encrypted");
  // editing without resending the URL keeps it; the masked value is never written back
  const edited = n.update(c.id, { name: "renamed", url: n.get(c.id).target });
  assert.equal(edited.name, "renamed");
  const cfg = JSON.parse(
    JSON.stringify(db.prepare("SELECT config FROM notification_channels").get()),
  );
  assert.ok(cfg.config.startsWith("enc:v1:"));
  assert.equal(n.update(c.id, { enabled: false }).enabled, false);
  assert.equal(n.remove(c.id), true);
  assert.equal(n.remove(c.id), false);
});

test("a disabled channel is silent, and bad input is refused", async () => {
  reset();
  const n = make();
  const c = n.create({ name: "off", type: "webhook", url: `${base}/off` });
  n.update(c.id, { enabled: false });
  await n.notify("deploy.failed", { title: "x", project: "a" });
  assert.equal(got.length, 0);
  assert.throws(() => n.create({ name: "", type: "webhook", url: base }), /name/);
  assert.throws(() => n.create({ name: "x", type: "pager", url: base }), /type must be/);
  assert.throws(() => n.create({ name: "x", type: "webhook" }), /url is required/);
  assert.throws(() => n.update("nope", { name: "x" }), /not found/);
  await n.notify("not.a.kind", {}); // ignored, no throw
  assert.ok(Object.keys(EVENT_KINDS).length >= 8);
});

test("email without a relay reports why instead of failing silently", async () => {
  const n = new NotificationManager({ db: new Database(":memory:"), now: () => clock });
  const c = n.create({ name: "mail", type: "email", to: "a@example.com" });
  const r = await n.test(c.id);
  assert.equal(r.ok, false);
  assert.match(r.error, /SMTP relay/);
});
