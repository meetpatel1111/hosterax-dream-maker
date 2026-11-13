// hosterax/engine/test/helpers/fake-dockerd.mjs
// Universal Mock & Simulated Docker Engine HTTP REST API Daemon for HosteraX
// Speaks Docker Engine API v1.45: supports docker CLI commands (ps, run, exec, images, networks, volumes, inspect, logs, stop, rm)
// Starting a container starts a real HTTP listener on the published host port for real health probes.

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const socketPath = process.argv[2] || "/var/run/docker.sock";
const logFile = process.argv[3] || "/tmp/docker-daemon.log";
const portsFile = process.argv[4] || "/tmp/docker-daemon.ports";
const API = "1.45";

const containers = new Map(); // name -> container
const images = new Map(); // ref -> config
const networks = new Map([
  ["bridge", { Name: "bridge", Id: "net_bridge_01", Driver: "bridge", Scope: "local" }],
  ["host", { Name: "host", Id: "net_host_02", Driver: "host", Scope: "local" }],
  ["none", { Name: "none", Id: "net_none_03", Driver: "null", Scope: "local" }],
]);
const volumes = new Map();

// Seed common base images so CLI doesn't fail on basic pulls
const DEFAULT_IMAGE_REFS = [
  "nginx:alpine",
  "caddy:2-alpine",
  "alpine",
  "alpine:latest",
  "redis:alpine",
  "postgres:16-alpine",
  "docker.io/library/nginx:alpine",
  "docker.io/library/caddy:2-alpine",
];

for (const ref of DEFAULT_IMAGE_REFS) {
  images.set(ref, {
    ExposedPorts: { "80/tcp": {}, "443/tcp": {} },
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    Cmd: ["run"],
    Entrypoint: null,
  });
}

const log = (line) => {
  try {
    if (logFile) fs.appendFileSync(logFile, `${line}\n`);
  } catch {}
};

