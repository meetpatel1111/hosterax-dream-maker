import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "hx-dash-"));
const bundle = path.join(parent, "bundle");
fs.mkdirSync(path.join(bundle, "assets"), { recursive: true });
fs.writeFileSync(path.join(bundle, "index.html"), "<!doctype html><title>shell</title>");
fs.writeFileSync(path.join(bundle, "assets", "app.js"), "console.log(1)");
fs.writeFileSync(path.join(parent, "secret.txt"), "top-secret");

process.env.HOSTERAX_DASHBOARD_DIR = bundle;
const { createDashboard } = await import("../src/dashboard-server.mjs");

let server;
let base;
const dashboard = createDashboard();

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (await dashboard.handle(req, res, pathname)) return;
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("engine-404");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  dashboard.close();
  server.close();
  fs.rmSync(parent, { recursive: true, force: true });
});

// Plain http.get keeps percent-encoded dot segments exactly as written.
const raw = (p, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = http.request(base + p, { method }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });

test("dashboard serves the shell for the root and client-side routes", async () => {
  for (const p of ["/", "/dashboard", "/p/my-app"]) {
    const r = await raw(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, /<title>shell<\/title>/);
    assert.match(
      r.headers["server-timing"],
      /hosterax/,
      "the page must say it was served by the engine",
    );
  }
});

test("dashboard serves hashed assets with long-lived caching", async () => {
  const r = await raw("/assets/app.js");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /javascript/);
  assert.match(r.headers["cache-control"], /immutable/);
});

test("dashboard never answers for engine API paths or non-GET methods", async () => {
  for (const p of ["/api/projects", "/api", "/health", "/ws", "/webhooks/github"]) {
    const r = await raw(p);
    assert.equal(r.body, "engine-404", p);
  }
  assert.equal((await raw("/", "POST")).body, "engine-404");
});

test("dashboard does not serve files outside its directory", async () => {
  for (const p of ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%2f..%2fsecret.txt"]) {
    const r = await raw(p);
    assert.doesNotMatch(r.body, /top-secret/, p);
  }
});
