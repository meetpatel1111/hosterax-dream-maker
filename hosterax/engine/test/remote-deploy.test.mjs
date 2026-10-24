// End-to-end: deploy a project to a "remote" server through the whole real path —
//   real engine -> real docker CLI -> bridge -> real OpenSSH server -> (stand-in) Docker daemon
// The only fakes are the Docker daemon on the far side of SSH and the app it "runs" (see
// helpers/fake-dockerd.mjs). The engine's own Docker is deliberately unavailable in these tests, so any
// docker command that wrongly ran on this machine instead of the server would fail the deploy.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHarness } from "./helpers/engine-harness.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";

const HAVE = sshToolsAvailable() && spawnSync("docker", ["--version"]).status === 0;
const skip = HAVE ? false : "needs OpenSSH and the docker CLI";
const h = createHarness("hosterax-remote-deploy-");

let fx;
let engine;
let admin;
let home;
let serverId;
const api = (method, path, body) => h.call(engine, admin, method, path, body);

async function get(port, path = "/") {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: r.status, text: await r.text() };
}
async function deploy(name) {
  const r = await api("POST", `/api/projects/${name}/deploy`, {});
  assert.equal(r.status, 200, r.text);
  const dep = await h.until(
    async () => {
      const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
      return d && ["ready", "failed", "cancelled"].includes(d.phase) ? d : null;
    },
    90000,
    "the deployment to finish",
  );
  if (dep.phase !== "ready") {
    const log = await api("GET", `/api/deployments/${r.data.id}/logs`);
    assert.fail(`deployment ${dep.phase}\n${String(log.text).slice(-2500)}`);
  }
  return dep;
}
const projectRow = async (name) => (await api("GET", `/api/projects/${name}`)).data;
const requests = () => fx.daemonRequests.all;

async function startEngine() {
  engine = await h.startEngine({
    home,
    env: { HOSTERAX_SERVER_POLL_MS: "1000", HOSTERAX_BIND_HOST: "127.0.0.1" },
  });
  admin = admin || engine.bootstrap;
}

before(async () => {
  if (!HAVE) return;
  fx = await startSshFixture();
  home = `${h.scratch}/engine-home`;
  await startEngine();
});
after(async () => {
  await h.cleanup();
  await fx?.stop();
});

test("set up: a server with a confirmed host key and an authorised key", { skip }, async () => {
  const added = await api("POST", "/api/servers", {
    name: "Loopback VPS",
    type: "remote",
    host: fx.host,
    port: fx.port,
    username: fx.username,
  });
  assert.equal(added.status, 201, added.text);
  serverId = added.data.id;
  const scan = (await api("GET", `/api/servers/${serverId}/host-key`)).data;
  const pin = await api("POST", `/api/servers/${serverId}/host-key`, {
    fingerprint: scan.keys[0].fingerprint,
  });
  assert.equal(pin.status, 200, pin.text);
  fx.authorizeKey(added.data.public_key);
  const t = await api("POST", `/api/servers/${serverId}/test`);
  assert.equal(t.data.ok, true, t.text);
});

test(
  "a project can only be placed on a server that exists, and only as a Docker project",
  { skip },
  async () => {
    let r = await api("POST", "/api/projects", {
      name: "bad-1",
      source: "nginx:alpine",
      target: "docker",
      serverId: "srv_nope",
    });
    assert.equal(r.status, 400);
    r = await api("POST", "/api/projects", {
      name: "bad-2",
      source: "x",
      target: "process",
      serverId,
    });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /docker/);
    r = await api("POST", "/api/projects", { name: "bad-3", source: "x", serverId });
    assert.equal(r.status, 400, "the default target is not docker");
    assert.equal((await api("GET", "/api/projects/bad-1")).status, 404, "nothing was created");
  },
);

