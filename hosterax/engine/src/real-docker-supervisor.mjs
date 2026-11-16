#!/usr/bin/env node
// Real Docker Daemon Supervisor for gVisor / Linux containers.
// Runs genuine dockerd (containerd + hx-crun) inside a 65536-UID user/net namespace,
// bridges RootlessKit API, DNS, outbound HTTP/HTTPS, and published host ports cleanly.
import http from "node:http";
import net from "node:net";
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_BRIDGE_PATH = path.join(__dirname, "real-docker-inner-bridge.mjs");

const BASE = process.env.HX_DOCKER_STATE || "/tmp/udocker";
const DOCKER_SOCK = process.env.HX_DOCKER_SOCK || "/var/run/docker.sock";
const DOCKER_PID_FILE = process.env.HX_DOCKER_PID || "/var/run/docker.pid";
const DATA_ROOT = process.env.HX_DOCKER_DATA || "/var/lib/docker";
const EXEC_ROOT = `${BASE}/exec`;
const RUN_DIR = `${BASE}/run`;
const RK_DIR = `${BASE}/rk`;
const INGRESS_SOCK = `${BASE}/ingress.sock`;
const EGRESS_SOCK = `${BASE}/egress.sock`;
const DNS_SOCK = `${BASE}/dns.sock`;
const HOST_FWD_SOCK = `${BASE}/hostfwd.sock`;
const BRIDGE_STATE_FILE = `${BASE}/bridge-state.json`;
const READY_FIFO = `${BASE}/ready_fifo`;
const DOCKERD_LOG = process.env.HX_DOCKER_LOG || "/tmp/docker-daemon.log";

let unshareChild = null;
let unsharePid = null;
let shuttingDown = false;
const activePortListeners = new Map(); // `${bindIp}:${publicPort}` -> { server, target, containerId }
const hostFwdTargets = new Set(); // ports explicitly allowed from inner-bridge -> outer 127.0.0.1

function log(msg) {
  console.log(`[real-docker-supervisor] ${new Date().toISOString()} ${msg}`);
}

