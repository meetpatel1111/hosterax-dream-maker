// Choosing a TCP port that something else on this machine is not already using.

import net from "node:net";

/** Tries to listen on `port`. Resolves null when it could, otherwise the error code (EADDRINUSE, EACCES, ...). */
export function probePort(port, host = "127.0.0.1", createServer = net.createServer) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", (err) => resolve(err?.code || "UNKNOWN"));
    srv.listen(port, host, () => srv.close(() => resolve(null)));
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