test(
  "deploying to a server runs the whole pipeline there and reaches the app through a forward",
  {
    skip,
  },
  async () => {
    const created = await api("POST", "/api/projects", {
      name: "remote-demo",
      source: "nginx:alpine",
      target: "docker",
      serverId,
      env: { GREETING: "hello" },
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.data.serverId, serverId);
    assert.equal(created.data.serverName, "Loopback VPS");

    const dep = await deploy("remote-demo");
    assert.equal(dep.exit_code, 0);

    const reqs = requests();
    assert.ok(
      reqs.some((r) => /POST .*\/images\/create/.test(r)),
      "the image was pulled on the server",
    );
    assert.ok(reqs.some((r) => /POST .*\/containers\/create\?name=hx_remote_demo_green/.test(r)));
    assert.ok(reqs.some((r) => /POST .*\/containers\/[0-9a-f]+\/start/.test(r)));
    assert.ok(
      reqs.some((r) =>
        /POST .*\/containers\/hx_remote_demo_green\/rename\?name=hx_remote_demo/.test(r),
      ),
    );

    const p = await projectRow("remote-demo");
    assert.ok(
      p.remote_port >= 20000 && p.remote_port < 30000,
      "the container's port is on the server",
    );
    assert.notEqual(p.port, p.remote_port, "this machine reaches it on a different, local port");
    assert.equal(p.status, "running");

    // through the forward
    const res = await get(p.port);
    assert.equal(res.status, 200);
    assert.match(res.text, /fake container hx_remote_demo/);
    assert.deepEqual(
      JSON.parse((await get(p.port, "/env")).text).filter((e) => e.startsWith("GREETING")),
      ["GREETING=hello"],
      "environment variables reach the remote container",
    );

    // the container was published on the server's loopback, not its public interface
    const bound = (await import("node:fs")).readFileSync(`${fx.dir}/published-ports`, "utf8");
    assert.match(bound, new RegExp(`^127\\.0\\.0\\.1:${p.remote_port}->`, "m"));

    // the route points at the local end of the forward
    assert.equal(p.route.upstream_port, p.port);
  },
);

test("stop, start and restart act on the server's container", { skip }, async () => {
  const p = await projectRow("remote-demo");
  let r = await api("POST", "/api/projects/remote-demo/stop");
  assert.equal(r.status, 200, r.text);
  await assert.rejects(get(p.port), /fetch failed/, "the app is down");
  r = await api("POST", "/api/projects/remote-demo/start");
  assert.equal(r.status, 200, r.text);
  await h.until(
    async () => (await get(p.port).catch(() => ({ status: 0 }))).status === 200,
    10000,
    "the app to come back",
  );
  r = await api("POST", "/api/projects/remote-demo/restart");
  assert.equal(r.status, 200, r.text);
  assert.equal((await get(p.port)).status, 200);
  assert.ok(requests().some((x) => /POST .*\/containers\/hx_remote_demo\/stop/.test(x)));
});

test("a redeploy replaces the container and keeps the same address", { skip }, async () => {
  const before = await projectRow("remote-demo");
  await deploy("remote-demo");
  const after = await projectRow("remote-demo");
  assert.equal(after.port, before.port);
  assert.equal(after.remote_port, before.remote_port);
  assert.equal((await get(after.port)).status, 200);
});

test("a project that a server is running blocks deleting that server", { skip }, async () => {
  const r = await api("DELETE", `/api/servers/${serverId}`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /still running 1 project/);
});

test(
  "when the server goes away nothing is restarted or redeployed, and it is shown as unreachable",
  {
    skip,
  },
  async () => {
    const createsBefore = requests().filter((r) => /containers\/create/.test(r)).length;
    fx.dockerMode("down");
    await h.until(
      async () => (await api("GET", `/api/servers/${serverId}`)).data.status === "error",
      15000,
      "the server to be marked down",
    );
    const health = await h.until(
      async () => {
        const s = (await api("GET", "/api/self-heal/status")).data;
        const p = s?.projects?.["remote-demo"];
        return p?.status === "unreachable" ? p : null;
      },
      40000,
      "the project to be marked unreachable",
    );
    assert.match(health.message, /Nothing is restarted/);
    assert.equal(
      (await projectRow("remote-demo")).status,
      "stopped",
      "the list does not claim it is running",
    );
    // a deploy to an unavailable server fails fast with the reason
    const r = await api("POST", "/api/projects/remote-demo/deploy", {});
    const dep = await h.until(
      async () => {
        const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
        return d.phase === "failed" || d.phase === "ready" ? d : null;
      },
      30000,
      "the deploy to fail",
    );
    assert.equal(dep.phase, "failed");
    assert.match(
      (await api("GET", `/api/deployments/${r.data.id}/logs`)).text,
      /is not available|not connected/,
    );

    fx.dockerMode("ok");
    await h.until(
      async () => (await api("GET", `/api/servers/${serverId}`)).data.status === "online",
      15000,
      "the server to recover",
    );
    assert.equal(
      requests().filter((x) => /containers\/create/.test(x)).length,
      createsBefore,
      "no container was created while the server was away",
    );
  },
);

test("after the engine restarts the forward is back on the same port", { skip }, async () => {
  const p = await projectRow("remote-demo");
  await engine.stop();
  await startEngine();
  await h.until(
    async () => (await get(p.port).catch(() => ({ status: 0 }))).status === 200,
    20000,
    "the forward to come back",
  );
  assert.equal((await projectRow("remote-demo")).port, p.port);
});

test("deleting the project removes the container and closes the forward", { skip }, async () => {
  const p = await projectRow("remote-demo");
  const r = await api("DELETE", "/api/projects/remote-demo");
  assert.equal(r.status, 200, r.text);
  await h.until(
    async () => requests().some((x) => /DELETE .*\/containers\/hx_remote_demo\?/.test(x)),
    10000,
    "the container to be removed on the server",
  );
  await h.until(
    async () => (await get(p.port).catch(() => null)) === null,
    10000,
    "the forward to close",
  );
  const del = await api("DELETE", `/api/servers/${serverId}`);
  assert.equal(del.data.ok, true, "with no project left the server can be removed");
});