function publishedPorts() {
  const out = [];
  for (const c of containers.values())
    if (c.running)
      for (const [cp, binds] of Object.entries(c.hostConfig?.PortBindings || {}))
        for (const b of binds || []) out.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort}->${cp}`);
  try {
    if (portsFile) fs.writeFileSync(portsFile, out.join("\n") + (out.length ? "\n" : ""));
  } catch {}
}

function find(ref) {
  if (containers.has(ref)) return containers.get(ref);
  for (const c of containers.values()) if (c.id === ref || c.id.startsWith(ref)) return c;
  return null;
}

function startApp(c) {
  c.apps = [];
  for (const [cp, binds] of Object.entries(c.hostConfig?.PortBindings || {})) {
    for (const b of binds || []) {
      const port = Number(b.HostPort);
      if (!port || isNaN(port)) continue;
      const app = http.createServer((req, res) => {
        if (req.url === "/env") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify(c.config?.Env || []));
        }
        if (req.url === "/health" || req.url === "/_ping") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ status: "healthy", container: c.name, uptime: 100 }));
        }
        res.end(`HosteraX container ${c.name} (${c.config?.Image || "app"}) on ${cp}\n`);
      });
      app.on("error", (err) => {
        c.startError = err.message;
      });
      try {
        app.listen(port, b.HostIp || "0.0.0.0");
        c.apps.push(app);
      } catch (err) {
        c.startError = err.message;
      }
    }
  }
}

function stopApp(c) {
  for (const a of c.apps || []) {
    try {
      a.close();
    } catch {}
  }
  c.apps = [];
}

function view(c) {
  return {
    Id: c.id,
    Name: `/${c.name}`,
    Created: new Date(c.created).toISOString(),
    Path: "fake",
    Args: [],
    State: {
      Status: c.running ? "running" : "exited",
      Running: c.running,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Pid: c.running ? 4242 : 0,
      ExitCode: 0,
      Error: "",
      StartedAt: new Date(c.created).toISOString(),
      FinishedAt: "0001-01-01T00:00:00Z",
    },
    Image: c.imageId,
    Config: { ...c.config, Tty: false },
    HostConfig: c.hostConfig || {},
    NetworkSettings: {
      Ports: Object.fromEntries(
        Object.entries(c.hostConfig?.PortBindings || {}).map(([k, v]) => [k, v]),
      ),
    },
    Mounts: [],
  };
}

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "API-Version": API, OSType: "linux" });
  res.end(JSON.stringify(body));
};

const empty = (res, code = 204) => {
  res.writeHead(code, { "API-Version": API, OSType: "linux" });
  res.end();
};

const notFound = (res, what) => json(res, 404, { message: `No such container: ${what}` });

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

// Seed demo containers on startup
function seedInitialContainers() {
  const demoAppId = crypto.randomBytes(32).toString("hex");
  const edgeId = crypto.randomBytes(32).toString("hex");

  const demoApp = {
    id: demoAppId,
    name: "hx_demo_app",
    created: Date.now() - 60000,
    imageId: `sha256:${crypto.createHash("sha256").update("nginx:alpine").digest("hex")}`,
    config: {
      Image: "nginx:alpine",
      Env: ["PORT=80", "HOST=0.0.0.0", "HOSTERAX_ENVIRONMENT=production"],
    },
    hostConfig: {
      PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "3001" }] },
      RestartPolicy: { Name: "unless-stopped" },
    },
    running: true,
    apps: [],
  };

  const edge = {
    id: edgeId,
    name: "hx_edge",
    created: Date.now() - 120000,
    imageId: `sha256:${crypto.createHash("sha256").update("caddy:2-alpine").digest("hex")}`,
    config: { Image: "caddy:2-alpine", Env: ["PORT=443"] },
    hostConfig: {
      NetworkMode: "host",
      RestartPolicy: { Name: "always" },
    },
    running: true,
    apps: [],
  };

  const alpineOciId = crypto.randomBytes(32).toString("hex");
  const alpineOci = {
    id: alpineOciId,
    name: "alpine_real_oci",
    created: Date.now() - 30000,
    imageId: `sha256:${crypto.createHash("sha256").update("alpine:latest").digest("hex")}`,
    config: { Image: "alpine:latest", Env: ["PORT=3009", "RUNTIME=crun-oci"] },
    hostConfig: {
      PortBindings: { "3009/tcp": [{ HostIp: "0.0.0.0", HostPort: "3009" }] },
      RestartPolicy: { Name: "unless-stopped" },
    },
    running: true,
    apps: [],
  };

  containers.set("hx_demo_app", demoApp);
  containers.set("hx_edge", edge);
  containers.set("alpine_real_oci", alpineOci);
  startApp(demoApp);
  publishedPorts();
}

seedInitialContainers();

// Clean up socket file if pre-existing
try {
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
} catch {}

const server = http.createServer(async (req, res) => {
  log(`${req.method} ${req.url}`);
  const u = new URL(req.url, "http://x");
  const p = u.pathname.replace(/^\/v[0-9.]+/, "");
  const q = u.searchParams;
  let m;

  // Ping
  if (p === "/_ping") {
    res.writeHead(200, {
      "API-Version": API,
      OSType: "linux",
      "Docker-Experimental": "false",
      "Builder-Version": "2",
      "Content-Type": "text/plain",
    });
    return res.end(req.method === "HEAD" ? undefined : "OK");
  }

  // Version
  if (p === "/version") {
    return json(res, 200, {
      Version: "29.1.3",
      ApiVersion: API,
      MinAPIVersion: "1.24",
      Os: "linux",
      Arch: "amd64",
      KernelVersion: "6.0.0-hosterax",
      Components: [{ Name: "Engine", Version: "29.1.3", Details: {} }],
    });
  }

  // Info
  if (p === "/info") {
    return json(res, 200, {
      ID: "HOSTERAX-DOCKER-NODE-01",
      Containers: containers.size,
      ContainersRunning: [...containers.values()].filter((c) => c.running).length,
      ContainersPaused: 0,
      ContainersStopped: [...containers.values()].filter((c) => !c.running).length,
      Images: images.size,
      Driver: "overlay2",
      SystemTime: new Date().toISOString(),
      LoggingDriver: "json-file",
      CgroupDriver: "cgroupfs",
      KernelVersion: "6.0.0-hosterax",
      OperatingSystem: "Debian GNU/Linux 12 (bookworm)",
      OSType: "linux",
      Architecture: "x86_64",
      NCPU: 4,
      MemTotal: 8 * 1024 * 1024 * 1024,
      ServerVersion: "29.1.3",
    });
  }

  // Networks
  if (p === "/networks") {
    return json(res, 200, [...networks.values()]);
  }
  if ((m = p.match(/^\/networks\/([^/]+)$/))) {
    const net = networks.get(m[1]) || [...networks.values()].find((n) => n.Id === m[1]);
    if (!net) return json(res, 404, { message: `network ${m[1]} not found` });
    return json(res, 200, net);
  }
  if (p === "/networks/create" && req.method === "POST") {
    const b = await body(req);
    const id = `net_${crypto.randomBytes(8).toString("hex")}`;
    const net = { Name: b.Name || id, Id: id, Driver: b.Driver || "bridge", Scope: "local" };
    networks.set(net.Name, net);
    return json(res, 201, { Id: net.Id, Warnings: [] });
  }

  // Volumes
  if (p === "/volumes") {
    return json(res, 200, { Volumes: [...volumes.values()], Warnings: [] });
  }
  if (p === "/volumes/create" && req.method === "POST") {
    const b = await body(req);
    const name = b.Name || `vol_${crypto.randomBytes(6).toString("hex")}`;
    const vol = {
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      CreatedAt: new Date().toISOString(),
    };
    volumes.set(name, vol);
    return json(res, 201, vol);
  }

  // Images
  if (p === "/images/json") {
    const list = [];
    for (const [ref, cfg] of images.entries()) {
      if (ref.includes("@")) continue;
      list.push({
        Id: `sha256:${crypto.createHash("sha256").update(ref).digest("hex")}`,
        RepoTags: [ref],
        Created: 1700000000,
        Size: 26214400, // ~25MB
        SharedSize: 0,
        VirtualSize: 26214400,
        Labels: {},
      });
    }
    return json(res, 200, list);
  }

  if (p === "/images/create" && req.method === "POST") {
    const ref = `${q.get("fromImage")}${q.get("tag") ? `:${q.get("tag")}` : ""}`;
    const cfg = ref.includes("nopull")
      ? null
      : {
          ExposedPorts: { "80/tcp": {} },
          Env: ["PATH=/usr/bin"],
          Cmd: ["serve"],
          Entrypoint: null,
        };
    if (!cfg) return json(res, 404, { message: `pull access denied for ${ref}` });
    images.set(ref, cfg);
    images.set(ref.replace(/^docker\.io\/(library\/)?/, ""), cfg);
    res.writeHead(200, { "Content-Type": "application/json", "API-Version": API });
    res.write(
      JSON.stringify({
        status: `Pulling from ${q.get("fromImage")}`,
        id: q.get("tag") || "latest",
      }) + "\r\n",
    );
    res.write(JSON.stringify({ status: `Status: Downloaded newer image for ${ref}` }) + "\r\n");
    return res.end();
  }

  if ((m = p.match(/^\/images\/(.+)\/json$/))) {
    const ref = decodeURIComponent(m[1]);
    const cfg = images.get(ref) ||
      images.get(`${ref}:latest`) || {
        ExposedPorts: { "80/tcp": {} },
        Env: ["PATH=/usr/bin"],
        Cmd: ["run"],
      };
    return json(res, 200, {
      Id: `sha256:${crypto.createHash("sha256").update(ref).digest("hex")}`,
      RepoTags: [ref],
      Os: "linux",
      Architecture: "amd64",
      Size: 26214400,
      Created: "2024-01-01T00:00:00Z",
      Config: cfg,
      RootFS: { Type: "layers", Layers: [] },
    });
  }

  // Containers List
  if (p === "/containers/json") {
    return json(
      res,
      200,
      [...containers.values()]
        .filter((c) => c.running || q.get("all") === "1" || q.get("all") === "true")
        .map((c) => ({
          Id: c.id,
          Names: [`/${c.name}`],
          Image: c.config?.Image || "app:latest",
          State: c.running ? "running" : "exited",
          Status: c.running ? "Up" : "Exited (0)",
          Ports: Object.entries(c.hostConfig?.PortBindings || {}).flatMap(([cp, binds]) =>
            (binds || []).map((b) => ({
              IP: b.HostIp || "0.0.0.0",
              PrivatePort: Number(cp.split("/")[0]),
              PublicPort: Number(b.HostPort),
              Type: cp.split("/")[1] || "tcp",
            })),
          ),
          Labels: c.config?.Labels || {},
        })),
    );
  }

  // Create Container
  if (p === "/containers/create" && req.method === "POST") {
    const b = await body(req);
    const name = q.get("name") || `hx_${crypto.randomBytes(4).toString("hex")}`;
    if (containers.has(name)) {
      return json(res, 409, {
        message: `Conflict. The container name "/${name}" is already in use`,
      });
    }
    const ref = b.Image || "alpine:latest";
    // Auto-register image if not yet pulled
    if (!images.has(ref)) {
      images.set(ref, {
        ExposedPorts: { "80/tcp": {} },
        Env: ["PATH=/usr/bin"],
        Cmd: ["run"],
      });
    }
    const c = {
      id: crypto.randomBytes(32).toString("hex"),
      name,
      created: Date.now(),
      imageId: `sha256:${crypto.createHash("sha256").update(ref).digest("hex")}`,
      config: b,
      hostConfig: b.HostConfig || {},
      running: false,
      apps: [],
    };
    containers.set(name, c);
    return json(res, 201, { Id: c.id, Warnings: [] });
  }

  // Container Specific Actions
  if (
    (m = p.match(/^\/containers\/([^/]+)\/(json|logs|stats|start|stop|restart|kill|rename|wait)$/))
  ) {
    const c = find(decodeURIComponent(m[1]));
    if (!c) return notFound(res, m[1]);
    const action = m[2];

    if (action === "json") return json(res, 200, view(c));

    if (action === "stats") {
      res.writeHead(200, { "Content-Type": "application/json", "API-Version": API });
      return res.end(
        JSON.stringify({
          read: new Date().toISOString(),
          cpu_stats: { cpu_usage: { total_usage: 120000000 }, system_cpu_usage: 1000000000 },
          memory_stats: { usage: 48 * 1024 * 1024, limit: 1024 * 1024 * 1024 },
          networks: { eth0: { rx_bytes: 10240, tx_bytes: 20480 } },
        }),
      );
    }

    if (action === "logs") {
      const text = `HosteraX container ${c.name} running\nReady for incoming requests\n${c.startError ? `error: ${c.startError}\n` : ""}`;
      const frame = Buffer.alloc(8 + Buffer.byteLength(text));
      frame[0] = 1;
      frame.writeUInt32BE(Buffer.byteLength(text), 4);
      frame.write(text, 8);
      res.writeHead(200, {
        "Content-Type": "application/vnd.docker.multiplexed-stream",
        "API-Version": API,
      });
      return res.end(frame);
    }

    if (action === "start") {
      if (!c.running) {
        c.running = true;
        startApp(c);
        publishedPorts();
      }
      return empty(res);
    }

    if (action === "stop" || action === "kill") {
      c.running = false;
      stopApp(c);
      publishedPorts();
      return empty(res);
    }

    if (action === "restart") {
      stopApp(c);
      c.running = true;
      startApp(c);
      publishedPorts();
      return empty(res);
    }

    if (action === "rename") {
      containers.delete(c.name);
      c.name = q.get("name");
      containers.set(c.name, c);
      return empty(res);
    }

    if (action === "wait") return json(res, 200, { StatusCode: 0 });
  }

  // Delete container
  if ((m = p.match(/^\/containers\/([^/]+)$/)) && req.method === "DELETE") {
    const c = find(decodeURIComponent(m[1]));
    if (!c) return notFound(res, m[1]);
    stopApp(c);
    containers.delete(c.name);
    publishedPorts();
    return empty(res);
  }

  // Prune endpoints
  if (p === "/containers/prune" && req.method === "POST") {
    return json(res, 200, { ContainersDeleted: [], SpaceReclaimed: 0 });
  }
  if (p === "/images/prune" && req.method === "POST") {
    return json(res, 200, { ImagesDeleted: [], SpaceReclaimed: 0 });
  }

  json(res, 404, { message: `fake daemon: no route for ${req.method} ${p}` });
});

server.listen(socketPath, () => {
  try {
    fs.chmodSync(socketPath, 0o666);
  } catch {}
  console.log(`HosteraX Docker Daemon listening on ${socketPath}`);
});

process.on("SIGTERM", () => {
  try {
    server.close();
    fs.unlinkSync(socketPath);
  } catch {}
  process.exit(0);
});
