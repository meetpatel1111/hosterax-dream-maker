import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { initSecrets } from "../src/secrets.mjs";
import {
  TunnelManager,
  PROVIDERS,
  AUTO_ORDER,
  detectPublicIp,
  isPrivateAddress,
  defaultGateway,
  tunnelTargetHost,
} from "../src/tunnel-manager.mjs";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-tunnels-"));
initSecrets(HOME);

// Stand-in for a tunnel program: prints what it is told to and either stays up or exits.
const STUB = path.join(HOME, "stub.mjs");
fs.writeFileSync(
  STUB,
  `const [mode, ...rest] = process.argv.slice(2);
if (mode === "print") { for (const l of rest) console.log(l); setInterval(() => {}, 1000); }
else if (mode === "exit") { process.exit(Number(rest[0] || 1)); }
else { setInterval(() => {}, 1000); }
`,
);

// The text below follows what each service documents it prints. It is not captured from the live
// services (the build environment cannot reach them), so the first real run is the real check.
const OUTPUT = {
  cloudflare: [
    "2026-10-24T01:00:00Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee.",
    "2026-10-24T01:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
    "2026-10-24T01:00:01Z INF +--------------------------------------------------------------------------------------------+",
    "2026-10-24T01:00:01Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
    "2026-10-24T01:00:01Z INF |  https://fluffy-tulip-demo.trycloudflare.com                                               |",
    "2026-10-24T01:00:01Z INF +--------------------------------------------------------------------------------------------+",
  ],
  "localhost-run": [
    "===============================================================================",
    "Welcome to localhost.run!",
    "Follow your own XKCD comic at https://localhost.run/docs/ or see the admin at https://admin.localhost.run/",
    "abc123def456.lhr.life tunneled with tls termination, https://abc123def456.lhr.life",
  ],
  pinggy: [
    "You are not authenticated.",
    "Your tunnel will expire in 60 minutes. Upgrade to Pinggy Pro to get unrestricted tunnels. https://dashboard.pinggy.io",
    "http://rnqxa-1-2-3-4.a.free.pinggy.link",
    "https://rnqxa-1-2-3-4.a.free.pinggy.link",
  ],
  serveo: ["Forwarding HTTP traffic from https://a1b2c3d4e5f6.serveousercontent.com"],
  localtunnel: ["your url is: https://quiet-pandas-wave.loca.lt"],
  ngrok: [
    '{"lvl":"info","msg":"starting web service","addr":"127.0.0.1:4040"}',
    '{"lvl":"info","msg":"started tunnel","obj":"tunnels","name":"command_line","addr":"http://127.0.0.1:3000","url":"https://demo-name.ngrok-free.app"}',
  ],
  tailscale: [
    "",
    "Available on the internet:",
    "",
    "https://my-pc.tail1234.ts.net/",
    "|-- / proxy http://127.0.0.1:3000",
    "",
    "Press Ctrl+C to exit.",
  ],
  bore: [
    "2026-10-24T01:00:00Z  INFO bore_cli::client: connected to server remote_port=34567",
    "2026-10-24T01:00:00Z  INFO bore_cli::client: listening at bore.pub:34567",
  ],
  "cloudflare-token": ["INF Registered tunnel connection connIndex=0 location=fra03 protocol=quic"],
};

function detectOf(id, lines, opts = {}) {
  for (const l of lines) {
    const hit = PROVIDERS[id].detect(l, opts);
    if (hit) return hit.url;
  }
  return null;
}