function ensureHostPrereqs() {
  for (const dir of [BASE, EXEC_ROOT, RUN_DIR, RK_DIR, DATA_ROOT, path.dirname(DOCKER_SOCK)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Ensure cgroup v1 mounts exist (gVisor supports cpu, cpuacct, cpuset, memory, systemd)
  try {
    execSync(
      `mountpoint -q /sys/fs/cgroup || mount -t tmpfs -o mode=755 cgroup /sys/fs/cgroup;
       for s in cpu cpuacct cpuset memory; do
         mkdir -p /sys/fs/cgroup/$s;
         mountpoint -q /sys/fs/cgroup/$s || mount -t cgroup -o $s cgroup /sys/fs/cgroup/$s 2>/dev/null || true;
       done;
       mkdir -p /sys/fs/cgroup/systemd;
       mountpoint -q /sys/fs/cgroup/systemd || mount -t cgroup -o none,name=systemd cgroup /sys/fs/cgroup/systemd 2>/dev/null || true`,
      { stdio: "ignore" },
    );
  } catch {}
  try {
    execSync(
      "update-alternatives --set iptables /usr/sbin/iptables-legacy 2>/dev/null || true; update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy 2>/dev/null || true",
      { stdio: "ignore" },
    );
  } catch {}
  try {
    if (!fs.existsSync("/usr/local/lib/libgvisor_crun.so") && fs.existsSync("/usr/bin/tcc")) {
      fs.mkdirSync("/usr/local/lib", { recursive: true });
      const shimSrc = `${BASE}/gvisor_ioctl_shim.c`;
      fs.writeFileSync(
        shimSrc,
        `#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <sys/ioctl.h>
#ifndef SIOCSIFFLAGS
#define SIOCSIFFLAGS 0x8914
#endif
#ifndef SIOCGIFFLAGS
#define SIOCGIFFLAGS 0x8913
#endif
int ioctl(int fd, unsigned long request, ...) {
  static int (*real_ioctl)(int, unsigned long, ...) = 0;
  if (!real_ioctl) real_ioctl = dlsym(RTLD_NEXT, "ioctl");
  va_list ap;
  va_start(ap, request);
  void *arg = va_arg(ap, void *);
  va_end(ap);
  int r = real_ioctl(fd, request, arg);
  if (r == -1 && errno == ENOTTY && (request == SIOCSIFFLAGS || request == SIOCGIFFLAGS)) {
    errno = 0;
    return 0;
  }
  return r;
}
`,
      );
      execSync(`tcc -shared -fPIC -o /usr/local/lib/libgvisor_crun.so ${shimSrc} -ldl`, {
        stdio: "ignore",
      });
    }
    if (!fs.existsSync("/usr/local/bin/hx-crun") && fs.existsSync("/usr/local/lib/libgvisor_crun.so")) {
      fs.mkdirSync("/usr/local/bin", { recursive: true });
      fs.writeFileSync(
        "/usr/local/bin/hx-crun",
        "#!/bin/sh\nexport LD_PRELOAD=/usr/local/lib/libgvisor_crun.so\nexec /usr/bin/crun \"$@\"\n",
      );
      fs.chmodSync("/usr/local/bin/hx-crun", 0o755);
    }
    if (!fs.existsSync("/usr/lib/docker/cli-plugins/docker-compose") && fs.existsSync("/usr/bin/docker-compose")) {
      fs.mkdirSync("/usr/lib/docker/cli-plugins", { recursive: true });
      fs.writeFileSync(
        "/usr/lib/docker/cli-plugins/docker-compose",
        `#!/bin/sh
if [ "$1" = "docker-cli-plugin-metadata" ]; then
  echo '{"SchemaVersion":"0.1.0","Vendor":"Docker Inc.","Version":"1.29.2","ShortDescription":"Docker Compose"}'
  exit 0
fi
if [ "$1" = "compose" ]; then shift; fi
exec /usr/bin/docker-compose "$@"
`,
      );
      fs.chmodSync("/usr/lib/docker/cli-plugins/docker-compose", 0o755);
    }
  } catch {}
}

function getUpstreamDnsServer() {
  try {
    const raw = fs.readFileSync("/etc/resolv.conf", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*nameserver\s+([0-9.]+)/);
      if (m && m[1] !== "127.0.0.1") return m[1];
    }
  } catch {}
  return "8.8.8.8";
}

function cleanupOldSockets() {
  for (const p of [EGRESS_SOCK, DNS_SOCK, HOST_FWD_SOCK, BRIDGE_STATE_FILE, `${RK_DIR}/api.sock`, READY_FIFO]) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

// Host-forward server: inner-bridge connects -> sends "<port>\n" -> connects to outer 127.0.0.1:<port>
function startHostFwdServer() {
  const srv = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let bridged = false;
    const onData = (chunk) => {
      if (bridged) return;
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        if (buf.length > 256) client.destroy();
        return;
      }
      bridged = true;
      client.removeListener("data", onData);
      const port = Number(buf.slice(0, nl).toString("utf8").trim());
      const rest = buf.slice(nl + 1);
      if (!Number.isFinite(port) || port < 1 || port > 65535 || !hostFwdTargets.has(port)) {
        client.destroy();
        return;
      }
      const upstream = net.connect({ host: "127.0.0.1", port });
      upstream.on("connect", () => {
        if (rest.length > 0) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
    client.on("error", () => {});
  });
  srv.listen(HOST_FWD_SOCK, () => {
    try {
      fs.chmodSync(HOST_FWD_SOCK, 0o666);
    } catch {}
  });
  return srv;
}

// 1. RootlessKit API server on /tmp/udocker/rk/api.sock
function startRootlessKitApi() {
  const apiSock = `${RK_DIR}/api.sock`;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url?.startsWith("/v1/info")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            APIVersion: "1.1.0",
            StateDir: RK_DIR,
            ChildPID: unsharePid || process.pid,
            NetworkDriver: { Driver: "slirp4netns" },
            PortDriver: { Driver: "builtin", Opaque: {} },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/v1/ports")) {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ID: 1, Spec: JSON.parse(body || "{}") }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  srv.listen(apiSock, () => {
    try {
      fs.chmodSync(apiSock, 0o666);
    } catch {}
  });
  return srv;
}

