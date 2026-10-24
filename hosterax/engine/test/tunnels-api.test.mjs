import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const engineDir = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "hosterax-tunnels-api-"));
const engines = [];

// Nothing the engine could start from PATH (ssh, cloudflared, docker…) exists, so these tests can
// never open a real tunnel to a real service; only the stand-in command below ever runs.
const emptyBin = join(scratch, "empty-bin");
mkdirSync(emptyBin);

// A stand-in tunnel program: records its pid, prints what it is given, and stays up.
const STUB = join(scratch, "stub.mjs");
writeFileSync(
  STUB,
  `import fs from "node:fs";
const [pidFile, ...lines] = process.argv.slice(2);
fs.writeFileSync(pidFile, String(process.pid));
for (const l of lines) console.log(l);
setInterval(() => {}, 1000);
`,
);
const q = (s) => JSON.stringify(s);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

// The address-lookup service the engine is pointed at, instead of the real internet.
let lookup;
let lookupUrl;
before(async () => {
  lookup = http.createServer((req, res) => res.end("203.0.113.50\n"));
  await new Promise((r) => lookup.listen(0, "127.0.0.1", r));
  lookupUrl = `http://127.0.0.1:${lookup.address().port}/`;
});

async function startEngine({ home = null, port = null, env = {} } = {}) {
  home ??= mkdtempSync(join(scratch, "home-"));
  port ??= await freePort();
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path"),
  );
  const child = spawn(process.execPath, ["src/index.mjs"], {
    cwd: engineDir,
    env: {
      ...clean,
      PATH: emptyBin,
      HOSTERAX_PORT: String(port),
      HOSTERAX_HOME: home,
      HOSTERAX_ALLOW_CUSTOM_TUNNELS: "1",
      HOSTERAX_TUNNEL_PROBE: "0",
      HOSTERAX_IP_LOOKUP_URLS: lookupUrl,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`engine did not start: ${output.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const engine = {
    base,
    port,
    home,
    bootstrap: /hxt_[0-9a-f]{48}/.exec(output)?.[0] ?? "",
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
        setTimeout(resolve, 4000);
      }),
  };
  engines.push(engine);
  return engine;
}

// `x-forwarded-for` stops the engine from mistaking the test for the local machine
const call = async (engine, token, method, path, body) => {
  const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${engine.base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: r.status, data, text };
};

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${fn}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

after(async () => {
  for (const e of engines) await e.stop();
  await new Promise((r) => lookup.close(r));
  rmSync(scratch, { recursive: true, force: true });
});

let engine;
let admin;
before(async () => {
  engine = await startEngine();
  admin = engine.bootstrap;
});

/** A custom tunnel whose "relay" is the stand-in program above. */
const customTunnel = (name, extra = []) => {
  const pidFile = join(scratch, `${name}.pid`);
  return {
    pidFile,
    body: (target) => ({
      target,
      provider: "custom",
      options: {
        command: `${q(process.execPath)} ${q(STUB)} ${q(pidFile)} "tunnel at https://${name}.example.net" ${extra.join(" ")}`,
        urlPattern: "tunnel at (https://\\S+)",
      },
    }),
  };
};

test("only admins can see or change public access", async () => {
  const minted = async (scope) =>
    (await call(engine, admin, "POST", "/api/tokens", { name: scope, scopes: [scope] })).data.token;
  const requests = [
    ["GET", "/api/tunnels"],
    ["GET", "/api/tunnels/providers"],
    ["POST", "/api/tunnels", { target: "edge", provider: "custom" }],
    ["GET", "/api/tunnels/abc"],
    ["DELETE", "/api/tunnels/abc"],
    ["POST", "/api/tunnels/abc/stop"],
    ["GET", "/api/expose/public-ip"],
    ["POST", "/api/expose/public-ip", {}],
    ["GET", "/api/expose/auto"],
    ["PUT", "/api/expose/auto", { enabled: true }],
  ];
  for (const scope of ["read", "deploy"]) {
    const token = await minted(scope);
    for (const [method, path, body] of requests) {
      const r = await call(engine, token, method, path, body);
      assert.equal(r.status, 403, `${scope} token: ${method} ${path} should be refused`);
    }
  }
  for (const [method, path, body] of requests) {
    const r = await call(engine, null, method, path, body);
    assert.equal(r.status, 401, `anonymous: ${method} ${path} should need a token`);
  }
  assert.equal((await call(engine, admin, "GET", "/api/tunnels")).status, 200);
});

test("the provider list covers every free option and says what this machine can run", async () => {
  const r = await call(engine, admin, "GET", "/api/tunnels/providers");
  assert.equal(r.status, 200);
  const ids = r.data.map((p) => p.id).sort();
  assert.deepEqual(
    ids,
    [
      "bore",
      "cloudflare",
      "cloudflare-token",
      "custom",
      "localhost-run",
      "localtunnel",
      "ngrok",
      "pinggy",
      "serveo",
      "tailscale",
    ].sort(),
  );
  const by = Object.fromEntries(r.data.map((p) => [p.id, p]));
  // PATH is empty, so nothing is installed here
  assert.equal(by.cloudflare.ready, false);
  assert.match(by.cloudflare.missing, /cloudflared/);
  assert.equal(by["localhost-run"].ready, false);
  assert.equal(by.cloudflare.needsAccount, false);
  assert.equal(by.ngrok.needsAccount, true);
  assert.equal(by.custom.ready, true, "custom is enabled for this engine");
  assert.ok(by.ngrok.options.find((o) => o.key === "authtoken" && o.secret));
});

test("a tunnel can be created, read, stopped, started, restarted and removed, and the process really goes", async () => {
  const t = customTunnel("life");
  const created = await call(engine, admin, "POST", "/api/tunnels", t.body("edge"));
  assert.equal(created.status, 201);
  const id = created.data.id;
  const up = await until(async () => {
    const r = await call(engine, admin, "GET", `/api/tunnels/${id}`);
    return r.data.status === "running" && r.data;
  });
  assert.equal(up.publicUrl, "https://life.example.net");
  assert.equal(up.target, "edge");
  assert.equal(up.providerUsed, "custom");

  const list = await call(engine, admin, "GET", "/api/tunnels");
  assert.ok(list.data.some((x) => x.id === id));
  const logs = await call(engine, admin, "GET", `/api/tunnels/${id}/logs`);
  assert.ok(logs.data.lines.some((l) => l.includes("tunnel at https://life.example.net")));

  const pid = Number(readFileSync(t.pidFile, "utf8"));
  assert.ok(alive(pid), "the tunnel program is running");

  const stopped = await call(engine, admin, "POST", `/api/tunnels/${id}/stop`);
  assert.equal(stopped.data.status, "stopped");
  assert.equal(stopped.data.publicUrl, null);
  await until(() => !alive(pid), 8000);

  const started = await call(engine, admin, "POST", `/api/tunnels/${id}/start`);
  assert.equal(started.status, 200);
  const again = await until(async () => {
    const r = await call(engine, admin, "GET", `/api/tunnels/${id}`);
    return r.data.status === "running" && r.data;
  });
  const pid2 = Number(readFileSync(t.pidFile, "utf8"));
  assert.notEqual(pid2, pid);

  const restarted = await call(engine, admin, "POST", `/api/tunnels/${id}/restart`);
  assert.equal(restarted.status, 200);
  await until(async () => {
    const r = await call(engine, admin, "GET", `/api/tunnels/${id}`);
    return r.data.status === "running" && Number(readFileSync(t.pidFile, "utf8")) !== pid2;
  });
  assert.ok(again.publicUrl);

  const pid3 = Number(readFileSync(t.pidFile, "utf8"));
  assert.equal((await call(engine, admin, "DELETE", `/api/tunnels/${id}`)).status, 200);
  assert.equal((await call(engine, admin, "GET", `/api/tunnels/${id}`)).status, 404);
  await until(() => !alive(pid3), 8000);
  assert.equal((await call(engine, admin, "POST", `/api/tunnels/${id}/stop`)).status, 404);
});

test("the engine itself can never be made public, whatever port the edge is set to", async () => {
  const fresh = await startEngine();
  const t = customTunnel("engineport");
  const before = await call(fresh, fresh.bootstrap, "POST", "/api/tunnels", t.body("edge"));
  assert.equal(before.status, 201, "the edge on its normal port is fine");
  await call(fresh, fresh.bootstrap, "DELETE", `/api/tunnels/${before.data.id}`);

  const set = await call(fresh, fresh.bootstrap, "POST", "/api/edge/settings", {
    http_port: fresh.port,
  });
  assert.equal(set.status, 200);
  const blocked = await call(fresh, fresh.bootstrap, "POST", "/api/tunnels", t.body("edge"));
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /belongs to the HosteraX engine/);
  assert.equal((await call(fresh, fresh.bootstrap, "GET", "/api/tunnels")).data.length, 0);
});

test("a tunnel is only created for something that exists, with options that are valid", async () => {
  const bad = async (body, pattern) => {
    const r = await call(engine, admin, "POST", "/api/tunnels", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, pattern);
  };
  await bad({ target: "../../etc", provider: "custom" }, /project name/);
  await bad({ target: "no-such-project", provider: "cloudflare" }, /does not exist/);
  await bad({ target: "edge", provider: "nope" }, /unknown provider/);
  await bad({ target: "edge", provider: "custom" }, /needs: /);
  await bad(
    { target: "edge", provider: "custom", options: { command: "x", urlPattern: "(" } },
    /regular expression/,
  );
  await bad({ target: "edge", provider: "auto", options: { token: "x" } }, /specific provider/);
  await bad({ target: "edge", provider: "ngrok", options: {} }, /authtoken/);
  await call(engine, admin, "POST", "/api/projects", { name: "someapp" });
  await bad(
    { target: "someapp", provider: "cloudflare-token", options: { token: "x".repeat(40) } },
    /edge/,
  );
});

test("custom tunnels are refused unless the machine owner switched them on", async () => {
  const off = await startEngine({ env: { HOSTERAX_ALLOW_CUSTOM_TUNNELS: "" } });
  const t = customTunnel("off");
  const r = await call(off, off.bootstrap, "POST", "/api/tunnels", t.body("edge"));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /HOSTERAX_ALLOW_CUSTOM_TUNNELS/);
  const providers = await call(off, off.bootstrap, "GET", "/api/tunnels/providers");
  assert.equal(providers.data.find((p) => p.id === "custom").ready, false);
});

test("a project that is not deployed yet is waited for, then exposed on its real port", async () => {
  const created = await call(engine, admin, "POST", "/api/projects", { name: "waitapp" });
  assert.equal(created.status, 201);
  const t = customTunnel("waiting", ["{port}"]);
  const r = await call(engine, admin, "POST", "/api/tunnels", t.body("waitapp"));
  assert.equal(r.status, 201);
  const waiting = await until(async () => {
    const x = await call(engine, admin, "GET", `/api/tunnels/${r.data.id}`);
    return x.data.status === "waiting" && x.data;
  });
  assert.match(waiting.lastError, /not been deployed/);

  // the project gets deployed: it now has a port
  const port = await freePort();
  const db = new Database(join(engine.home, "hosterax.db"));
  db.pragma("busy_timeout = 5000");
  db.prepare("UPDATE projects SET port=? WHERE name=?").run(port, "waitapp");
  db.close();
  await until(async () => {
    const x = await call(engine, admin, "GET", `/api/tunnels/${r.data.id}`);
    return x.data.status === "running";
  });
  const logs = await call(engine, admin, "GET", `/api/tunnels/${r.data.id}/logs`);
  assert.ok(logs.data.lines.includes(String(port)), "the command received the project's port");

  // deleting the project takes its tunnel with it
  const db2 = new Database(join(engine.home, "hosterax.db"));
  db2.pragma("busy_timeout = 5000");
  db2.prepare("DELETE FROM projects WHERE name=?").run("waitapp");
  db2.close();
  await until(
    async () => (await call(engine, admin, "GET", `/api/tunnels/${r.data.id}`)).status === 404,
  );
});

test("tokens are write-only: never returned and never on disk in plain text", async () => {
  const fresh = await startEngine();
  const token = "ngrok_authtoken_" + "Q".repeat(30);
  const r = await call(fresh, fresh.bootstrap, "POST", "/api/tunnels", {
    target: "edge",
    provider: "ngrok",
    options: { authtoken: token, domain: "mine.ngrok-free.app" },
  });
  assert.equal(r.status, 201);
  assert.ok(!r.text.includes(token));
  assert.deepEqual(r.data.secretsSet, ["authtoken"]);
  assert.equal(r.data.options.domain, "mine.ngrok-free.app");
  // ngrok is not installed here, so it fails, and says what to install
  const failed = await until(async () => {
    const x = await call(fresh, fresh.bootstrap, "GET", `/api/tunnels/${r.data.id}`);
    return x.data.status === "failed" && x;
  });
  assert.ok(!failed.text.includes(token));
  assert.match(failed.data.lastError, /needs ngrok/);
  assert.ok(!(await call(fresh, fresh.bootstrap, "GET", "/api/tunnels")).text.includes(token));
  assert.ok(
    !(await call(fresh, fresh.bootstrap, "GET", `/api/tunnels/${r.data.id}/logs`)).text.includes(
      token,
    ),
  );
  await fresh.stop();
  for (const f of ["hosterax.db", "hosterax.db-wal"]) {
    const p = join(fresh.home, f);
    if (existsSync(p))
      assert.ok(!readFileSync(p).includes(token), `${f} holds the token in plain text`);
  }
});

test("what was public before an engine restart is public again, what was stopped stays stopped", async () => {
  const a = await startEngine();
  const keep = customTunnel("keep");
  const off = customTunnel("off2");
  const k = await call(a, a.bootstrap, "POST", "/api/tunnels", keep.body("edge"));
  assert.equal(k.status, 201);
  // a second tunnel on the same target needs a different provider entry; use a project instead
  await call(a, a.bootstrap, "POST", "/api/projects", { name: "second" });
  const o = await call(a, a.bootstrap, "POST", "/api/tunnels", off.body("second"));
  assert.equal(o.status, 201);
  await until(
    async () =>
      (await call(a, a.bootstrap, "GET", `/api/tunnels/${k.data.id}`)).data.status === "running",
  );
  await call(a, a.bootstrap, "POST", `/api/tunnels/${o.data.id}/stop`);
  const oldPid = Number(readFileSync(keep.pidFile, "utf8"));
  const { home, port, bootstrap: token } = a;
  await a.stop();

  // the bootstrap token is only printed on a first start; the same token keeps working
  const b = await startEngine({ home, port });
  const kept = await until(async () => {
    const x = await call(b, token, "GET", `/api/tunnels/${k.data.id}`);
    return x.data.status === "running" && x.data;
  });
  assert.equal(kept.publicUrl, "https://keep.example.net");
  assert.equal((await call(b, token, "GET", `/api/tunnels/${o.data.id}`)).data.status, "stopped");
  assert.notEqual(Number(readFileSync(keep.pidFile, "utf8")), oldPid);
  await until(() => !alive(oldPid), 8000);
});

test("the public address is looked up, judged, and only saved when the internet could reach it", async () => {
  const look = await call(engine, admin, "GET", "/api/expose/public-ip");
  assert.equal(look.status, 200);
  assert.equal(look.data.ip, "203.0.113.50");
  assert.equal(look.data.assignedToThisMachine, false);
  assert.match(look.data.advice, /behind a router/);
  assert.equal(look.data.configuredMatches, false);

  for (const ip of [
    "192.168.1.5",
    "10.1.2.3",
    "100.64.1.1",
    "127.0.0.1",
    "not-an-ip",
    "999.1.1.1",
  ]) {
    const r = await call(engine, admin, "POST", "/api/expose/public-ip", { ip });
    assert.equal(r.status, 400, ip);
  }
  const saved = await call(engine, admin, "POST", "/api/expose/public-ip", {});
  assert.deepEqual(saved.data, { ok: true, ip: "203.0.113.50" });
  const after = await call(engine, admin, "GET", "/api/expose/public-ip");
  assert.equal(after.data.configured, "203.0.113.50");
  assert.equal(after.data.configuredMatches, true);
});

test("automatic exposure is off by default and only accepts providers that need no account", async () => {
  const get = async () => (await call(engine, admin, "GET", "/api/expose/auto")).data;
  assert.deepEqual(await get(), { enabled: false, provider: "auto" });
  for (const provider of ["ngrok", "custom", "cloudflare-token", "tailscale-nope"]) {
    const r = await call(engine, admin, "PUT", "/api/expose/auto", { provider });
    assert.equal(r.status, 400, provider);
  }
  const on = await call(engine, admin, "PUT", "/api/expose/auto", {
    enabled: true,
    provider: "pinggy",
  });
  assert.deepEqual(on.data, { enabled: true, provider: "pinggy" });
  assert.deepEqual(await get(), { enabled: true, provider: "pinggy" });
  const off = await call(engine, admin, "PUT", "/api/expose/auto", {
    enabled: false,
    provider: "auto",
  });
  assert.deepEqual(off.data, { enabled: false, provider: "auto" });
});
