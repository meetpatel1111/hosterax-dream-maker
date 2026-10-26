// A stand-in Docker daemon for tests: speaks enough of the Docker Engine HTTP API for the real `docker`
// CLI to pull an image, run a container, inspect it, read its logs, stop, rename and remove it.
// "Running" a container starts a tiny HTTP server on the host port it asked to publish, so the engine's
// health checks and forwards have a real app to talk to. No image is ever built or executed.
//
// Usage: node fake-dockerd.mjs <socket> <request-log> <ports-file>
// It runs as its own process because the tests call the Docker CLI with spawnSync.

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const [socketPath, logFile, portsFile] = process.argv.slice(2);
const API = "1.45";
const containers = new Map(); // name -> container
const images = new Map(); // ref -> config
const log = (line) => fs.appendFileSync(logFile, `${line}\n`);

function publishedPorts() {
  const out = [];
  for (const c of containers.values())
    if (c.running)
      for (const [cp, binds] of Object.entries(c.hostConfig.PortBindings || {}))
        for (const b of binds || []) out.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort}->${cp}`);
  fs.writeFileSync(portsFile, out.join("\n") + (out.length ? "\n" : ""));
}

function find(ref) {
  if (containers.has(ref)) return containers.get(ref);
  for (const c of containers.values()) if (c.id === ref || c.id.startsWith(ref)) return c;
  return null;
}

function startApp(c) {
  c.apps = [];
  for (const [cp, binds] of Object.entries(c.hostConfig.PortBindings || {})) {
    for (const b of binds || []) {
      const app = http.createServer((req, res) => {
        if (req.url === "/env") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify(c.config.Env || []));
        }
        res.end(`fake container ${c.name} (${c.config.Image}) on ${cp}`);
      });
      app.on("error", (err) => {
        c.startError = err.message;
      });
      app.listen(Number(b.HostPort), b.HostIp || "0.0.0.0");
      c.apps.push(app);
    }
  }
}

function stopApp(c) {
  for (const a of c.apps || []) a.close();
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
    HostConfig: c.hostConfig,
    NetworkSettings: {
      Ports: Object.fromEntries(
        Object.entries(c.hostConfig.PortBindings || {}).map(([k, v]) => [k, v]),
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

http
  .createServer(async (req, res) => {
    log(`${req.method} ${req.url}`);
    const u = new URL(req.url, "http://x");
    const p = u.pathname.replace(/^\/v[0-9.]+/, "");
    const q = u.searchParams;
    let m;

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
    if (p === "/version")
      return json(res, 200, {
        Version: "27.0.1-fake",
        ApiVersion: API,
        MinAPIVersion: "1.24",
        Os: "linux",
        Arch: "amd64",
        KernelVersion: "6.0.0-fake",
        Components: [{ Name: "Engine", Version: "27.0.1-fake", Details: {} }],
      });

    // images
    if (p === "/images/create" && req.method === "POST") {
      const ref = `${q.get("fromImage")}${q.get("tag") ? `:${q.get("tag")}` : ""}`;
      // The image's own settings, as an image of a web app would declare them.
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
        JSON.stringify({ status: `Pulling from ${q.get("fromImage")}`, id: q.get("tag") }) + "\r\n",
      );
      res.write(JSON.stringify({ status: `Status: Downloaded newer image for ${ref}` }) + "\r\n");
      return res.end();
    }
    if ((m = p.match(/^\/images\/(.+)\/json$/))) {
      const ref = decodeURIComponent(m[1]);
      const cfg = images.get(ref) || images.get(`${ref}:latest`);
      if (!cfg) return json(res, 404, { message: `No such image: ${ref}` });
      return json(res, 200, {
        Id: `sha256:${crypto.createHash("sha256").update(ref).digest("hex")}`,
        RepoTags: [ref],
        Os: "linux",
        Architecture: "amd64",
        Size: 1000,
        Created: "2024-01-01T00:00:00Z",
        Config: cfg,
        RootFS: { Type: "layers", Layers: [] },
      });
    }

    // containers
    if (p === "/containers/json")
      return json(
        res,
        200,
        [...containers.values()]
          .filter((c) => c.running || q.get("all") === "1" || q.get("all") === "true")
          .map((c) => ({
            Id: c.id,
            Names: [`/${c.name}`],
            Image: c.config.Image,
            State: c.running ? "running" : "exited",
            Status: c.running ? "Up" : "Exited (0)",
            Ports: [],
            Labels: {},
          })),
      );
    if (p === "/containers/create" && req.method === "POST") {
      const b = await body(req);
      const name = q.get("name") || `fake_${crypto.randomBytes(3).toString("hex")}`;
      if (containers.has(name))
        return json(res, 409, {
          message: `Conflict. The container name "/${name}" is already in use`,
        });
      const ref = b.Image;
      if (!images.has(ref) && !images.has(`${ref}:latest`))
        return json(res, 404, { message: `No such image: ${ref}` });
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
    if ((m = p.match(/^\/containers\/([^/]+)\/(json|logs|start|stop|restart|kill|rename|wait)$/))) {
      const c = find(decodeURIComponent(m[1]));
      if (!c) return notFound(res, m[1]);
      const action = m[2];
      if (action === "json") return json(res, 200, view(c));
      if (action === "logs") {
        const text = `fake container ${c.name} started\n${c.startError ? `error: ${c.startError}\n` : ""}`;
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
    if ((m = p.match(/^\/containers\/([^/]+)$/)) && req.method === "DELETE") {
      const c = find(decodeURIComponent(m[1]));
      if (!c) return notFound(res, m[1]);
      stopApp(c);
      containers.delete(c.name);
      publishedPorts();
      return empty(res);
    }

    json(res, 404, { message: `fake daemon: no route for ${req.method} ${p}` });
  })
  .listen(socketPath, () => console.log("ready"));