test("each provider finds its own public address and ignores the other links it prints", () => {
  assert.equal(
    detectOf("cloudflare", OUTPUT.cloudflare),
    "https://fluffy-tulip-demo.trycloudflare.com",
  );
  assert.equal(detectOf("localhost-run", OUTPUT["localhost-run"]), "https://abc123def456.lhr.life");
  assert.equal(detectOf("pinggy", OUTPUT.pinggy), "https://rnqxa-1-2-3-4.a.free.pinggy.link");
  assert.equal(detectOf("serveo", OUTPUT.serveo), "https://a1b2c3d4e5f6.serveousercontent.com");
  assert.equal(detectOf("localtunnel", OUTPUT.localtunnel), "https://quiet-pandas-wave.loca.lt");
  assert.equal(detectOf("ngrok", OUTPUT.ngrok), "https://demo-name.ngrok-free.app");
  assert.equal(detectOf("tailscale", OUTPUT.tailscale), "https://my-pc.tail1234.ts.net");
  assert.equal(detectOf("bore", OUTPUT.bore), "tcp://bore.pub:34567");
  assert.equal(
    detectOf("cloudflare-token", OUTPUT["cloudflare-token"], { hostname: "apps.example.com" }),
    "https://apps.example.com",
  );
  // the error text cloudflared prints when the service is down names a host that is not a tunnel
  assert.equal(
    detectOf("cloudflare", [
      'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host',
    ]),
    null,
  );
  // the Tailscale hint for turning Funnel on is a link, but not a public address
  assert.equal(
    detectOf("tailscale", [
      "Funnel is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/funnel?node=n123",
    ]),
    null,
  );
  // ANSI colour codes around the address do not matter
  assert.equal(
    detectOf("cloudflare", ["\u001b[32mhttps://green-text-demo.trycloudflare.com\u001b[0m"]),
    "https://green-text-demo.trycloudflare.com",
  );
});

test("a custom provider uses the pattern it was given", () => {
  const opts = { urlPattern: "public at (https://\\S+)" };
  assert.equal(
    PROVIDERS.custom.detect("zrok: public at https://abc.share.zrok.io ok", opts).url,
    "https://abc.share.zrok.io",
  );
  assert.equal(PROVIDERS.custom.detect("nothing here", opts), null);
});

// ───────────── manager ─────────────

const dbs = [];
after(() => {
  for (const m of managers) m.stop();
});
const managers = [];

function make({
  autostart = true,
  passthrough = false,
  installed = ["cloudflared", "ssh", "ngrok", "tailscale", "bore"],
  docker = false,
  npx = false,
  scenario = {},
  ...extra
} = {}) {
  const db = new Database(":memory:");
  dbs.push(db);
  const calls = [];
  const target = { current: { host: "127.0.0.1", port: 4101 } };
  const tools = {
    bin: (n) => (installed.includes(n) ? `/fake/bin/${n}` : null),
    docker: () => docker,
    npx: () => (npx ? "/fake/npx-cli.js" : null),
  };
  const events = [];
  const mgr = new TunnelManager({
    db,
    HOME: fs.mkdtempSync(path.join(HOME, "m-")),
    tools,
    env: {
      PATH: process.env.PATH,
      SECRET_ENGINE_VALUE: "must-not-leak",
      HOSTERAX_ALLOW_CUSTOM_TUNNELS: extra.allowCustom ? "1" : "",
    },
    resolveTarget: (t) => {
      if (t === "forbidden") throw new Error("that port belongs to the engine");
      // only these projects exist
      if (t !== "edge" && !["shop", "one", "two", "other"].includes(t)) return { missing: true };
      return target.current;
    },
    recordEvent: (project, type, details, status) =>
      events.push({ project, type, details, status }),
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      // run what was planned, for tests that are about the planned command itself
      if (passthrough) return spawn(cmd, args, opts);
      const name = path.basename(cmd);
      const how = scenario[name] ?? [
        "print",
        ...(OUTPUT[providerOf(name, args)] || ["https://stub.trycloudflare.com"]),
      ];
      return spawn(process.execPath, [STUB, ...how], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    },
    fetchImpl: async () => ({ status: 200 }),
    tickMs: 40,
    startTimeoutMs: 1500,
    retryBaseMs: 40,
    retryMaxMs: 160,
    ...extra,
  });
  managers.push(mgr);
  if (autostart) mgr.start();
  return { mgr, db, calls, target, events };
}

// which provider's sample output a fake binary should print
function providerOf(name, args) {
  if (name === "ssh") {
    const dest = args[args.length - 1];
    if (/localhost\.run/.test(dest)) return "localhost-run";
    if (/pinggy/.test(dest)) return "pinggy";
    return "serveo";
  }
  if (name === "cloudflared") return args.includes("run") ? "cloudflare-token" : "cloudflare";
  return name;
}

