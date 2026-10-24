// End to end with REAL Docker and nothing faked:
//
//   real engine -> real `docker` CLI -> bridge -> real OpenSSH server -> real Docker daemon -> real containers
//
// The container is a real nginx, the image is pulled from Docker Hub by the engine, a Dockerfile is really
// built by BuildKit through the SSH bridge, and every claim is checked by asking the real daemon.
//
// Which daemon is "the server":
//   HOSTERAX_TEST_SECOND_DOCKERD=1          start a second dockerd (needs root): a genuinely separate Docker
//   HOSTERAX_TEST_REMOTE_DOCKER_HOST=unix://…  use a daemon you started yourself
//   neither                                 the machine's own Docker (then local and remote are one Docker)
// With a separate daemon the tests also prove containers landed there and NOT on the engine's own Docker.
//
// Skipped when there is no usable Docker, sshd, or no way to pull images.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";
import { canStartDockerd, startSecondDockerd } from "./helpers/second-dockerd.mjs";

const IMAGE = "nginx:alpine";
const h = createHarness("hosterax-real-docker-");

const dockerOn = (host, args, opts = {}) => {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  if (host) env.DOCKER_HOST = host;
  return spawnSync("docker", args, { encoding: "utf8", env, timeout: 120000, ...opts });
};
const local = (...args) => dockerOn("", args);

let remoteHost = process.env.HOSTERAX_TEST_REMOTE_DOCKER_HOST || "";
let second = null;
let isolated = false;
let why = ""; // set when the environment cannot run these tests
let fx;
let engine;
let admin;
let serverId;
const remote = (...args) => dockerOn(remoteHost, args);
const api = (method, path, body) => h.call(engine, admin, method, path, body);
/** Local addresses of TCP sockets listening on `port`, read from the kernel's table (no ss needed). */
function listenersOn(port) {
  const out = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"].filter((f) => existsSync(f))) {
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f[3] !== "0A") continue;
      const [addr, hexPort] = f[1].split(":");
      if (parseInt(hexPort, 16) !== port) continue;
      out.push(
        file.endsWith("tcp")
          ? addr
              .match(/../g)
              .reverse()
              .map((h) => parseInt(h, 16))
              .join(".")
          : addr,
      );
    }
  }
  return out;
}
const inspect = (docker, name, format) => docker("inspect", "--format", format, name).stdout.trim();
const ids = (docker, name) =>
  docker("ps", "-a", "-q", "--filter", `name=^${name}$`).stdout.trim().split("\n").filter(Boolean);

before(async () => {
  if (!sshToolsAvailable()) why = "OpenSSH client/server is not installed (or not Linux)";
  else if (local("info").status !== 0) why = "no Docker daemon is running on this machine";
  if (!why && !remoteHost && process.env.HOSTERAX_TEST_SECOND_DOCKERD === "1") {
    if (!canStartDockerd()) why = "HOSTERAX_TEST_SECOND_DOCKERD=1 needs root and dockerd";
    else {
      second = await startSecondDockerd();
      remoteHost = second.host;
    }
  }
  isolated = Boolean(remoteHost);
  if (!why && remote("info").status !== 0) why = "the remote Docker daemon does not answer";
  if (!why) {
    // start from nothing on the server, so the engine really has to pull
    remote("rm", "-f", "hx_realdemo", "hx_realbuild", "hx_localdemo");
    remote("rmi", "-f", IMAGE);
    const pulled = remote("pull", IMAGE);
    if (pulled.status !== 0) why = `cannot pull ${IMAGE} (no registry access?)`;
    else remote("rmi", IMAGE);
  }
  if (why) return;
  fx = await startSshFixture({ remoteDockerHost: remoteHost });
  engine = await h.startEngine({
    env: {
      HOSTERAX_SERVER_POLL_MS: "2000",
      HOSTERAX_BIND_HOST: "127.0.0.1",
      // no proxy container: it would take ports 80/443 and replace a developer's own hx_edge
      HOSTERAX_EDGE_PROVIDER: "external",
      HOSTERAX_PULL_RETRY_MS: "2000,5000",
    },
  });
  admin = engine.bootstrap;
});