// 2. Outbound HTTP + CONNECT proxy over EGRESS_SOCK
function startEgressProxy() {
  const srv = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let bridged = false;

    const onData = (chunk) => {
      if (bridged) return;
      buf = Buffer.concat([buf, chunk]);
      const hdrEnd = buf.indexOf("\r\n\r\n");
      if (hdrEnd === -1) {
        if (buf.length > 16384) client.destroy();
        return;
      }
      bridged = true;
      client.removeListener("data", onData);
      const head = buf.slice(0, hdrEnd).toString("utf8");
      const rest = buf.slice(hdrEnd + 4);
      const firstLine = head.split("\r\n")[0] || "";
      const parts = firstLine.split(" ");
      const method = (parts[0] || "").toUpperCase();
      const target = parts[1] || "";

      if (method === "CONNECT") {
        const idx = target.lastIndexOf(":");
        const host = idx > 0 ? target.slice(0, idx) : target;
        const port = idx > 0 ? Number(target.slice(idx + 1)) || 443 : 443;
        const upstream = net.connect({ host, port });
        upstream.on("connect", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length > 0) upstream.write(rest);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => {
          try {
            client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          } catch {}
        });
        client.on("error", () => upstream.destroy());
      } else {
        let host = "";
        let port = 80;
        let pathPart = target;
        try {
          if (/^https?:\/\//i.test(target)) {
            const u = new URL(target);
            host = u.hostname;
            port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
            pathPart = u.pathname + u.search;
          }
        } catch {}
        if (!host) {
          const hm = head.match(/^Host:\s*([^\r\n]+)/im);
          if (hm) {
            const rawHost = hm[1].trim();
            const idx = rawHost.lastIndexOf(":");
            host = idx > 0 ? rawHost.slice(0, idx) : rawHost;
            port = idx > 0 ? Number(rawHost.slice(idx + 1)) || 80 : 80;
          }
        }
        if (!host) return client.destroy();
        const rebuiltHead = head
          .replace(firstLine, `${method} ${pathPart || "/"} ${parts[2] || "HTTP/1.1"}`)
          .replace(/^Proxy-Connection:[^\r\n]*\r\n/gim, "");
        const upstream = net.connect({ host, port });
        upstream.on("connect", () => {
          upstream.write(rebuiltHead + "\r\n\r\n");
          if (rest.length > 0) upstream.write(rest);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => {
          try {
            client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          } catch {}
        });
        client.on("error", () => upstream.destroy());
      }
    };

    client.on("data", onData);
    client.on("error", () => {});
  });
  srv.listen(EGRESS_SOCK, () => {
    try {
      fs.chmodSync(EGRESS_SOCK, 0o666);
    } catch {}
  });
  return srv;
}

// 3. DNS relay over DNS_SOCK -> host /etc/resolv.conf nameserver
function startDnsRelay() {
  const upstreamDns = getUpstreamDnsServer();
  const srv = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    client.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length < 2 + len) break;
        const query = buf.slice(2, 2 + len);
        buf = buf.slice(2 + len);
        const udp = dgram.createSocket("udp4");
        const timeout = setTimeout(() => {
          try {
            udp.close();
          } catch {}
        }, 4000);
        udp.on("message", (reply) => {
          clearTimeout(timeout);
          try {
            const frame = Buffer.alloc(2 + reply.length);
            frame.writeUInt16BE(reply.length, 0);
            reply.copy(frame, 2);
            client.write(frame);
          } catch {}
          try {
            udp.close();
          } catch {}
        });
        udp.on("error", () => {
          clearTimeout(timeout);
          try {
            udp.close();
          } catch {}
        });
        udp.send(query, 53, upstreamDns);
      }
    });
    client.on("error", () => {});
  });
  srv.listen(DNS_SOCK, () => {
    try {
      fs.chmodSync(DNS_SOCK, 0o666);
    } catch {}
  });
  return srv;
}

// 4. Published container port synchronization -> binds host 127.0.0.1:<PublicPort>
function dockerGetJson(apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: DOCKER_SOCK, path: apiPath, timeout: 3000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function readProcListeningPorts(procDir) {
  const ports = new Set();
  for (const file of ["tcp", "tcp6"]) {
    try {
      const raw = fs.readFileSync(`${procDir}/net/${file}`, "utf8");
      for (const line of raw.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols[3] !== "0A") continue;
        const hexPort = cols[1]?.split(":")[1];
        if (!hexPort) continue;
        const p = parseInt(hexPort, 16);
        if (p > 0 && p < 65536) ports.add(p);
      }
    } catch {}
  }
  return ports;
}

