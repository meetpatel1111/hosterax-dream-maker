import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { probePort, isUnusable, choosePort } from "../src/port-check.mjs";

/** What allocateProjectPort does for a project it knows nothing about: the wanted port, counting up past `avoid`. */
const pick = (wanted, avoid) => {
  let port = wanted ? Number(wanted) : 3000;
  while (avoid.has(port)) port += 1;
  return port;
};

/** A machine where the engine is not root (it cannot bind below 1024) and `busy` ports are in use. */
const nonRoot =
  (...busy) =>
  async (port) =>
    busy.includes(port) ? "EADDRINUSE" : port < 1024 ? "EACCES" : null;

test("probing reports a port in use, a free port, and why a port cannot be bound", async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  assert.equal(await probePort(port), "EADDRINUSE");
  await new Promise((r) => srv.close(r));
  assert.equal(await probePort(port), null);

  const refusing = () => {
    const fake = new (class extends net.Server {})();
    fake.listen = () =>
      setImmediate(() => fake.emit("error", Object.assign(new Error("x"), { code: "EACCES" })));
    return fake;
  };
  assert.equal(await probePort(80, "127.0.0.1", refusing), "EACCES");
});

test("a port Docker publishes only has to be unused; a port the engine binds must also be bindable", () => {
  assert.equal(isUnusable(null, { bindable: false }), false);
  assert.equal(isUnusable("EADDRINUSE", { bindable: false }), true);
  assert.equal(isUnusable("EACCES", { bindable: false }), false, "Docker binds it as root");
  assert.equal(isUnusable("EACCES", { bindable: true }), true, "the engine could not");
  assert.equal(isUnusable("EADDRNOTAVAIL", { bindable: true }), true);
});

test("a non-root engine whose usual port is taken lands in the app range, not on 80, 81, 82 ...", async () => {
  // the case that failed on a CI runner: the project's port (3000) is taken, and the container listens on 80
  const probed = [];
  const probe = async (port) => (probed.push(port), nonRoot(3000)(port));
  const port = await choosePort({ pick, wanted: 80, bindable: true, probe });
  assert.notEqual(port, 3000, "the taken one");
  assert.ok(port >= 1024, `got ${port}`);
  assert.ok(!probed.some((p) => p < 1024), `probed a port it cannot bind: ${probed}`);
});

test("Docker may publish a well-known port even though this process cannot bind it", async () => {
  assert.equal(await choosePort({ pick, wanted: 80, bindable: false, probe: nonRoot() }), 80);
});

test("a taken well-known port is replaced from the app range", async () => {
  const port = await choosePort({ pick, wanted: 80, bindable: false, probe: nonRoot(80) });
  assert.ok(port >= 3000 && port < 3100, `got ${port}`);
});

test("a project that already runs keeps its own port, which is of course in use", async () => {
  assert.equal(await choosePort({ pick, wanted: 3000, owned: 3000, probe: nonRoot(3000) }), 3000);
});

test("it gives up with a clear error rather than looping when nothing is usable", async () => {
  await assert.rejects(
    choosePort({ pick, wanted: 3000, bindable: true, probe: async () => "EADDRINUSE" }),
    /no free port/,
  );
});

/** A server that "binds" to anything, as macOS does next to a wildcard listener on the same port. */
const alwaysBinds = () => ({
  once() {},
  listen(port, host, done) {
    setImmediate(done);
  },
  close(done) {
    done();
  },
});

test("a port something listens on counts as in use even where binding next to it succeeds (macOS)", async () => {
  const wild = net.createServer();
  await new Promise((r) => wild.listen(0, "0.0.0.0", r));
  const { port } = wild.address();
  try {
    assert.equal(await probePort(port, "127.0.0.1", alwaysBinds), "EADDRINUSE");
  } finally {
    await new Promise((r) => wild.close(r));
  }
  assert.equal(await probePort(port, "127.0.0.1", alwaysBinds), null, "free again once it closes");
});
