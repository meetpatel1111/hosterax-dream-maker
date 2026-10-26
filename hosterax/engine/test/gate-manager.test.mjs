import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import { initSecrets } from "../src/secrets.mjs";
import { GateManager } from "../src/gate-manager.mjs";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-gate-"));
initSecrets(HOME);

// The "app": records what it is sent, sets its own cookie, echoes bodies, and speaks WebSocket.
let app;
let appPort;
const seen = [];
let wss;
before(async () => {
  app = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader("set-cookie", "app_session=abc; Path=/");
      res.setHeader("x-app", "yes");
      res.end(req.url === "/echo" ? body : `app says hello to ${req.url}`);
    });
  });
  wss = new WebSocketServer({ server: app });
  wss.on("connection", (ws) => ws.on("message", (m) => ws.send(`echo:${m}`)));
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  appPort = app.address().port;
});
after(async () => {
  wss.close();
  await new Promise((r) => app.close(r));
  fs.rmSync(HOME, { recursive: true, force: true });
});

let clock = 1_000_000;
async function make({
  project = "shop",
  password = "correct horse",
  db = new Database(":memory:"),
  upstream,
} = {}) {
  const moved = [];
  const g = new GateManager({
    db,
    iterations: 1000,
    now: () => clock,
    upstream: upstream ?? (() => appPort),
    onPortChange: (p, port) => moved.push([p, port]),
  });
  const port = await g.enable(project, password);
  g.moved = moved;
  g.url = `http://127.0.0.1:${port}`;
  return g;
}
const post = (url, form, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form),
    redirect: "manual",
  });
const cookieOf = (res) => res.headers.get("set-cookie")?.split(";")[0];
async function login(g, password = "correct horse", next = "/") {
  const r = await post(`${g.url}/__hx_gate/login`, { password, next });
  return { res: r, cookie: cookieOf(r) };
}

test("without the password nothing reaches the app: browsers get the form, everything else a 401", async () => {
  seen.length = 0;
  const g = await make();
  try {
    const page = await fetch(`${g.url}/dashboard?x=1`, { headers: { accept: "text/html" } });
    assert.equal(page.status, 401);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const html = await page.text();
    assert.match(html, /type="password"/);
    assert.match(html, /name="next" value="\/dashboard\?x=1"/);
    const api = await fetch(`${g.url}/api/data`, { headers: { accept: "application/json" } });
    assert.equal(api.status, 401);
    const put = await fetch(`${g.url}/api/data`, { method: "POST", body: "x" });
    assert.equal(put.status, 401);
    assert.equal(seen.length, 0, "the app never saw any of it");
  } finally {
    await g.stop();
  }
});

test("a wrong password is refused; the right one gives a cookie and the app is proxied faithfully", async () => {
  seen.length = 0;
  const g = await make();
  try {
    const wrong = await login(g, "wrong password");
    assert.equal(wrong.res.status, 401);
    assert.match(await wrong.res.text(), /not right/);
    assert.equal(wrong.cookie, undefined);

    const ok = await login(g, "correct horse", "/inside?y=2");
    assert.equal(ok.res.status, 303);
    assert.equal(ok.res.headers.get("location"), "/inside?y=2");
    const setCookie = ok.res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/, "not over plain http");

    const r = await fetch(`${g.url}/inside?y=2`, {
      headers: { cookie: `${ok.cookie}; theme=dark`, "x-custom": "1" },
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "app says hello to /inside?y=2");
    assert.equal(r.headers.get("x-app"), "yes");
    assert.match(
      r.headers.get("set-cookie"),
      /app_session=abc/,
      "the app's own cookies pass through",
    );
    const got = seen.at(-1);
    assert.equal(got.headers["x-custom"], "1");
    assert.equal(
      got.headers.cookie,
      "theme=dark",
      "the gate's session cookie is not handed to the app",
    );
    assert.match(got.headers["x-forwarded-for"], /127\.0\.0\.1/);
    assert.equal(got.headers["x-forwarded-proto"], "http");

    // bodies stream both ways
    const big = Buffer.alloc(1024 * 1024, "x");
    const echoed = await fetch(`${g.url}/echo`, {
      method: "POST",
      body: big,
      headers: { cookie: ok.cookie },
    });
    assert.equal((await echoed.arrayBuffer()).byteLength, big.length);

    // Secure is set behind a TLS edge
    const behind = await post(
      `${g.url}/__hx_gate/login`,
      { password: "correct horse" },
      { "x-forwarded-proto": "https" },
    );
    assert.match(behind.headers.get("set-cookie"), /; Secure/);
  } finally {
    await g.stop();
  }
});