async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${fn}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("a tunnel starts, reports its public address and runs the right command", async () => {
  const { mgr, calls } = make();
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  assert.equal(t.status, "starting");
  const up = await until(() => mgr.get(t.id).status === "running" && mgr.get(t.id));
  assert.equal(up.publicUrl, "https://fluffy-tulip-demo.trycloudflare.com");
  assert.equal(up.providerUsed, "cloudflare");
  assert.equal(up.runsWith, "cloudflared");
  assert.deepEqual(calls[0].args, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4101"]);
  assert.equal(calls[0].cmd, "/fake/bin/cloudflared");
  // the child gets a minimal environment, not the engine's
  assert.equal(calls[0].env.SECRET_ENGINE_VALUE, undefined);
  assert.ok(mgr.logs(t.id).some((l) => l.includes("trycloudflare.com")));
  mgr.stop();
});

test("ssh-based providers use only ssh options that keep the user's own keys and config out of it", () => {
  const { mgr } = make();
  for (const [id, host, extra] of [
    ["localhost-run", "nokey@localhost.run", ["-R", "80:127.0.0.1:4101"]],
    ["pinggy", "a.pinggy.io", ["-p", "443", "-R0:127.0.0.1:4101"]],
    ["serveo", "serveo.net", ["-R", "80:127.0.0.1:4101"]],
  ]) {
    const plan = mgr._plan(PROVIDERS[id], {
      id: "x",
      host: "127.0.0.1",
      port: 4101,
      opts: {},
      dirs: mgr.dirs,
    });
    assert.equal(plan.cmd, "/fake/bin/ssh");
    const a = plan.args.join(" ");
    for (const must of [
      "BatchMode=yes",
      "IdentitiesOnly=yes",
      "StrictHostKeyChecking=accept-new",
      "ExitOnForwardFailure=yes",
      "ServerAliveInterval=30",
    ])
      assert.ok(a.includes(must), `${id} should set ${must}`);
    assert.ok(plan.args.includes("-F"), "ignores ~/.ssh/config");
    assert.ok(plan.args.includes("-T"));
    assert.deepEqual(plan.args.slice(-extra.length - 1), [...extra, host]);
  }
  // an IPv6 target is bracketed
  const v6 = mgr._plan(PROVIDERS["localhost-run"], {
    id: "x",
    host: "::1",
    port: 4101,
    opts: {},
    dirs: mgr.dirs,
  });
  assert.ok(v6.args.includes("80:[::1]:4101"));
});

test("tokens go to the child through its environment, never its command line", () => {
  const { mgr } = make();
  const token = "tok_" + "a".repeat(40);
  const cf = mgr._plan(PROVIDERS["cloudflare-token"], {
    id: "x",
    host: "127.0.0.1",
    port: 80,
    opts: { token },
    dirs: mgr.dirs,
  });
  assert.equal(cf.env.TUNNEL_TOKEN, token);
  assert.ok(!cf.args.join(" ").includes(token));
  const ng = mgr._plan(PROVIDERS.ngrok, {
    id: "x",
    host: "127.0.0.1",
    port: 3000,
    opts: { authtoken: "ngrok_" + "b".repeat(30), domain: "me.ngrok-free.app" },
    dirs: mgr.dirs,
  });
  assert.equal(ng.env.NGROK_AUTHTOKEN.startsWith("ngrok_"), true);
  assert.ok(!ng.args.join(" ").includes("ngrok_b"));
  assert.deepEqual(ng.args.slice(0, 2), ["http", "127.0.0.1:3000"]);
  assert.ok(ng.args.join(" ").includes("--url https://me.ngrok-free.app"));
});

test("Docker is used when the program is not installed, and only then", () => {
  const { mgr } = make({ installed: [], docker: true });
  const plan = mgr._plan(PROVIDERS.cloudflare, {
    id: "ab12",
    host: "127.0.0.1",
    port: 4101,
    opts: {},
    dirs: mgr.dirs,
  });
  assert.equal(plan.cmd, "docker");
  assert.equal(plan.via, "Docker");
  assert.equal(plan.container, "hx_tunnel_ab12");
  assert.ok(plan.args.includes("cloudflare/cloudflared:latest"));
  assert.ok(plan.args.includes("--rm") && plan.args.includes("--init"));
  if (process.platform === "linux") {
    assert.ok(plan.args.join(" ").includes("--network host"));
    assert.ok(plan.args.includes("http://127.0.0.1:4101"));
  } else {
    assert.ok(plan.args.join(" ").includes("host.docker.internal:host-gateway"));
    assert.ok(plan.args.includes("http://host.docker.internal:4101"));
  }
  // a secret is named for Docker (-e NAME), its value is not on the command line
  const ng = mgr._plan(PROVIDERS.ngrok, {
    id: "ab12",
    host: "127.0.0.1",
    port: 3000,
    opts: { authtoken: "ngrok_" + "c".repeat(30) },
    dirs: mgr.dirs,
  });
  const i = ng.args.indexOf("-e");
  assert.equal(ng.args[i + 1], "NGROK_AUTHTOKEN");
  assert.ok(!ng.args.join(" ").includes("ngrok_c"));
});

test("localtunnel runs through the npx that belongs to this Node", () => {
  const { mgr } = make({ installed: [], npx: true });
  const plan = mgr._plan(PROVIDERS.localtunnel, {
    id: "x",
    host: "127.0.0.1",
    port: 4101,
    opts: {},
    dirs: mgr.dirs,
  });
  assert.equal(plan.cmd, process.execPath);
  assert.deepEqual(plan.args.slice(0, 3), ["/fake/npx-cli.js", "--yes", "localtunnel@2.0.2"]);
  assert.deepEqual(plan.args.slice(-4), ["--port", "4101", "--local-host", "127.0.0.1"]);
});

test("the provider list says what each one needs and whether this machine can run it", () => {
  const { mgr } = make({ installed: ["ssh"], docker: false, npx: false });
  const byId = Object.fromEntries(mgr.providers().map((p) => [p.id, p]));
  assert.equal(byId["localhost-run"].ready, true);
  assert.equal(byId["localhost-run"].runsWith, "ssh");
  assert.equal(byId.cloudflare.ready, false);
  assert.match(byId.cloudflare.missing, /cloudflared/);
  assert.match(byId.cloudflare.missing, /Docker/);
  assert.equal(byId.localtunnel.ready, false);
  assert.equal(byId.custom.ready, false);
  assert.match(byId.custom.missing, /HOSTERAX_ALLOW_CUSTOM_TUNNELS/);
  assert.equal(byId.ngrok.needsAccount, true);
  assert.equal(byId.cloudflare.needsAccount, false);
  assert.deepEqual(
    mgr
      .providers()
      .filter((p) => p.inAuto)
      .map((p) => p.id),
    // localtunnel downloads code from npm when it starts, so auto never picks it
    ["cloudflare", "localhost-run", "pinggy", "serveo"],
  );
  assert.deepEqual(AUTO_ORDER, ["cloudflare", "localhost-run", "pinggy", "serveo"]);
});

test("auto skips what is not installed, falls through a failing provider, and records why", async () => {
  // cloudflared is missing, the first ssh relay (localhost.run) dies at once, pinggy works
  const { mgr, calls } = make({ installed: ["ssh"] });
  mgr.spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args });
    const dest = args[args.length - 1];
    const how = /localhost\.run/.test(dest) ? ["exit", "255"] : ["print", ...OUTPUT.pinggy];
    return spawn(process.execPath, [STUB, ...how], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
  };
  const t = mgr.create({ target: "shop", provider: "auto" });
  const up = await until(() => mgr.get(t.id).status === "running" && mgr.get(t.id));
  assert.equal(up.providerUsed, "pinggy");
  assert.equal(up.publicUrl, "https://rnqxa-1-2-3-4.a.free.pinggy.link");
  const why = up.attempts.join("\n");
  assert.match(why, /Cloudflare Quick Tunnel: needs cloudflared/);
  assert.match(why, /localhost\.run: ssh stopped \(255\)/);
  assert.match(why, /Pinggy: connected/);
  mgr.stop();
});