let lastBridgeStateJson = "";
let syncingPorts = false;
async function syncPublishedPorts() {
  if (syncingPorts || shuttingDown) return;
  syncingPorts = true;
  try {
    const containers = await dockerGetJson("/v1.41/containers/json");
    if (!Array.isArray(containers)) return;
    const desired = new Map();
    const bridgeGatewayTargets = []; // { publicPort, target } for inner 172.17.0.1:<PublicPort> -> container (host.docker.internal)
    const innerBoundPorts = new Set([18123, 18080, 18443, 53]);

    for (const c of containers) {
      if (c.State !== "running") continue;
      const nets = c.NetworkSettings?.Networks || {};
      const firstNet = Object.values(nets)[0];
      const containerIp = firstNet?.IPAddress || "127.0.0.1";
      for (const p of c.Ports || []) {
        if (p.Type !== "tcp" || !p.PublicPort || !p.PrivatePort) continue;
        const bindIp = p.IP === "0.0.0.0" || !p.IP ? "127.0.0.1" : p.IP;
        if (bindIp.includes(":")) continue; // skip duplicate v6 binding
        const key = `${bindIp}:${p.PublicPort}`;
        const target = `${containerIp}:${p.PrivatePort}`;
        desired.set(key, {
          bindIp,
          publicPort: p.PublicPort,
          target,
          containerId: c.Id,
        });
        bridgeGatewayTargets.push({ publicPort: p.PublicPort, target });
        innerBoundPorts.add(p.PublicPort);
      }
    }

    // Forward --network host container services running inside unshare netns (e.g. hx_edge 80, 443, 2019)
    if (unsharePid) {
      const innerPorts = readProcListeningPorts(`/proc/${unsharePid}`);
      for (const p of innerPorts) {
        innerBoundPorts.add(p);
        // Only bridge well-known / non-ephemeral host-net listeners from inside unshare (skip supervisor proxies & ephemeral)
        if (p === 18123 || p === 18080 || p === 18443 || p === 53 || hostFwdTargets.has(p) || p >= 32768) continue;
        const key = `127.0.0.1:${p}`;
        if (!desired.has(key)) {
          desired.set(key, {
            bindIp: "127.0.0.1",
            publicPort: p,
            target: `127.0.0.1:${p}`,
            containerId: "host-net",
          });
        }
      }
    }

    // Discover outer host listening TCP ports (engine 7777, process/static apps, certbot 49180)
    // so hx_edge & bridged containers inside unshare can reach 127.0.0.1:<port> and host.docker.internal:<port>
    const outerPorts = [];
    const selfPorts = readProcListeningPorts("/proc/self");
    const activeOuterPorts = new Set();
    for (const k of activePortListeners.keys()) {
      const p = Number(k.split(":")[1]);
      if (p) activeOuterPorts.add(p);
    }
    hostFwdTargets.clear();
    for (const p of selfPorts) {
      if (activeOuterPorts.has(p) || desired.has(`127.0.0.1:${p}`) || innerBoundPorts.has(p)) continue;
      if (p === 8000 || p >= 60000) continue; // skip platform control-plane API / high ephemeral
      hostFwdTargets.add(p);
      outerPorts.push(p);
    }
    outerPorts.sort((a, b) => a - b);

    const stateJson = JSON.stringify({ bridgeGatewayTargets, outerPorts });
    if (stateJson !== lastBridgeStateJson) {
      lastBridgeStateJson = stateJson;
      try {
        fs.writeFileSync(BRIDGE_STATE_FILE, stateJson);
      } catch {}
    }

    // Close removed ports or update changed targets
    for (const [key, entry] of activePortListeners.entries()) {
      const want = desired.get(key);
      if (!want || want.target !== entry.target) {
        try {
          entry.server.close();
        } catch {}
        activePortListeners.delete(key);
      }
    }

    // Bind newly published ports
    for (const [key, want] of desired.entries()) {
      if (activePortListeners.has(key)) continue;
      const srv = net.createServer((client) => {
        const up = net.connect(INGRESS_SOCK);
        up.on("connect", () => {
          up.write(`${want.target}\n`);
          client.pipe(up);
          up.pipe(client);
        });
        up.on("error", () => client.destroy());
        client.on("error", () => up.destroy());
      });
      srv.on("error", () => {
        activePortListeners.delete(key);
      });
      srv.listen(want.publicPort, want.bindIp);
      activePortListeners.set(key, {
        server: srv,
        target: want.target,
        containerId: want.containerId,
      });
    }
  } catch {
  } finally {
    syncingPorts = false;
  }
}

