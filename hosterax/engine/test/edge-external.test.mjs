// With the proxy provider set to "external" HosteraX runs no proxy container. It must also leave alone an
// `hx_edge` it did not start: the name is shared by every HosteraX on the same Docker daemon, and removing
// another one's proxy takes its domains down. It does remove the one it started itself when it is switched.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-edge-ext-");
let engine;
let admin;
let log;
const api = (method, path, body) => h.call(engine, admin, method, path, body);
const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
const removals = () => calls().filter((l) => l === "rm -f hx_edge").length;

before(async () => {
  // a `docker` that succeeds at everything and writes down what it was asked to do
  const dir = mkdtempSync(join(tmpdir(), "hx-fake-docker-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  log = join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`);
  chmodSync(join(bin, "docker"), 0o755);
  engine = await h.startEngine({
    path: `${bin}:${process.env.PATH}`,
    env: { HOSTERAX_EDGE_PROVIDER: "external" },
  });
  admin = engine.bootstrap;
});
after(() => h.cleanup());

test("an engine set to external never removes an hx_edge it did not start", async () => {
  assert.equal((await api("GET", "/api/edge/settings")).data.provider, "external");
  assert.equal((await api("POST", "/api/edge/sync")).status, 200);
  assert.equal((await api("POST", "/api/edge/sync")).status, 200);
  assert.equal(removals(), 0, calls().join("\n"));
});

test("switching to a proxy starts one, and switching back to external removes that one", async () => {
  const on = await api("POST", "/api/edge/settings", { provider: "caddy" });
  assert.equal(on.status, 200, on.text);
  await h.until(
    () => calls().some((l) => l.startsWith("run -d --name hx_edge")),
    10000,
    "the proxy to be started",
  );
  await h.until(
    async () => (await api("GET", "/api/edge/settings")).data.is_running === true,
    10000,
    "the engine to record that it started the proxy",
  );
  const before = removals();

  const off = await api("POST", "/api/edge/settings", { provider: "external" });
  assert.equal(off.status, 200, off.text);
  await h.until(() => removals() > before, 10000, "the proxy it started to be removed");
  assert.equal((await api("GET", "/api/edge/settings")).data.is_running, false);
});