after(async () => {
  if (engine && admin) {
    for (const p of ["realdemo", "realbuild", "localdemo", "realtag", "realnet"])
      await api("DELETE", `/api/projects/${p}?permanent=true`).catch(() => {});
  }
  await h.cleanup();
  await fx?.stop();
  if (why) return;
  for (const docker of [remote, local]) {
    docker("rm", "-f", "hx_realdemo", "hx_realdemo_green", "hx_realbuild", "hx_localdemo");
    docker("rmi", "-f", "hosterax/realbuild:latest");
  }
  await second?.stop();
});

/** A test that is skipped (with the reason) when the environment cannot run it. */
const real = (name, fn) =>
  test(name, async (t) => {
    if (why) return t.skip(why);
    await fn(t);
  });

async function deploy(name) {
  const r = await api("POST", `/api/projects/${name}/deploy`, {});
  assert.equal(r.status, 200, r.text);
  const dep = await h.until(
    async () => {
      const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
      return d && ["ready", "failed", "cancelled"].includes(d.phase) ? d : null;
    },
    240000,
    "the deployment to finish",
  );
  const log = (await api("GET", `/api/deployments/${r.data.id}/logs`)).text;
  if (dep.phase !== "ready") assert.fail(`deployment ${dep.phase}\n${String(log).slice(-3500)}`);
  return { dep, log };
}
const get = async (port, path = "/") => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: r.status, text: await r.text() };
};
const project = async (name) => (await api("GET", `/api/projects/${name}`)).data;

real("a server is added, confirmed and tested against the real Docker daemon", async () => {
  const added = await api("POST", "/api/servers", {
    name: "Real Docker box",
    type: "remote",
    host: fx.host,
    port: fx.port,
    username: fx.username,
  });
  assert.equal(added.status, 201, added.text);
  serverId = added.data.id;
  const scan = (await api("GET", `/api/servers/${serverId}/host-key`)).data;
  assert.equal(
    (
      await api("POST", `/api/servers/${serverId}/host-key`, {
        fingerprint: scan.keys[0].fingerprint,
      })
    ).status,
    200,
  );
  fx.authorizeKey(added.data.public_key);
  const t = await api("POST", `/api/servers/${serverId}/test`);
  assert.equal(t.data.ok, true, t.text);
  const s = (await api("GET", `/api/servers/${serverId}`)).data;
  assert.equal(
    s.docker_version,
    `Docker v${remote("version", "--format", "{{.Server.Version}}").stdout.trim()}`,
  );
  assert.equal(s.status, "online");
  assert.equal(s.os_info.length > 0, true);
});

real(
  "deploying an image runs a real container on the server, reachable only through the forward",
  async () => {
    assert.equal(
      remote("image", "inspect", IMAGE).status !== 0,
      true,
      "the server starts without the image",
    );
    const created = await api("POST", "/api/projects", {
      name: "realdemo",
      source: IMAGE,
      target: "docker",
      serverId,
      env: { GREETING: "hello from hosterax" },
    });
    assert.equal(created.status, 201, created.text);

    const { log } = await deploy("realdemo");
    assert.match(
      log,
      /Successfully pulled|Pulling verified candidate/,
      "the engine pulled the image itself",
    );
    assert.equal(remote("image", "inspect", IMAGE).status, 0, "and it is now on the server");

    // the container exists on the server's Docker, running, with the settings the engine promised
    assert.equal(ids(remote, "hx_realdemo").length, 1);
    assert.equal(inspect(remote, "hx_realdemo", "{{.State.Status}}"), "running");
    assert.equal(
      inspect(remote, "hx_realdemo", "{{.HostConfig.RestartPolicy.Name}}"),
      "unless-stopped",
    );
    assert.equal(inspect(remote, "hx_realdemo", "{{.HostConfig.Init}}"), "true");
    const p = await project("realdemo");
    const binding = JSON.parse(
      inspect(remote, "hx_realdemo", '{{json (index .HostConfig.PortBindings "80/tcp")}}'),
    );
    assert.deepEqual(binding, [{ HostIp: "127.0.0.1", HostPort: String(p.remote_port) }]);

    // the app answers through the engine's forward
    const page = await get(p.port);
    assert.equal(page.status, 200);
    assert.match(page.text, /Welcome to nginx!/);
    // and the environment really reached the container
    assert.equal(
      remote("exec", "hx_realdemo", "printenv", "GREETING").stdout.trim(),
      "hello from hosterax",
    );

    // the server's own port is on its loopback only, never on a public address
    assert.deepEqual(
      listenersOn(p.remote_port),
      ["127.0.0.1"],
      "the server's port is open on its loopback and nowhere else",
    );

    if (isolated) {
      assert.deepEqual(
        ids(local, "hx_realdemo"),
        [],
        "nothing was started on the engine's own Docker",
      );
      assert.equal(local("image", "inspect", "hosterax/realdemo:latest").status !== 0, true);
    }
  },
);

