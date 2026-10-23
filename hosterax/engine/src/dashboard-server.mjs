// Serves the web dashboard from the engine's own port.
//
// The dashboard is a TanStack Start app. `npm run build:engine` (NITRO_PRESET=node-server) emits
// `.output/public` (hashed assets) and `.output/server/index.mjs` (the SSR server). The engine serves
// the assets itself and runs the SSR server as a loopback-only child process, proxying page
// requests to it. A plain static bundle (a directory containing index.html) is also supported.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Paths owned by the engine API; they must never fall through to the dashboard.
const ENGINE_PREFIXES = ["/api/", "/ws", "/webhooks/", "/health", "/mcp"];

// Tells the dashboard it was served by an engine (see src/lib/engine-url.ts): the engine is then this
// page's own origin, whatever port it listens on.
const ENGINE_MARKER = { "server-timing": 'hosterax;desc="served by the engine"' };

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** True when `.output` came from `NITRO_PRESET=node-server` (a Cloudflare worker build is not runnable here). */
function isNodeServerBuild(root) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(root, "nitro.json"), "utf8"));
    return meta.preset === "node-server" || meta.preset === "node";
  } catch {
    return false;
  }
}

export function findDashboardBundle() {
  const roots = [
    process.env.HOSTERAX_DASHBOARD_DIR,
    path.resolve(process.cwd(), ".output"),
    path.resolve(__dirname, "../../../.output"), // monorepo checkout and Docker image
    path.resolve(__dirname, "../dist"), // npm package and desktop app
    path.resolve(process.cwd(), "dist"),
  ]
    .filter(Boolean)
    .map((r) => path.resolve(r));

  for (const root of roots) {
    const publicDir = path.join(root, "public");
    const serverEntry = path.join(root, "server", "index.mjs");
    if (isDir(publicDir)) {
      return {
        root,
        publicDir,
        serverEntry: isFile(serverEntry) && isNodeServerBuild(root) ? serverEntry : null,
      };
    }
    if (isFile(path.join(root, "index.html"))) return { root, publicDir: root, serverEntry: null };
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

export function createDashboard({ log = () => {} } = {}) {
  const bundle = findDashboardBundle();
  let child = null;
  let starting = null;
  let lastFailure = 0;

  function startSsr() {
    if (starting) return starting;
    if (Date.now() - lastFailure < 5000) return Promise.resolve(0);
    starting = (async () => {
      const port = await freePort();
      // The SSR server gets a minimal environment: none of the engine's secrets.
      const proc = spawn(process.execPath, [bundle.serverEntry], {
        cwd: bundle.root,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          PATH: process.env.PATH,
          ELECTRON_RUN_AS_NODE: "1", // when the engine runs inside the desktop app, execPath is Electron
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          NITRO_HOST: "127.0.0.1",
          PORT: String(port),
          NITRO_PORT: String(port),
        },
      });
      child = proc;
      let stderr = "";
      proc.stderr.on("data", (d) => {
        stderr = (stderr + d).slice(-2000);
      });
      proc.on("exit", () => {
        if (child === proc) {
          child = null;
          starting = null;
        }
      });
      const ready = await waitForPort(port, 15000);
      if (!ready) {
        log(`[dashboard] SSR server did not start: ${stderr.trim() || "no output"}`);
        lastFailure = Date.now();
        proc.kill();
        child = null;
        starting = null;
        return 0;
      }
      return port;
    })();
    return starting;
  }

  function serveFile(req, res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      ...(ext === ".html" ? ENGINE_MARKER : {}),
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  }

  function proxy(req, res, port) {
    // The dashboard keeps its token in browser storage; never forward credentials to the SSR child.
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.authorization;
    delete headers.cookie;
    const upstream = http.request(
      { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
      (pres) => {
        res.writeHead(pres.statusCode || 502, { ...pres.headers, ...ENGINE_MARKER });
        pres.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("The dashboard server is unavailable.");
    });
    req.pipe(upstream);
  }

  return {
    available: Boolean(bundle),
    /** Handles a GET/HEAD request; resolves to false when the engine should answer 404 itself. */
    async handle(req, res, pathname) {
      if (!bundle) return false;
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      if (
        ENGINE_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))
      ) {
        return false;
      }

      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        return false;
      }
      const filePath = path.resolve(bundle.publicDir, "." + path.posix.normalize("/" + decoded));
      if (
        filePath.startsWith(bundle.publicDir + path.sep) &&
        isFile(filePath) &&
        path.basename(filePath) !== "index.html"
      ) {
        serveFile(req, res, filePath);
        return true;
      }

      if (bundle.serverEntry) {
        const port = await startSsr();
        if (!port) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("The dashboard server could not be started. Check the engine logs.");
          return true;
        }
        proxy(req, res, port);
        return true;
      }

      const indexPath = path.join(bundle.publicDir, "index.html");
      if (isFile(indexPath)) {
        serveFile(req, res, indexPath);
        return true;
      }
      return false;
    },
    close() {
      if (child) child.kill();
    },
  };
}