test("a forged, altered, expired or cross-project cookie is worthless", async () => {
  seen.length = 0;
  const db = new Database(":memory:");
  const a = await make({ project: "shop", db });
  const b = await make({ project: "blog", password: "another password", db });
  try {
    const { cookie } = await login(a);
    const name = cookie.split("=")[0];
    const value = cookie.slice(name.length + 1);
    const [payload, sig] = value.split(".");
    const tries = {
      // always a different character: overwriting the end with a fixed string leaves a signature that
      // happens to end that way unchanged (about one run in a thousand), and then it is rightly accepted
      "signature flipped": `${name}=${payload}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`,
      "payload altered": `${name}=${Buffer.from(JSON.stringify({ p: "shop", exp: clock + 9e9, n: "x" })).toString("base64url")}.${sig}`,
      "no signature": `${name}=${payload}`,
      garbage: `${name}=not-a-token`,
    };
    for (const [what, c] of Object.entries(tries)) {
      const r = await fetch(`${a.url}/x`, { headers: { cookie: c } });
      assert.equal(r.status, 401, what);
    }
    assert.equal(seen.length, 0);
    // a valid session for shop does not open blog, even with the cookie renamed
    const blogName = b._cookieName("blog");
    const cross = await fetch(`${b.url}/x`, { headers: { cookie: `${blogName}=${value}` } });
    assert.equal(cross.status, 401);
    assert.equal((await fetch(`${a.url}/x`, { headers: { cookie } })).status, 200);
    // expiry
    clock += 13 * 60 * 60 * 1000;
    assert.equal(
      (await fetch(`${a.url}/x`, { headers: { cookie } })).status,
      401,
      "after 12 hours it is over",
    );
  } finally {
    await a.stop();
    await b.stop();
  }
});

test("the page can only send you back to this same site", async () => {
  const g = await make();
  try {
    for (const evil of [
      "//evil.example/x",
      "https://evil.example/",
      "/\\evil.example",
      "/ok\r\nSet-Cookie: x=1",
    ]) {
      const { res } = await login(g, "correct horse", evil);
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), "/", JSON.stringify(evil));
    }
    const html = await (await fetch(`${g.url}/p`, { headers: { accept: "text/html" } })).text();
    const inject = await (
      await fetch(`${g.url}/"><script>alert(1)</script>`, { headers: { accept: "text/html" } })
    ).text();
    assert.ok(!inject.includes("<script>alert(1)"), "the form echoes the path escaped");
    assert.match(html, /value="\/p"/);
  } finally {
    await g.stop();
  }
});

test("guessing is slowed: five failures lock a visitor out for a while, others are unaffected", async () => {
  const g = await make();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login(g, `guess ${i}`)).res.status, 401);
    const blocked = await login(g, "correct horse");
    assert.equal(blocked.res.status, 429, "even the right password waits");
    assert.ok(Number(blocked.res.headers.get("retry-after")) > 0);
    // a different visitor (the edge forwards who it is)
    const other = await post(
      `${g.url}/__hx_gate/login`,
      { password: "correct horse" },
      { "x-forwarded-for": "198.51.100.9" },
    );
    assert.equal(other.status, 303);
    clock += 16 * 60 * 1000;
    assert.equal(
      (await login(g, "correct horse")).res.status,
      303,
      "after the window it works again",
    );
  } finally {
    await g.stop();
  }
});

