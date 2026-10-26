// The port chosen for a remote app's forward was free when it was chosen. If something else binds it before
// the forward does (another app, another engine), the forward takes any free port instead of failing the deploy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerManager } from "../src/server-manager.mjs";

/** A ServerManager with a stand-in transport: only forward() and its bookkeeping are exercised. */
function manager(forward) {
  const m = Object.create(ServerManager.prototype);
  m.ensureReady = async () => {};
  m.transport = { forward };
  m.bindHost = "127.0.0.1";
  const desired = new Map();
  m._desired = () => desired;
  return { m, desired };
}

test("a forward whose wanted port is taken binds a free one and records it", async () => {
  const asked = [];
  const { m, desired } = manager(async (serverId, opts) => {
    asked.push(opts.localPort);
    if (opts.localPort === 3001)
      throw new Error("listen EADDRINUSE: address already in use 127.0.0.1:3001");
    return 40123;
  });
  const bound = await m.forward("srv", {
    id: "app",
    remotePort: 22001,
    localPort: 3001,
    allowAnyPort: true,
  });
  assert.equal(bound, 40123);
  assert.deepEqual(asked, [3001, 0], "the wanted port first, then any free one");
  assert.deepEqual(desired.get("app"), { remotePort: 22001, localPort: 40123 });
});

test("a forward that gets its wanted port keeps it", async () => {
  const asked = [];
  const { m } = manager(async (serverId, opts) => (asked.push(opts.localPort), opts.localPort));
  assert.equal(await m.forward("srv", { id: "app", remotePort: 22001, localPort: 3002 }), 3002);
  assert.deepEqual(asked, [3002]);
});

test("other failures are not retried, and asking for any port is not retried either", async () => {
  let calls = 0;
  const { m } = manager(async () => {
    calls++;
    throw new Error("the server closed the connection");
  });
  await assert.rejects(m.forward("srv", { id: "a", remotePort: 22001, localPort: 3003 }), /closed/);
  assert.equal(calls, 1, "a different failure is reported as it is");

  calls = 0;
  const busy = manager(async () => {
    calls++;
    throw new Error("listen EADDRINUSE");
  });
  await assert.rejects(busy.m.forward("srv", { id: "b", remotePort: 22001 }), /EADDRINUSE/);
  assert.equal(calls, 1, "with no wanted port there is nothing to fall back from");
});

test("restoring a forward is not moved silently: without the opt-in the failure is reported", async () => {
  const asked = [];
  const { m, desired } = manager(async (serverId, opts) => {
    asked.push(opts.localPort);
    throw new Error("listen EADDRINUSE: address already in use 127.0.0.1:3001");
  });
  await assert.rejects(
    m.forward("srv", { id: "app", remotePort: 22001, localPort: 3001 }),
    /EADDRINUSE/,
  );
  assert.deepEqual(asked, [3001]);
  assert.equal(desired.has("app"), false);
});

test("a port this process is not allowed to bind also falls back, when the caller allows it", async () => {
  const asked = [];
  const { m } = manager(async (serverId, opts) => {
    asked.push(opts.localPort);
    if (opts.localPort === 80) throw new Error("listen EACCES: permission denied 127.0.0.1:80");
    return 40124;
  });
  assert.equal(
    await m.forward("srv", { id: "app", remotePort: 22001, localPort: 80, allowAnyPort: true }),
    40124,
  );
  assert.deepEqual(asked, [80, 0]);
});
