// Apps that run as plain processes: the port they get, and really stopping them.
//
// 1. A first deploy must not be given a port something else on the machine is already listening on (a dev
//    server on 3000, another engine, another app): the app would fail to start with "address already in use".
// 2. A project run as a process must really stop when it is stopped, redeployed or deleted. The engine starts
//    it as `sh -c "<command>"`; on Debian and Ubuntu that shell does not replace itself with the command, so
//    ending only the shell left the app running, still holding its port, while the engine believed it had
//    stopped.
//
// One file, so these tests run one after another. They ask for ports of their own (not the 3000 range every
// other test's apps start from), so they neither take a port another test is about to use nor lose one.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-procs-");
let engine;
let admin;
let squatter;
let squattedPort;
let appDir;
const api = (method, path, body) => h.call(engine, admin, method, path, body);
const PROJECTS = ["portapp", "procapp", "procgone"];

before(async () => {
  appDir = mkdtempSync(join(tmpdir(), "hx-proc-app-"));
  // the app answers with its own process id, so a test can tell one running copy from another
  writeFileSync(
    join(appDir, "server.js"),
    `require("http").createServer((q, r) => r.end(String(process.pid))).listen(Number(process.env.PORT), "127.0.0.1");\n`,
  );
  // Something is already on the port the project would be given first.
  squatter = net.createServer();
  await new Promise((resolve) => squatter.listen(0, "127.0.0.1", resolve));
  squattedPort = squatter.address().port;
  engine = await h.startEngine();
  admin = engine.bootstrap;
});
after(async () => {
  // Whatever goes wrong here, the engine and the listening socket must still be ended: either one left running
  // keeps this file's process, and so the whole test run, from ever finishing.
  let problem;
  try {
    // a project that is still around keeps its app running after the engine is gone
    if (engine && admin)
      for (const name of PROJECTS)
        await api("DELETE", `/api/projects/${name}?permanent=true`).catch(() => {});
    // The engine ends an app in the background; its directory stays locked on Windows until it is gone.
    await h.until(() => [...seen].every((pid) => !alive(pid)), 15000, "the apps to end");
  } catch (e) {
    problem = new Error(
      `${e.message}: still running: ${[...seen].filter(alive).join(", ") || "-"}`,
      {
        cause: e,
      },
    );
    for (const pid of seen) if (alive(pid)) forceKill(pid);
  }
  try {
    await h.cleanup();
  } catch (e) {
    problem ??= e;
  }
  await new Promise((r) => (squatter.listening ? squatter.close(r) : r()));
  if (problem) throw problem;
});

async function deployAndWait(name) {
  const r = await api("POST", `/api/projects/${name}/deploy`, {});
  assert.equal(r.status, 200, r.text);
  const logOf = async () => String((await api("GET", `/api/deployments/${r.data.id}/logs`)).text);
  let dep;
  try {
    dep = await h.until(
      async () => {
        const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
        return d && ["ready", "failed", "cancelled"].includes(d.phase) ? d : null;
      },
      60000,
      "the deployment to finish",
    );
  } catch (e) {
    // a bare "timed out" says nothing about where the deployment stopped
    const now = (await api("GET", `/api/deployments/${r.data.id}`)).data;
    throw new Error(
      `${e.message}; it was in phase "${now?.phase}"\n${(await logOf()).slice(-2500)}\n--- engine output:\n${engine.output().slice(-1500)}`,
      { cause: e },
    );
  }
  assert.equal(dep.phase, "ready", (await logOf()).slice(-1500));
}
/** A port nothing is listening on, to ask for as the project's preferred port. */
const aFreePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const create = async (name, port) =>
  api("POST", "/api/projects", {
    name,
    source: appDir,
    target: "process",
    startCmd: "node server.js",
    port: port ?? (await aFreePort()),
  });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
/** Every app process seen answering, so the cleanup can wait for each of them to be gone. */
const seen = new Set();
const forceKill = (pid) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
};
const pidOf = (port) =>
  new Promise((resolve, reject) =>
    http
      .get({ host: "127.0.0.1", port, path: "/", headers: { connection: "close" } }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          const pid = Number(text);
          if (Number.isInteger(pid) && pid > 0) {
            seen.add(pid);
            return resolve(pid);
          }
          reject(
            new Error(
              `port ${port} answered ${res.statusCode} with ${JSON.stringify(text.slice(0, 200))}, not the app's process id`,
            ),
          );
        });
      })
      .on("error", reject),
  );
const portOf = async (name) => (await api("GET", `/api/projects/${name}`)).data.port;
const gone = (pid) => h.until(() => !alive(pid), 10000, `process ${pid} to be gone`);

test("a first deploy skips a port something else is listening on", async () => {
  const made = await create("portapp", squattedPort);
  assert.equal(made.status, 201, made.text);
  await deployAndWait("portapp");
  const port = await portOf("portapp");
  assert.notEqual(port, squattedPort, "that port was already taken");
  assert.notEqual(port, engine.port, "the engine's own port is never handed to an app");
  assert.ok((await pidOf(port)) > 0, "the app answers on the port it was given");
});

test("a project that has already deployed keeps its port when it is deployed again", async () => {
  const port = await portOf("portapp");
  await deployAndWait("portapp");
  assert.equal(await portOf("portapp"), port);
  assert.ok((await pidOf(port)) > 0);
});

test("redeploying replaces the running app: the old process is gone, not left beside the new one", async () => {
  const made = await create("procapp");
  assert.equal(made.status, 201, made.text);
  await deployAndWait("procapp");
  const port = await portOf("procapp");
  const first = await pidOf(port);
  assert.ok(alive(first));

  await deployAndWait("procapp");
  assert.equal(await portOf("procapp"), port, "the address does not change");
  const second = await pidOf(port);
  assert.notEqual(second, first, "the new version is the one answering");
  await gone(first);
});

test("stopping a project ends its app", async () => {
  const pid = await pidOf(await portOf("procapp"));
  const r = await api("POST", "/api/projects/procapp/stop");
  assert.equal(r.status, 200, r.text);
  await gone(pid);
});

test("deleting a project ends its app", async () => {
  const made = await create("procgone");
  assert.equal(made.status, 201, made.text);
  await deployAndWait("procgone");
  const pid = await pidOf(await portOf("procgone"));
  assert.equal((await api("DELETE", "/api/projects/procgone")).status, 200);
  await gone(pid);
});
