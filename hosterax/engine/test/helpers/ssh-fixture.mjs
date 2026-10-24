// A real sshd on a loopback port, for tests of the remote-server code.
//
// What is real: the OpenSSH server, its host key, public-key authentication, the ssh client and
// ssh-keyscan the engine runs, and (when installed) the Docker CLI. What is a stand-in: the "remote"
// Docker. `docker` on the server's PATH is a small script, and `docker system dial-stdio` bridges to a
// fake Docker daemon (a node HTTP server on a unix socket), so no container is ever started.

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function sshToolsAvailable() {
  if (process.platform === "win32") return false;
  const sshd = ["/usr/sbin/sshd", "/usr/bin/sshd", "/usr/local/sbin/sshd"].find((p) =>
    fs.existsSync(p),
  );
  const have = (bin) => spawnSync(bin, ["-V"], { stdio: "ignore" }).error?.code !== "ENOENT";
  const keygen = spawnSync("ssh-keygen", ["-?"], { stdio: "ignore" }).error?.code !== "ENOENT";
  return Boolean(sshd) && have("ssh") && keygen;
}

function findSshd() {
  return ["/usr/sbin/sshd", "/usr/bin/sshd", "/usr/local/sbin/sshd"].find((p) => fs.existsSync(p));
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

function keygen(file, type = "ed25519", extra = []) {
  const r = spawnSync("ssh-keygen", [
    "-q",
    "-t",
    type,
    "-N",
    "",
    "-C",
    "hx-test",
    "-f",
    file,
    ...extra,
  ]);
  if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
}

/**
 * @returns {Promise<{ host: string, port: number, username: string, clientKey: string,
 *   clientKeyPub: string, hostKeyFile: string, dockerMode: (m: string) => void, daemonRequests: string[],
 *   regenerateHostKey: () => void, stop: () => Promise<void>, dir: string }>}
 */
export async function startSshFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hx-sshd-"));
  fs.chmodSync(dir, 0o700);
  const hostKey = path.join(dir, "host_ed25519");
  keygen(hostKey);
  const clientKey = path.join(dir, "client");
  keygen(clientKey);
  fs.copyFileSync(`${clientKey}.pub`, path.join(dir, "authorized_keys"));
  fs.chmodSync(path.join(dir, "authorized_keys"), 0o600);

  // The fake Docker daemon, reached through `docker system dial-stdio`. It is its own process: the tests
  // call the Docker CLI with spawnSync, which would block a daemon living in the test process.
  const daemonSock = path.join(dir, "dockerd.sock");
  const requestLog = path.join(dir, "daemon-requests.log");
  fs.writeFileSync(requestLog, "");
  const daemonScript = path.join(dir, "fake-dockerd.mjs");
  fs.writeFileSync(
    daemonScript,
    `import http from "node:http";
import fs from "node:fs";
const sock = ${JSON.stringify(daemonSock)};
const log = ${JSON.stringify(requestLog)};
http.createServer((req, res) => {
  fs.appendFileSync(log, req.method + " " + req.url + "\\n");
  const url = req.url.replace(/^\\/v[0-9.]+/, "");
  const headers = { "API-Version": "1.45", OSType: "linux", "Docker-Experimental": "false" };
  if (url === "/_ping") {
    res.writeHead(200, { ...headers, "Content-Type": "text/plain" });
    return res.end(req.method === "HEAD" ? undefined : "OK");
  }
  if (url === "/version") {
    res.writeHead(200, { ...headers, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ Version: "27.0.1-fake", ApiVersion: "1.45", MinAPIVersion: "1.24", Os: "linux", Arch: "amd64", KernelVersion: "6.0.0-fake", GitCommit: "fake", GoVersion: "go1.22", BuildTime: "2024-01-01T00:00:00.000000000+00:00", Components: [{ Name: "Engine", Version: "27.0.1-fake", Details: {} }] }));
  }
  if (url.startsWith("/containers/json")) {
    res.writeHead(200, { ...headers, "Content-Type": "application/json" });
    return res.end("[]");
  }
  res.writeHead(404, { ...headers, "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "fake daemon: no route for " + url }));
}).listen(sock, () => console.log("ready"));
`,
  );
  const daemon = spawn(process.execPath, [daemonScript], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    daemon.stdout.once("data", resolve);
    daemon.once("exit", () => reject(new Error("fake docker daemon failed to start")));
  });
  const daemonRequests = {
    get all() {
      return fs.readFileSync(requestLog, "utf8").split("\n").filter(Boolean);
    },
    get length() {
      return this.all.length;
    },
    some(fn) {
      return this.all.some(fn);
    },
  };

  // Runs on the "server": stdin/stdout <-> the fake daemon's socket.
  const dial = path.join(dir, "dial.mjs");
  fs.writeFileSync(
    dial,
    `import net from "node:net";
const s = net.connect(${JSON.stringify(daemonSock)});
process.stdin.pipe(s);
s.pipe(process.stdout);
s.on("error", () => process.exit(1));
process.stdin.on("end", () => s.end());
s.on("close", () => process.exit(0));
`,
  );
  const fakeBin = path.join(dir, "bin");
  fs.mkdirSync(fakeBin);
  const modeFile = path.join(dir, "docker-mode");
  fs.writeFileSync(modeFile, "ok");
  fs.writeFileSync(
    path.join(fakeBin, "docker"),
    `#!/bin/sh
mode=$(cat ${JSON.stringify(modeFile)})
if [ "$1" = "system" ] && [ "$2" = "dial-stdio" ]; then
  [ "$mode" = "ok" ] || { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
  exec ${JSON.stringify(process.execPath)} ${JSON.stringify(dial)}
fi
case "$1" in
  version)
    case "$mode" in
      ok) echo "27.0.1-fake" ;;
      denied) echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1 ;;
      *) echo "Cannot connect to the Docker daemon. Is the docker daemon running?" >&2; exit 1 ;;
    esac ;;
  ps) printf 'aaa\\nbbb\\n' ;;
  *) echo "fake docker: unsupported: $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );

  const port = await freePort();
  const pidFile = path.join(dir, "sshd.pid");
  const conf = path.join(dir, "sshd_config");
  fs.writeFileSync(
    conf,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${hostKey}`,
      `PidFile ${pidFile}`,
      `AuthorizedKeysFile ${path.join(dir, "authorized_keys")}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "PubkeyAuthentication yes",
      "UsePAM no",
      "PermitRootLogin yes",
      "StrictModes no",
      "PrintMotd no",
      "LogLevel ERROR",
      `SetEnv PATH=${fakeBin}:${process.env.PATH}`,
    ].join("\n") + "\n",
  );
  try {
    fs.mkdirSync("/run/sshd", { recursive: true });
  } catch {}

  const sshd = spawn(findSshd(), ["-D", "-e", "-f", conf], { stdio: ["ignore", "ignore", "pipe"] });
  let sshdErr = "";
  sshd.stderr.on("data", (d) => (sshdErr += d));
  for (let i = 0; i < 100; i++) {
    const up = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("error", () => resolve(false));
    });
    if (up) break;
    if (sshd.exitCode !== null) throw new Error(`sshd exited early: ${sshdErr}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  return {
    dir,
    host: "127.0.0.1",
    port,
    username: os.userInfo().username,
    clientKey: fs.readFileSync(clientKey, "utf8"),
    clientKeyPub: fs.readFileSync(`${clientKey}.pub`, "utf8").trim(),
    hostKeyFile: hostKey,
    daemonRequests,
    /** Let another key log in (what an operator does with the public key HosteraX shows them). */
    authorizeKey(publicKeyLine) {
      fs.appendFileSync(path.join(dir, "authorized_keys"), `${publicKeyLine}\n`);
    },
    dockerMode: (m) => fs.writeFileSync(modeFile, m),
    /**
     * A new host key, as after a reinstall: existing sessions die with the old machine, new connections
     * see the new key. (A session that was authenticated against the old key legitimately stays valid.)
     */
    regenerateHostKey() {
      fs.rmSync(hostKey);
      fs.rmSync(`${hostKey}.pub`);
      keygen(hostKey);
      sshd.kill("SIGHUP");
      const kids = spawnSync("pgrep", ["-P", String(sshd.pid)], { encoding: "utf8" }).stdout;
      for (const pid of kids.split(/\s+/).filter(Boolean)) {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {}
      }
    },
    async stop() {
      sshd.kill("SIGKILL");
      await new Promise((r) => (sshd.exitCode !== null ? r() : sshd.once("exit", r)));
      daemon.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
