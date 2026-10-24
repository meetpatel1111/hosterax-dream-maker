// Self-healing for a project on a remote server: it must look at the SERVER's Docker, restart it THERE,
// and do nothing at all while the server cannot be reached. The server's Docker is a stand-in daemon on a
// unix socket (helpers/fake-dockerd.mjs); the engine code under test is the real SelfHealEngine.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SelfHealEngine } from "../src/self-heal.mjs";
import { DockerApiClient } from "../src/docker-api.mjs";
import { currentServerId } from "../src/docker-scope.mjs";

const skip = process.platform === "win32" ? "needs a unix socket" : false;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hx-sh-"));
const sock = path.join(dir, "d.sock");
const log = path.join(dir, "requests.log");
let daemon;
let appPort;
let app;
const freePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const requests = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const raw = (method, p, body) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: sock, method, path: p, headers: { "content-type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });

before(async () => {
  if (skip) return;
  fs.writeFileSync(log, "");
  fs.writeFileSync(path.join(dir, "ports"), "");
  daemon = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./helpers/fake-dockerd.mjs", import.meta.url)),
      sock,
      log,
      path.join(dir, "ports"),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise((r) => daemon.stdout.once("data", r));
  app = http.createServer((q, r) => r.end("ok"));
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  appPort = app.address().port;
});
after(async () => {
  daemon?.kill("SIGKILL");
  await new Promise((r) => (app ? app.close(r) : r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

function make({ ready = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (name TEXT PRIMARY KEY, port INTEGER, target TEXT, status TEXT, enabled INTEGER DEFAULT 1, server_id TEXT);
    CREATE TABLE deployments (id TEXT PRIMARY KEY, project TEXT, phase TEXT, started_at INTEGER, finished_at INTEGER, exit_code INTEGER);
    INSERT INTO projects VALUES ('vault', ${appPort}, 'docker', 'running', 1, 'srv_a');
    INSERT INTO deployments VALUES ('d1', 'vault', 'ready', 1000, 2000, 0);
  `);
  const restarted = [];
  const state = { ready };
  const heal = new SelfHealEngine({
    db,
    HOME: dir,
    publish: () => {},
    dockerApi: null, // this machine's Docker must never be consulted for a remote project
    restartService: async (project) => restarted.push([project, currentServerId()]),
    rollbackService: async () => {},
    servers: {
      statusOf: () => ({
        name: "Lab VPS",
        ready: state.ready,
        error: state.ready ? null : "Connection refused",
      }),
      dockerApiFor: () => new DockerApiClient({ socketPath: sock }),
      readyRemoteIds: () => (state.ready ? ["srv_a"] : []),
    },
  });
  heal.startTime = 0; // long past the startup grace period
  return {
    db,
    heal,
    restarted,
    state,
    project: () => db.prepare("SELECT * FROM projects WHERE name='vault'").get(),
  };
}

test("a healthy remote container is checked on the server and left alone", { skip }, async () => {
  assert.equal(await raw("POST", "/images/create?fromImage=nginx&tag=alpine"), 200);
  assert.equal(
    await raw("POST", "/containers/create?name=hx_vault", {
      Image: "nginx:alpine",
      HostConfig: {
        PortBindings: { "80/tcp": [{ HostIp: "127.0.0.1", HostPort: String(await freePort()) }] },
      },
    }),
    201,
  );
  // the fake container's own listener is on another port; the project's port (the forward) is the test app
  assert.equal(await raw("POST", "/containers/hx_vault/start"), 204);

  const { heal, restarted, project } = make();
  const before = requests().length;
  await heal.probeProject(project());
  assert.ok(
    requests()
      .slice(before)
      .some((r) => /GET .*\/containers\/hx_vault\/json/.test(r)),
    "the container was inspected on the SERVER's daemon",
  );
  assert.equal(heal.healthMap.get("vault").status, "healthy");
  assert.deepEqual(restarted, []);
});

test("a container that is gone from the server is restarted on that server", { skip }, async () => {
  assert.equal(await raw("DELETE", "/containers/hx_vault?force=1"), 204);
  const { heal, restarted, project } = make();
  // the app's port still answers (something else is listening), so make the port dead to force the failure
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, "127.0.0.1", r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  heal.db.prepare("UPDATE projects SET port=? WHERE name='vault'").run(port);
  await heal.probeProject(project());
  assert.deepEqual(
    restarted,
    [["vault", "srv_a"]],
    "restart ran inside the project's server scope",
  );
  assert.ok(
    heal.events.some(
      (e) =>
        e.eventType === "restart_complete" ||
        e.eventType === "auto_restart" ||
        /restart/i.test(e.eventType),
    ),
  );
});

test(
  "while the server cannot be reached nothing is inspected, restarted or rolled back",
  { skip },
  async () => {
    const { heal, restarted, project } = make({ ready: false });
    const before = requests().length;
    heal.db.prepare("UPDATE projects SET port=1 WHERE name='vault'").run();
    for (let i = 0; i < 3; i++) await heal.probeProject(project());
    assert.equal(requests().length, before, "the daemon was not even asked");
    assert.deepEqual(restarted, []);
    const h = heal.healthMap.get("vault");
    assert.equal(h.status, "unreachable");
    assert.match(h.message, /Lab VPS is unreachable: Connection refused\. Nothing is restarted/);
    assert.equal(
      heal.events.filter((e) => e.eventType === "server_unreachable").length,
      1,
      "reported once, not every 15 seconds",
    );
  },
);

test("a project on this machine is still handled by this machine's Docker", { skip }, async () => {
  const { heal, project, db } = make();
  db.prepare("UPDATE projects SET server_id=NULL, port=1 WHERE name='vault'").run();
  let localAsked = 0;
  heal.dockerApi = {
    inspectContainer: async () => {
      localAsked++;
      return { State: { Status: "running" } };
    },
  };
  await heal.probeProject(project());
  assert.equal(localAsked, 1);
});