test("when nothing can run, the tunnel says exactly what to install", async () => {
  const { mgr, events } = make({ installed: [], docker: false, npx: false });
  const t = mgr.create({ target: "shop", provider: "auto" });
  const failed = await until(() => mgr.get(t.id).status === "failed" && mgr.get(t.id));
  assert.match(failed.lastError, /needs cloudflared/);
  assert.match(failed.lastError, /OpenSSH client/);
  assert.ok(events.some((e) => e.type === "tunnel_failed" && e.project === "shop"));
  mgr.stop();
});

test("a tunnel that never shows an address is stopped and reported", async () => {
  const { mgr } = make({ scenario: { cloudflared: ["silent"] }, startTimeoutMs: 400 });
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  const failed = await until(() => mgr.get(t.id).status === "failed" && mgr.get(t.id));
  assert.match(failed.lastError, /no public address after/);
  mgr.stop();
});

test("a tunnel that drops is restarted, and the address it comes back with is reported", async () => {
  let n = 0;
  const { mgr, calls } = make();
  mgr.spawnImpl = (cmd, args) => {
    calls.push({ cmd, args });
    n += 1;
    // first run connects then dies; second run stays up under a new address
    const how =
      n === 1
        ? ["print", "https://first-run.trycloudflare.com"]
        : ["print", "https://second-run.trycloudflare.com"];
    const c = spawn(process.execPath, [STUB, ...how], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    if (n === 1) setTimeout(() => c.kill("SIGKILL"), 400);
    return c;
  };
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  await until(() => mgr.get(t.id).publicUrl === "https://first-run.trycloudflare.com");
  const again = await until(
    () => mgr.get(t.id).publicUrl === "https://second-run.trycloudflare.com" && mgr.get(t.id),
  );
  assert.equal(again.status, "running");
  assert.ok(again.restarts >= 1);
  mgr.stop();
});

test("disabling stops the process for good; enabling brings it back", async () => {
  const { mgr, calls } = make();
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  await until(() => mgr.get(t.id).status === "running");
  const before = calls.length;
  const off = mgr.disable(t.id);
  assert.equal(off.status, "stopped");
  assert.equal(off.publicUrl, null);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls.length, before, "no restart after being stopped");
  assert.equal(mgr.get(t.id).status, "stopped");
  mgr.enable(t.id);
  await until(() => mgr.get(t.id).status === "running");
  assert.equal(calls.length, before + 1);
  mgr.stop();
});