real("stop, start and restart really stop, start and restart the container", async () => {
  const startedAt = () => inspect(remote, "hx_realdemo", "{{.State.StartedAt}}");
  let r = await api("POST", "/api/projects/realdemo/stop");
  assert.equal(r.status, 200, r.text);
  assert.equal(inspect(remote, "hx_realdemo", "{{.State.Status}}"), "exited");
  const p = await project("realdemo");
  await assert.rejects(get(p.port), /fetch failed/, "the forward has nothing behind it");

  r = await api("POST", "/api/projects/realdemo/start");
  assert.equal(r.status, 200, r.text);
  assert.equal(inspect(remote, "hx_realdemo", "{{.State.Status}}"), "running");
  await h.until(
    async () => (await get(p.port).catch(() => ({ status: 0 }))).status === 200,
    15000,
    "the app",
  );

  const before = startedAt();
  await new Promise((res) => setTimeout(res, 1100));
  r = await api("POST", "/api/projects/realdemo/restart");
  assert.equal(r.status, 200, r.text);
  assert.notEqual(startedAt(), before, "the container was restarted");
  await h.until(
    async () => (await get(p.port).catch(() => ({ status: 0 }))).status === 200,
    15000,
    "the app",
  );
});

real("container logs come back from the server", async () => {
  const p = await project("realdemo");
  await get(p.port, "/from-the-test");
  const logs = await api("GET", "/api/logs/search?project=realdemo&limit=100");
  assert.equal(logs.status, 200, logs.text);
  assert.match(logs.text, /GET \/from-the-test HTTP/);
});

real("a redeploy replaces the container (new id) and keeps the same address", async () => {
  const before = { id: ids(remote, "hx_realdemo")[0], p: await project("realdemo") };
  await deploy("realdemo");
  const after = { id: ids(remote, "hx_realdemo")[0], p: await project("realdemo") };
  assert.notEqual(after.id, before.id, "a new container replaced the old one");
  assert.equal(ids(remote, "hx_realdemo_green").length, 0, "no candidate container is left over");
  assert.equal(after.p.port, before.p.port);
  assert.equal(after.p.remote_port, before.p.remote_port);
  assert.equal((await get(after.p.port)).status, 200);
});

real("a Dockerfile project is really built on the server through the bridge", async () => {
  const dir = join(h.scratch, "app");
  mkdirSync(dir, { recursive: true });
  const stamp = `built on the server ${Date.now()}`;
  writeFileSync(
    join(dir, "Dockerfile"),
    `FROM ${IMAGE}\nCOPY index.html /usr/share/nginx/html/index.html\n`,
  );
  writeFileSync(join(dir, "index.html"), `<h1>${stamp}</h1>\n`);
  const created = await api("POST", "/api/projects", {
    name: "realbuild",
    source: dir,
    target: "docker",
    serverId,
  });
  assert.equal(created.status, 201, created.text);

  const { log } = await deploy("realbuild");
  assert.match(log, /docker build/);
  assert.equal(
    remote("image", "inspect", "hosterax/realbuild:latest").status,
    0,
    "the image exists on the server",
  );
  if (isolated)
    assert.notEqual(
      local("image", "inspect", "hosterax/realbuild:latest").status,
      0,
      "and not on the engine's Docker",
    );
  const p = await project("realbuild");
  const page = await get(p.port);
  assert.match(page.text, new RegExp(stamp), "the page served is the one that was built");
});

real("rolling back replays an earlier release on the server", async () => {
  const deps = (await api("GET", "/api/projects/realdemo/deployments?limit=10")).data;
  const list = Array.isArray(deps) ? deps : deps.deployments;
  const first = [...list].reverse().find((d) => d.phase === "ready");
  assert.ok(first, "there is an earlier release");
  const before = ids(remote, "hx_realdemo")[0];
  const r = await api("POST", `/api/deployments/${first.id}/rollback`);
  assert.equal(r.status, 200, r.text);
  await h.until(
    async () => {
      const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
      return d.phase === "ready" ? d : d.phase === "failed" ? assert.fail("rollback failed") : null;
    },
    240000,
    "the rollback",
  );
  assert.notEqual(ids(remote, "hx_realdemo")[0], before);
  assert.equal((await get((await project("realdemo")).port)).status, 200);
});

