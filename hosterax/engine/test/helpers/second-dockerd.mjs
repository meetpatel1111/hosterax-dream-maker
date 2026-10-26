// Starts a second, real Docker daemon on its own socket, data directory and bridge network, so a test can
// use it as "the other machine": containers started there are not visible to the machine's own Docker.
// Needs root and the `dockerd` binary; used only when HOSTERAX_TEST_SECOND_DOCKERD=1.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function canStartDockerd() {
  return (
    process.platform === "linux" &&
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    spawnSync("dockerd", ["--version"], { stdio: "ignore" }).status === 0
  );
}

/** @returns {Promise<{ host: string, stop: () => Promise<void> }>} */
export async function startSecondDockerd() {
  // Short paths: containerd puts unix sockets under the exec root, and those paths are length-limited.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hxd-"));
  const sock = path.join(dir, "docker.sock");
  const subnet = 200 + Math.floor(Math.random() * 50);
  const child = spawn(
    "dockerd",
    [
      "--host",
      `unix://${sock}`,
      "--data-root",
      path.join(dir, "data"),
      "--exec-root",
      path.join(dir, "exec"),
      "--pidfile",
      path.join(dir, "dockerd.pid"),
      "--bip",
      `172.31.${subnet}.1/24`,
      "--iptables=false",
      "--ip6tables=false",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let log = "";
  child.stderr.on("data", (d) => (log = (log + d).slice(-4000)));
  const host = `unix://${sock}`;
  const up = () =>
    spawnSync("docker", ["info"], {
      env: { ...process.env, DOCKER_HOST: host },
      stdio: "ignore",
      timeout: 5000,
    }).status === 0;
  for (let i = 0; i < 90 && !up(); i++) {
    if (child.exitCode !== null) throw new Error(`the second dockerd exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up()) {
    child.kill("SIGKILL");
    throw new Error(`the second dockerd did not start:\n${log}`);
  }
  return {
    host,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        const t = setTimeout(() => (child.kill("SIGKILL"), r()), 20000);
        child.once("exit", () => (clearTimeout(t), r()));
      });
      // the data root is a mount until the daemon has fully shut down
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    },
  };
}