test("a redeployed project on a new port gets a tunnel to the new port", async () => {
  const { mgr, calls, target } = make();
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  await until(() => mgr.get(t.id).status === "running");
  target.current = { host: "127.0.0.1", port: 4777 };
  await until(() => calls.length >= 2);
  assert.ok(calls[calls.length - 1].args.includes("http://127.0.0.1:4777"));
  await until(() => mgr.get(t.id).status === "running");
  mgr.stop();
});

test("a project that is not deployed yet is waited for; one that is deleted loses its tunnel", async () => {
  const { mgr, calls, target, events } = make();
  target.current = { waiting: "the project has not been deployed yet" };
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  await until(() => mgr.get(t.id).status === "waiting");
  assert.equal(calls.length, 0);
  assert.match(mgr.get(t.id).lastError, /not been deployed/);
  target.current = { host: "127.0.0.1", port: 4101 };
  await until(() => mgr.get(t.id).status === "running");
  target.current = { missing: true };
  await until(() => mgr.get(t.id) === null);
  assert.ok(events.some((e) => e.type === "tunnel_removed"));
  mgr.stop();
});

test("what was public before a restart is public again, what was stopped stays stopped", async () => {
  const { mgr, db, calls } = make();
  const a = mgr.create({ target: "one", provider: "cloudflare" });
  const b = mgr.create({ target: "two", provider: "cloudflare" });
  await until(() => mgr.get(a.id).status === "running" && mgr.get(b.id).status === "running");
  mgr.disable(b.id);
  mgr.stop();
  // a fresh manager on the same database, as after an engine restart
  const mgr2 = new TunnelManager({
    db,
    HOME: fs.mkdtempSync(path.join(HOME, "r-")),
    tools: { bin: (n) => `/fake/bin/${n}`, docker: () => false, npx: () => null },
    env: { PATH: process.env.PATH },
    resolveTarget: () => ({ host: "127.0.0.1", port: 4101 }),
    spawnImpl: (cmd, args) => {
      calls.push({ cmd, args });
      return spawn(process.execPath, [STUB, "print", ...OUTPUT.cloudflare], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    },
    fetchImpl: async () => ({ status: 200 }),
    tickMs: 40,
  });
  managers.push(mgr2);
  const before = calls.length;
  mgr2.start();
  await until(() => mgr2.get(a.id).status === "running");
  assert.equal(mgr2.get(b.id).status, "stopped");
  assert.equal(calls.length, before + 1);
  mgr2.stop();
});

test("secrets are stored encrypted, never returned, and scrubbed from the logs", async () => {
  const token = "eyJ" + "T".repeat(60);
  const { mgr, db } = make();
  const t = mgr.create({
    target: "edge",
    provider: "cloudflare-token",
    options: { token, hostname: "apps.example.com" },
  });
  const raw = db.prepare("SELECT options_enc FROM tunnels WHERE id=?").get(t.id).options_enc;
  assert.ok(raw.startsWith("enc:v1:"), "options are encrypted at rest");
  assert.ok(!raw.includes(token));
  const shaped = JSON.stringify(mgr.get(t.id));
  assert.ok(!shaped.includes(token), "the token is never returned");
  assert.deepEqual(mgr.get(t.id).secretsSet, ["token"]);
  assert.equal(mgr.get(t.id).options.hostname, "apps.example.com");
  await until(() => mgr.get(t.id).status === "running");
  assert.equal(mgr.get(t.id).publicUrl, "https://apps.example.com");
  // a program that echoes its own token does not put it in the log we serve
  mgr._line(
    t.id,
    db.prepare("SELECT * FROM tunnels WHERE id=?").get(t.id),
    `connecting with ${token}`,
  );
  assert.ok(!mgr.logs(t.id).join("\n").includes(token));
  mgr.stop();
});

test("creating a tunnel validates what it is asked to expose", () => {
  const { mgr } = make({ allowCustom: false });
  assert.throws(() => mgr.create({ target: "../etc", provider: "cloudflare" }), /project name/);
  assert.throws(
    () => mgr.create({ target: "7777", provider: "cloudflare" }),
    /project name|exist/i,
  );
  assert.throws(() => mgr.create({ target: "shop", provider: "nope" }), /unknown provider/);
  assert.throws(() => mgr.create({ target: "ghost", provider: "cloudflare" }), /does not exist/);
  assert.throws(
    () => mgr.create({ target: "forbidden", provider: "cloudflare" }),
    /belongs to the engine/,
  );
  assert.throws(
    () =>
      mgr.create({
        target: "shop",
        provider: "cloudflare-token",
        options: { token: "x".repeat(30) },
      }),
    /edge/,
  );
  assert.throws(
    () => mgr.create({ target: "edge", provider: "cloudflare-token", options: {} }),
    /Tunnel token/,
  );
  assert.throws(
    () => mgr.create({ target: "edge", provider: "cloudflare-token", options: { token: "short" } }),
    /token does not look right/,
  );
  assert.throws(
    () =>
      mgr.create({
        target: "shop",
        provider: "ngrok",
        options: { authtoken: "ngrok_" + "x".repeat(20), bogus: "1" },
      }),
    /no option "bogus"/,
  );
  assert.throws(
    () => mgr.create({ target: "shop", provider: "auto", options: { token: "x" } }),
    /belong to a specific provider/,
  );
  assert.throws(
    () =>
      mgr.create({
        target: "shop",
        provider: "ngrok",
        options: { authtoken: "ngrok_" + "x".repeat(20), domain: "bad host!" },
      }),
    /not a valid hostname/,
  );
  assert.throws(
    () =>
      mgr.create({
        target: "shop",
        provider: "custom",
        options: { command: "echo {port}", urlPattern: "(https://\\S+)" },
      }),
    /custom tunnels are off/,
  );
});

test("custom tunnels, when allowed, run the command without a shell and read the address with the pattern", async () => {
  const { mgr, calls } = make({ allowCustom: true, passthrough: true });
  const marker = path.join(HOME, "should-not-exist");
  const t = mgr.create({
    target: "shop",
    provider: "custom",
    options: {
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(STUB)} print "shared at https://x.example.net" ; touch ${marker} {port}`,
      urlPattern: "shared at (https://\\S+)",
    },
  });
  await until(() => mgr.get(t.id).status === "running");
  assert.equal(mgr.get(t.id).publicUrl, "https://x.example.net");
  // the ";" is an ordinary argument, not a second command
  assert.ok(calls[calls.length - 1].args.includes(";"));
  assert.ok(calls[calls.length - 1].args.includes("4101"));
  assert.equal(fs.existsSync(marker), false);
  assert.throws(
    () =>
      mgr.create({
        target: "other",
        provider: "custom",
        options: { command: "x", urlPattern: "(" },
      }),
    /not a valid regular expression/,
  );
  mgr.stop();
});

test("removing a tunnel stops it and forgets it", async () => {
  const { mgr, db } = make();
  const t = mgr.create({ target: "shop", provider: "cloudflare" });
  await until(() => mgr.get(t.id).status === "running");
  assert.equal(mgr.remove(t.id), true);
  assert.equal(mgr.get(t.id), null);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tunnels").get().c, 0);
  assert.equal(mgr.remove(t.id), false);
  mgr.stop();
});

test("creating the same tunnel twice updates it instead of duplicating it", async () => {
  const { mgr, db } = make();
  const a = mgr.create({ target: "shop", provider: "cloudflare" });
  const b = mgr.create({ target: "shop", provider: "cloudflare" });
  assert.equal(a.id, b.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tunnels").get().c, 1);
  mgr.stop();
});

test("automatic exposure gives each listed project one tunnel and leaves switched-off ones alone", async () => {
  const { mgr, db } = make({
    autoTargets: () => ["shop", "one"],
    autoProvider: () => "cloudflare",
  });
  await until(() => mgr.list().length === 2 && mgr.list().every((t) => t.status === "running"));
  assert.deepEqual(
    mgr
      .list()
      .map((t) => t.target)
      .sort(),
    ["one", "shop"],
  );
  // switching one off sticks: it is not recreated while it still has a (stopped) tunnel
  const shop = mgr.list().find((t) => t.target === "shop");
  mgr.disable(shop.id);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mgr.get(shop.id).status, "stopped");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tunnels").get().c, 2, "no duplicates");
  mgr.stop();
});

test("automatic exposure with a provider that needs settings makes nothing and keeps the loop alive", async () => {
  const { mgr, db } = make({ autoTargets: () => ["shop"], autoProvider: () => "ngrok" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tunnels").get().c, 0);
  mgr.stop();
});

// ───────────── this machine's public address ─────────────

test("the public address check asks one service after another and ignores nonsense", async () => {
  const seen = [];
  const answers = {
    "https://a.test": { ok: false },
    "https://b.test": { ok: true, text: async () => "<html>blocked</html>" },
    "https://c.test": { ok: true, text: async () => "203.0.113.9\n" },
  };
  const fetchImpl = async (url) => {
    seen.push(url);
    return answers[url];
  };
  const r = await detectPublicIp({ fetchImpl, sources: Object.keys(answers) });
  assert.deepEqual(r, { ip: "203.0.113.9", source: "https://c.test" });
  assert.deepEqual(seen, ["https://a.test", "https://b.test", "https://c.test"]);
  assert.equal(
    await detectPublicIp({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      sources: ["https://a.test"],
    }),
    null,
  );
});

// ───────────── where the apps are ─────────────

const ROUTE = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  "eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
].join("\n");

test("inside a container the apps are on the Docker host, so tunnels are pointed at its gateway", () => {
  assert.equal(defaultGateway(ROUTE), "172.17.0.1");
  assert.equal(defaultGateway("Iface\tDestination\tGateway\n"), null);
  assert.equal(defaultGateway("garbage"), null);
  const container = { exists: (p) => p === "/.dockerenv", read: () => ROUTE };
  assert.equal(tunnelTargetHost({ bindHost: "0.0.0.0", env: {}, ...container }), "172.17.0.1");
  // an ordinary machine is simply itself
  assert.equal(
    tunnelTargetHost({ bindHost: "0.0.0.0", env: {}, exists: () => false }),
    "127.0.0.1",
  );
  assert.equal(tunnelTargetHost({ bindHost: "::", env: {}, exists: () => false }), "127.0.0.1");
  assert.equal(
    tunnelTargetHost({ bindHost: "192.168.1.5", env: {}, exists: () => false }),
    "192.168.1.5",
  );
  // a container whose routing table cannot be read falls back rather than failing
  const broken = {
    exists: () => true,
    read: () => {
      throw new Error("no /proc");
    },
  };
  assert.equal(tunnelTargetHost({ env: {}, ...broken }), "127.0.0.1");
  // the override wins, and must be a plausible address
  assert.equal(
    tunnelTargetHost({ env: { HOSTERAX_TUNNEL_HOST: "10.1.2.3" }, ...container }),
    "10.1.2.3",
  );
  assert.equal(
    tunnelTargetHost({ env: { HOSTERAX_TUNNEL_HOST: "docker-host.lan" }, ...container }),
    "docker-host.lan",
  );
  assert.throws(
    () => tunnelTargetHost({ env: { HOSTERAX_TUNNEL_HOST: "a b; reboot" } }),
    /HOSTERAX_TUNNEL_HOST/,
  );
});

test("private, loopback and carrier-grade-NAT addresses are recognised as not public", () => {
  for (const ip of [
    "10.0.0.5",
    "192.168.1.20",
    "172.16.4.4",
    "172.31.255.1",
    "127.0.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "100.127.9.9",
    "::1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["203.0.113.9", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1"])
    assert.equal(isPrivateAddress(ip), false, ip);
});