function subscribeDockerEvents() {
  const req = http.get(
    { socketPath: DOCKER_SOCK, path: "/v1.41/events?filters=%7B%22type%22%3A%5B%22container%22%5D%7D" },
    (res) => {
      res.on("data", () => {
        void syncPublishedPorts();
      });
      res.on("end", () => {
        if (!shuttingDown) setTimeout(subscribeDockerEvents, 1500);
      });
    },
  );
  req.on("error", () => {
    if (!shuttingDown) setTimeout(subscribeDockerEvents, 1500);
  });
}

function startDockerDaemon() {
  ensureHostPrereqs();
  cleanupOldSockets();

  try {
    fs.unlinkSync(DOCKER_SOCK);
  } catch {}
  try {
    fs.unlinkSync(DOCKER_PID_FILE);
  } catch {}
  try {
    execSync(`rm -rf ${EXEC_ROOT} && mkdir -p ${EXEC_ROOT}`, { stdio: "ignore" });
  } catch {}

  startRootlessKitApi();
  startEgressProxy();
  startDnsRelay();
  startHostFwdServer();

  execSync(`mkfifo ${READY_FIFO}`);

  const crunBin = fs.existsSync("/usr/local/bin/hx-crun") ? "/usr/local/bin/hx-crun" : "/usr/bin/crun";
  const innerScript = `
    read dummy < ${READY_FIFO}
    export XDG_RUNTIME_DIR=${RUN_DIR}
    export ROOTLESSKIT_STATE_DIR=${RK_DIR}
    export HTTP_PROXY=http://127.0.0.1:18123
    export HTTPS_PROXY=http://127.0.0.1:18123
    export NO_PROXY=localhost,127.0.0.1,::1
    export http_proxy=http://127.0.0.1:18123
    export https_proxy=http://127.0.0.1:18123
    node ${JSON.stringify(INNER_BRIDGE_PATH)} &
    exec dockerd --rootless --group=root \\
      --add-runtime crun=${crunBin} --default-runtime=crun \\
      --host=unix://${DOCKER_SOCK} \\
      --pidfile=${DOCKER_PID_FILE} \\
      --exec-root=${EXEC_ROOT} \\
      --data-root=${DATA_ROOT} \\
      --storage-driver=vfs \\
      --dns 172.17.0.1 \\
      --iptables=false --ip-masq=false
  `;

  const logFd = fs.openSync(DOCKERD_LOG, "a");
  unshareChild = spawn("unshare", ["-U", "-n", "--mount-proc", "--fork", "sh", "-c", innerScript], {
    stdio: ["ignore", logFd, logFd],
  });
  unsharePid = unshareChild.pid;

  // Wait briefly for unshare process to enter userns, then write full 65536 UID/GID map
  const mapTimer = setInterval(() => {
    try {
      const uidMapPath = `/proc/${unsharePid}/uid_map`;
      const gidMapPath = `/proc/${unsharePid}/gid_map`;
      if (!fs.existsSync(uidMapPath)) return;
      clearInterval(mapTimer);
      fs.writeFileSync(uidMapPath, "0 0 65536\n");
      fs.writeFileSync(gidMapPath, "0 0 65536\n");
      const wfd = fs.openSync(READY_FIFO, "w");
      fs.writeSync(wfd, "go\n");
      fs.closeSync(wfd);
      log(`Started real dockerd inside user/net namespace (PID ${unsharePid}) on ${DOCKER_SOCK}`);
    } catch {}
  }, 50);

  unshareChild.on("exit", (code, sig) => {
    log(`dockerd userns process exited (code=${code}, sig=${sig})`);
    if (!shuttingDown) {
      setTimeout(() => process.exit(1), 200);
    }
  });

  setInterval(() => void syncPublishedPorts(), 400);
  setTimeout(subscribeDockerEvents, 1500);
}

function shutdown() {
  shuttingDown = true;
  for (const { server } of activePortListeners.values()) {
    try {
      server.close();
    } catch {}
  }
  activePortListeners.clear();
  if (unsharePid) {
    try {
      execSync(`pkill -P ${unsharePid} 2>/dev/null || true`, { stdio: "ignore" });
      process.kill(unsharePid, "SIGTERM");
    } catch {}
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startDockerDaemon();