test("WebSockets pass through only with a session", async () => {
  const g = await make();
  try {
    const wsUrl = g.url.replace("http", "ws");
    await assert.rejects(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}/live`);
        ws.on("open", () => resolve());
        ws.on("error", reject);
        ws.on("unexpected-response", (_r, res) => reject(new Error(`status ${res.statusCode}`)));
      }),
      /status 401/,
    );
    const { cookie } = await login(g);
    const msg = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/live`, { headers: { cookie } });
      ws.on("open", () => ws.send("hi"));
      ws.on("message", (m) => (ws.close(), resolve(String(m))));
      ws.on("error", reject);
    });
    assert.equal(msg, "echo:hi");
  } finally {
    await g.stop();
  }
});

test("a new password signs everyone out; the password is never stored", async () => {
  const db = new Database(":memory:");
  const g = await make({ db });
  try {
    const { cookie } = await login(g);
    assert.equal((await fetch(`${g.url}/x`, { headers: { cookie } })).status, 200);
    const port = g.portFor("shop");
    await g.enable("shop", "a brand new password");
    assert.equal(g.portFor("shop"), port, "same address");
    assert.equal((await fetch(`${g.url}/x`, { headers: { cookie } })).status, 401);
    assert.equal((await login(g, "correct horse")).res.status, 401, "the old password is gone");
    assert.equal((await login(g, "a brand new password")).res.status, 303);
    const row = JSON.stringify(db.prepare("SELECT * FROM project_gates").get());
    assert.ok(!row.includes("a brand new password") && !row.includes("correct horse"));
    await assert.rejects(g.enable("shop", "short"), /at least 8/);
    await assert.rejects(g.enable("shop", "x".repeat(201)), /too long/);
  } finally {
    await g.stop();
  }
});

test("the gate keeps its address across restarts, moves if it is taken, and closes when switched off", async () => {
  const db = new Database(":memory:");
  const g1 = await make({ db });
  const port = g1.portFor("shop");
  await g1.stop();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), /fetch failed/);

  const g2 = new GateManager({
    db,
    iterations: 1000,
    upstream: () => appPort,
    onPortChange: () => {},
  });
  await g2.start();
  assert.equal(g2.portFor("shop"), port, "it comes back where it was");
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 401);
  await g2.stop();

  // something else took the port in the meantime
  const squatter = net.createServer().listen(port, "127.0.0.1");
  await new Promise((r) => squatter.once("listening", r));
  const moved = [];
  const g3 = new GateManager({
    db,
    iterations: 1000,
    upstream: () => appPort,
    onPortChange: (p, n) => moved.push([p, n]),
  });
  await g3.start();
  assert.notEqual(g3.portFor("shop"), port);
  assert.deepEqual(moved, [["shop", g3.portFor("shop")]], "routes are told about the new port");
  const newPort = g3.portFor("shop");
  await new Promise((r) => squatter.close(r));

  await g3.disable("shop");
  assert.equal(g3.isEnabled("shop"), false);
  assert.equal(g3.portFor("shop"), null);
  await assert.rejects(fetch(`http://127.0.0.1:${newPort}/`), /fetch failed/);
  assert.deepEqual(moved.at(-1), ["shop", null]);
});

test("if the app is not answering the visitor sees a 502, not a hang", async () => {
  const g = await make({ upstream: () => 1 });
  try {
    const { cookie } = await login(g);
    const r = await fetch(`${g.url}/x`, { headers: { cookie } });
    assert.equal(r.status, 502);
    const none = await make({ project: "empty", upstream: () => null });
    const { cookie: c2 } = await login(none);
    assert.equal((await fetch(`${none.url}/x`, { headers: { cookie: c2 } })).status, 502);
    await none.stop();
  } finally {
    await g.stop();
  }
});

test("logging out clears the cookie", async () => {
  const g = await make();
  try {
    const r = await fetch(`${g.url}/__hx_gate/logout`, { method: "POST", redirect: "manual" });
    assert.equal(r.status, 303);
    assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  } finally {
    await g.stop();
  }
});
