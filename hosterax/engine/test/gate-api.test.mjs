// End-to-end: a password in front of an app, through a real engine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-gate-api-");
let app;
let appPort;
let engine;
let admin;
const hits = [];
const api = (method, path, body, token = admin) => h.call(engine, token, method, path, body);

// A tunnel "program" that only prints an address containing the port it was told to expose.
const STUB = join(h.scratch, "stub.mjs");
writeFileSync(
  STUB,
  `console.log("tunnel at https://port-" + process.argv[2] + ".example.net"); setInterval(() => {}, 1000);\n`,
);

before(async () => {
  app = http.createServer((req, res) => {
    hits.push(req.url);
    res.end("the secret app");
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  appPort = app.address().port;
  engine = await h.startEngine({
    env: {
      HOSTERAX_GATE_ITERATIONS: "1000",
      HOSTERAX_ALLOW_CUSTOM_TUNNELS: "1",
      HOSTERAX_TUNNEL_PROBE: "0",
      HOSTERAX_BIND_HOST: "127.0.0.1",
    },
  });
  admin = engine.bootstrap;
  await api("POST", "/api/projects", {
    name: "vault",
    source: "x",
    target: "process",
    port: appPort,
  });
});
after(async () => {
  await h.cleanup();
  await new Promise((r) => app.close(r));
});

const get = (port, path = "/", init = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...init });
let gatePort;

test("turning the gate on puts a password in front of the route", async () => {
  assert.equal((await api("GET", "/api/projects/vault/gate")).data.enabled, false);
  const short = await api("PUT", "/api/projects/vault/gate", { password: "short" });
  assert.equal(short.status, 400);
  const on = await api("PUT", "/api/projects/vault/gate", { password: "open sesame please" });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.data.enabled, true);
  assert.ok(!on.text.includes("open sesame"));
  gatePort = on.data.port;
  assert.notEqual(gatePort, appPort);

  const project = (await api("GET", "/api/projects/vault")).data;
  assert.equal(
    project.route.upstream_port,
    gatePort,
    "the edge is pointed at the gate, not the app",
  );

  hits.length = 0;
  assert.equal((await get(gatePort, "/", { headers: { accept: "text/html" } })).status, 401);
  assert.deepEqual(hits, [], "the app was not reached");
  const login = await get(gatePort, "/__hx_gate/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "password=open+sesame+please",
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const inside = await get(gatePort, "/x", { headers: { cookie } });
  assert.equal(await inside.text(), "the secret app");
  assert.deepEqual(hits, ["/x"]);
});

test("a public address is made for the gate, never around it", async () => {
  const created = await api("POST", "/api/tunnels", {
    target: "vault",
    provider: "custom",
    options: {
      command: `"${process.execPath}" "${STUB}" {port}`,
      urlPattern: "tunnel at (https://\\S+)",
    },
  });
  assert.equal(created.status, 201, created.text);
  const t = await h.until(
    async () => {
      const x = (await api("GET", `/api/tunnels/${created.data.id}`)).data;
      return x.status === "running" ? x : null;
    },
    20000,
    "the tunnel to start",
  );
  assert.equal(t.publicUrl, `https://port-${gatePort}.example.net`, "it exposes the gate's port");
  assert.notEqual(t.publicUrl, `https://port-${appPort}.example.net`);
});

test("only people who may deploy can set a password; reading the state needs less", async () => {
  const mint = async (scope) =>
    (await api("POST", "/api/tokens", { name: scope, scopes: [scope] })).data.token;
  const read = await mint("read");
  assert.equal((await api("GET", "/api/projects/vault/gate", null, read)).status, 200);
  assert.equal(
    (await api("PUT", "/api/projects/vault/gate", { password: "another long one" }, read)).status,
    403,
  );
  assert.equal((await api("DELETE", "/api/projects/vault/gate", null, read)).status, 403);
  assert.equal(
    (await api("PUT", "/api/projects/nope/gate", { password: "another long one" })).status,
    404,
  );
});

test("the gate survives an engine restart on the same port", async () => {
  await engine.stop();
  engine = await h.startEngine({
    home: engine.home,
    port: engine.port,
    env: { HOSTERAX_GATE_ITERATIONS: "1000", HOSTERAX_BIND_HOST: "127.0.0.1" },
  });
  await h.until(
    async () =>
      (await get(gatePort, "/", { headers: { accept: "text/html" } }).catch(() => null))?.status ===
      401,
    15000,
    "the gate to come back",
  );
  assert.equal((await api("GET", "/api/projects/vault/gate")).data.port, gatePort);
});

test("turning the gate off sends traffic straight to the app again and closes the gate", async () => {
  const off = await api("DELETE", "/api/projects/vault/gate");
  assert.equal(off.status, 200);
  assert.equal((await api("GET", "/api/projects/vault")).data.route.upstream_port, appPort);
  await assert.rejects(get(gatePort), /fetch failed/);
  assert.equal((await api("GET", "/api/projects/vault/gate")).data.enabled, false);
});

test("the command line sets, shows and removes the password without it appearing in arguments", async () => {
  const CLI = fileURLToPath(new URL("../../cli/src/cli.mjs", import.meta.url));
  const cli = (args, input = "") =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, HOSTERAX_URL: engine.base, HOSTERAX_TOKEN: admin, HOME: h.scratch },
    });
  assert.match(cli(["gate", "vault"]).stdout, /no password/);
  const on = cli(["gate", "vault", "--password-stdin"], "a password from stdin\n");
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /now asks visitors for a password/);
  assert.match(cli(["gate", "vault"]).stdout, /ON \(gate port \d+\)/);
  const port = (await api("GET", "/api/projects/vault/gate")).data.port;
  const login = await get(port, "/__hx_gate/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "password=a+password+from+stdin",
  });
  assert.equal(
    login.status,
    303,
    "the password read from stdin is the one that works (no trailing newline)",
  );
  assert.equal(cli(["gate", "vault", "--password-stdin"], "short\n").status, 1);
  assert.match(cli(["gate", "vault", "--off"]).stdout, /no longer asks/);
});