real("a tag you chose is the image that runs, not a different variant of it", async () => {
  const created = await api("POST", "/api/projects", {
    name: "realtag",
    source: "nginx:stable-alpine",
    target: "docker",
    serverId,
  });
  assert.equal(created.status, 201, created.text);
  await deploy("realtag");
  assert.equal(inspect(remote, "hx_realtag", "{{.Config.Image}}"), "nginx:stable-alpine");
  await api("DELETE", "/api/projects/realtag?permanent=true");
  await h.until(() => ids(remote, "hx_realtag").length === 0, 20000, "the container to be removed");
});

real(
  "a registry that cannot be reached fails the deploy; it never runs a different image",
  async () => {
    const before = remote("images", "-q").stdout.trim().split("\n").sort();
    const created = await api("POST", "/api/projects", {
      name: "realnet",
      // nothing listens there: a connection error, which says nothing about whether the image exists
      source: "127.0.0.1:59999/team/app:1.0",
      target: "docker",
      serverId,
    });
    assert.equal(created.status, 201, created.text);
    const r = await api("POST", "/api/projects/realnet/deploy", {});
    const dep = await h.until(
      async () => {
        const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
        return ["ready", "failed"].includes(d.phase) ? d : null;
      },
      120000,
      "the deployment to fail",
    );
    assert.equal(dep.phase, "failed");
    const log = (await api("GET", `/api/deployments/${r.data.id}/logs`)).text;
    assert.match(log, /Other images are NOT tried/);
    assert.doesNotMatch(log, /linuxserver|bitnami/, "no other publisher was tried");
    assert.deepEqual(
      remote("images", "-q").stdout.trim().split("\n").sort(),
      before,
      "nothing was pulled",
    );
    assert.deepEqual(ids(remote, "hx_realnet"), []);
    await api("DELETE", "/api/projects/realnet?permanent=true");
  },
);

real("a project on this machine still runs on this machine's Docker", async () => {
  const created = await api("POST", "/api/projects", {
    name: "localdemo",
    source: IMAGE,
    target: "docker",
  });
  assert.equal(created.status, 201, created.text);
  local("pull", IMAGE);
  await deploy("localdemo");
  assert.equal(ids(local, "hx_localdemo").length, 1, "it is on the engine's own Docker");
  assert.equal(inspect(local, "hx_localdemo", "{{.State.Status}}"), "running");
  if (isolated) assert.deepEqual(ids(remote, "hx_localdemo"), [], "and not on the server");
  // ask nginx from inside the container: the engine's local port is chosen from 3000 and some machines
  // intercept well-known ports, which says nothing about the engine
  const inside = local("exec", "hx_localdemo", "wget", "-qO-", "http://127.0.0.1/");
  assert.match(inside.stdout, /Welcome to nginx!/);
  assert.equal((await project("localdemo")).serverId, "local");
});

real(
  "deleting a project removes its container from the server and closes the forward",
  async () => {
    const p = await project("realdemo");
    const r = await api("DELETE", "/api/projects/realdemo?permanent=true");
    assert.equal(r.status, 200, r.text);
    await h.until(
      () => ids(remote, "hx_realdemo").length === 0,
      20000,
      "the container to be removed",
    );
    await h.until(
      async () =>
        (await get(p.port)
          .then(() => null)
          .catch(() => true)) === true,
      10000,
      "the forward to close",
    );
    // a server that still runs a project cannot be removed; once the projects are gone it can
    assert.equal((await api("DELETE", `/api/servers/${serverId}`)).status, 400);
    await api("DELETE", "/api/projects/realbuild?permanent=true");
    await h.until(
      () => ids(remote, "hx_realbuild").length === 0,
      20000,
      "the second container to be removed",
    );
    const del = await api("DELETE", `/api/servers/${serverId}`);
    assert.equal(del.data.ok, true, del.text);
    // the key is removed shortly after the server is
    await h.until(
      () => !existsSync(join(engine.home, "ssh", serverId, "id")),
      10000,
      "the server's key to be removed",
    );
  },
);
