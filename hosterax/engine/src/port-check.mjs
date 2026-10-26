// Choosing a TCP port that something else on this machine is not already using.

import net from "node:net";

/**
 * Tries to listen on `port`. Resolves null when nothing uses it, otherwise the error code (EADDRINUSE, EACCES, ...).
 *
 * Binding is not enough to know a port is free: on macOS and the BSDs a socket can bind 127.0.0.1:P next to
 * another process that listens on the wildcard address (0.0.0.0 or ::) of the same port, so the probe succeeds
 * and the next listener silently takes over the loopback side of the other one's port (the engine's own, in a
 * test). Connecting is what settles it: if anything accepts, the port is in use.
 */
export async function probePort(
  port,
  host = "127.0.0.1",
  createServer = net.createServer,
  connect = net.connect,
) {
  const bindError = await new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", (err) => resolve(err?.code || "UNKNOWN"));
    srv.listen(port, host, () => srv.close(() => resolve(null)));
  });
  if (bindError) return bindError;
  for (const where of ["127.0.0.1", "::1"])
    if (await somethingAccepts(port, where, connect)) return "EADDRINUSE";
  return null;
}

function somethingAccepts(port, host, connect) {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    const done = (answer) => {
      sock.destroy();
      resolve(answer);
    };
    sock.setTimeout(500, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/**
 * Whether a port must not be handed out, given what probing it said.
 * A port that Docker publishes only has to be unused: Docker binds it as root, so "permission denied" for this
 * process (every port below 1024 when the engine is not root) says nothing about it. A port the engine binds
 * itself (a forward to a remote server, a process or static app) must also be one it is allowed to bind.
 */
export function isUnusable(code, { bindable = false } = {}) {
  if (code === null) return false;
  return bindable ? true : code === "EADDRINUSE";
}

/**
 * The first port `pick` offers that is usable. `pick(wanted, avoid)` proposes a port, never one in `avoid`.
 * Below 1024 the engine usually cannot bind, and when a well-known port such as 80 is taken the next candidates
 * come from the app range rather than from counting up through 81, 82, ... (none of which would be usable).
 */
export async function choosePort({
  pick,
  wanted = null,
  bindable = false,
  owned = null,
  probe = probePort,
}) {
  const avoid = new Set();
  let want = wanted;
  if (bindable && Number(want) < 1024) want = 3000;
  for (let attempt = 0; attempt < 500; attempt++) {
    const port = pick(want, avoid);
    if (port === owned || !isUnusable(await probe(port), { bindable })) return port;
    avoid.add(port);
    if (Number(want) < 1024) want = 3000;
  }
  throw new Error("no free port could be found on this machine");
}
