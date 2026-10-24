// hosterax/engine/src/ssh-bridge-worker.mjs
// Runs as its own process (forked by ssh-transport.mjs), one per remote server.
//
// It listens on a unix socket and bridges every connection to `ssh … docker system dial-stdio`, so the
// Docker CLI and the engine's HTTP client can talk to a remote daemon with DOCKER_HOST=unix://…
//
// It is a separate process on purpose: the engine calls `spawnSync("docker", …)` in many places, which
// blocks its event loop. A bridge living in the engine would be unable to answer the very Docker
// command that is waiting for it.

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import { classifySshFailure } from "./ssh-transport.mjs";

const [configPath, alias, socketPath, sshBin] = process.argv.slice(2);
const MAX_CONNECTIONS = 64;

const active = new Set();
const forwards = new Map(); // id -> { server, localPort, remotePort }
let total = 0;
let lastOkAt = null;
const send = (msg) => {
  if (process.connected) process.send(msg, () => {});
};
const sendStats = () => send({ type: "stats", active: active.size, total, lastOkAt });

const server = net.createServer({ allowHalfOpen: true }, (sock) => {
  if (active.size >= MAX_CONNECTIONS) return sock.destroy();
  total += 1;
  let child;
  try {
    child = spawn(sshBin, ["-F", configPath, "--", alias, "docker system dial-stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    send({
      type: "failure",
      failure: { ...classifySshFailure(String(err.message)), at: Date.now() },
    });
    return sock.destroy();
  }
  active.add(child);
  sendStats();
  let stderr = "";
  let produced = false;
  child.stderr.on("data", (d) => {
    if (stderr.length < 4096) stderr += d;
  });
  child.stdout.once("data", () => {
    produced = true;
    lastOkAt = Date.now();
  });
  child.stdin.on("error", () => {});
  sock.on("error", () => child.kill("SIGKILL"));
  sock.pipe(child.stdin);
  child.stdout.pipe(sock);
  sock.on("end", () => child.stdin.end());
  sock.on("close", () => child.kill("SIGKILL"));
  child.on("error", (err) => {
    const failure =
      err.code === "ENOENT"
        ? { code: "no_ssh_client", message: "The OpenSSH client (ssh) is not installed." }
        : classifySshFailure(String(err.message));
    send({ type: "failure", failure: { ...failure, at: Date.now() } });
    sock.destroy();
  });
  child.on("close", (code) => {
    active.delete(child);
    if (code !== 0 && !produced) {
      send({
        type: "failure",
        failure: {
          ...classifySshFailure(stderr),
          detail: stderr.trim().slice(0, 500),
          at: Date.now(),
        },
      });
    }
    sendStats();
    sock.end();
  });
});

// A forward makes an app that listens on the server's loopback reachable on a local port: each connection
// is `ssh -W` over the same multiplexed connection. The app is never published on the server's network.
function openForward({ id, remotePort, localPort = 0, bindHost = "127.0.0.1" }) {
  return new Promise((resolve, reject) => {
    closeForward(id);
    const fwd = net.createServer({ allowHalfOpen: true }, (sock) => {
      if (active.size >= MAX_CONNECTIONS) return sock.destroy();
      let child;
      try {
        child = spawn(sshBin, ["-F", configPath, "-W", `127.0.0.1:${remotePort}`, "--", alias], {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        });
      } catch {
        return sock.destroy();
      }
      active.add(child);
      child.stdin.on("error", () => {});
      sock.on("error", () => child.kill("SIGKILL"));
      sock.on("close", () => child.kill("SIGKILL"));
      sock.on("end", () => child.stdin.end());
      sock.pipe(child.stdin);
      child.stdout.pipe(sock);
      child.on("error", () => sock.destroy());
      child.on("close", () => {
        active.delete(child);
        sock.end();
      });
    });
    fwd.once("error", reject);
    fwd.listen(localPort, bindHost, () => {
      fwd.off("error", reject);
      forwards.set(id, { server: fwd, localPort: fwd.address().port, remotePort });
      resolve(fwd.address().port);
    });
  });
}

function closeForward(id) {
  const f = forwards.get(id);
  if (!f) return;
  forwards.delete(id);
  f.server.close();
}

process.on("message", async (m) => {
  if (m?.type === "forward") {
    try {
      const localPort = await openForward(m);
      send({ type: "forward-ready", id: m.id, requestId: m.requestId, localPort });
    } catch (err) {
      send({
        type: "forward-error",
        id: m.id,
        requestId: m.requestId,
        message: String(err.message),
      });
    }
  } else if (m?.type === "unforward") {
    closeForward(m.id);
    send({ type: "forward-closed", id: m.id, requestId: m.requestId });
  }
});

function shutdown() {
  for (const f of forwards.values()) f.server.close();
  for (const c of active) c.kill("SIGKILL");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// The engine went away (even if it was killed outright): don't leave a bridge and ssh processes behind.
process.on("disconnect", shutdown);

try {
  fs.rmSync(socketPath, { force: true });
} catch {}
server.on("error", (err) => {
  send({ type: "fatal", message: String(err.message) });
  process.exit(1);
});
server.listen(socketPath, () => {
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {}
  send({ type: "ready" });
});
