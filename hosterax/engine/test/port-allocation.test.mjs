// A first deploy must not be given a port something else on the machine is already listening on (a dev server
// on 3000, another engine, another app): the app would fail to start with "address already in use".

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-ports-");
let engine;
let admin;
let squatter;
let appDir;
const api = (method, path, body) => h.call(engine, admin, method, path, body);

before(async () => {
  appDir = mkdtempSync(join(tmpdir(), "hx-port-app-"));
  writeFileSync(
    join(appDir, "server.js"),
    `require("http").createServer((q, r) => r.end("hello from the app")).listen(Number(process.env.PORT), "127.0.0.1");\n`,
  );
  // Something is already on the port the engine would pick first. (If another process already holds it,
  // that is the same situation.)
  squatter = net.createServer();
  await new Promise((resolve) => {
    squatter.once("error", resolve);
    squatter.listen(3000, "127.0.0.1", resolve);
  });
  engine = await h.startEngine({ env: { HOSTERAX_EDGE_PROVIDER: "external" } });
  admin = engine.bootstrap;
});
after(async () => {
  // deleting the project stops its app; otherwise it outlives the engine and keeps its port
  if (engine && admin) await api("DELETE", "/api/projects/portapp?permanent=true").catch(() => {});
  await h.cleanup();
  await new Promise((r) => (squatter.listening ? squatter.close(r) : r()));
});

async function deployAndWait(name) {
  const r = await api("POST", `/api/projects/${name}/deploy`, {});
  assert.equal(r.status, 200, r.text);
  return h.until(
    async () => {
      const d = (await api("GET", `/api/deployments/${r.data.id}`)).data;
      return d && ["ready", "failed", "cancelled"].includes(d.phase) ? d : null;
    },
    60000,
    "the deployment to finish",
  );
}
const body = (port) =>
  new Promise((resolve, reject) =>
    http
      .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve(text));
      })
      .on("error", reject),
  );

test("a first deploy skips a port something else is listening on", async () => {
  assert.equal(
    (
      await api("POST", "/api/projects", {
        name: "portapp",
        source: appDir,
        target: "process",
        startCmd: "node server.js",
      })
    ).status,
    201,
  );
  const dep = await deployAndWait("portapp");
  const log = (await api("GET", `/api/deployments/${dep.id}/logs`)).text;
  assert.equal(dep.phase, "ready", String(log).slice(-1500));
  const { port } = (await api("GET", "/api/projects/portapp")).data;
  assert.notEqual(port, 3000, "port 3000 was already taken");
  assert.equal(await body(port), "hello from the app");
});

test("a project that is already running keeps its port when it is deployed again", async () => {
  const before = (await api("GET", "/api/projects/portapp")).data.port;
  const dep = await deployAndWait("portapp");
  assert.equal(dep.phase, "ready");
  assert.equal((await api("GET", "/api/projects/portapp")).data.port, before);
  assert.equal(await body(before), "hello from the app");
});
