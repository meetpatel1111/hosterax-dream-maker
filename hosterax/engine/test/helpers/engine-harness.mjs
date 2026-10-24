// Starts real engines (child processes with a private HOME) for end-to-end tests.
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const engineDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export function createHarness(prefix = "hosterax-e2e-") {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const engines = [];

  async function startEngine({ home = null, port = null, env = {}, path } = {}) {
    home ??= mkdtempSync(join(scratch, "home-"));
    port ??= await freePort();
    const base = { ...process.env };
    if (path !== undefined) {
      for (const k of Object.keys(base)) if (k.toLowerCase() === "path") delete base[k];
      base.PATH = path;
    }
    const child = spawn(process.execPath, ["src/index.mjs"], {
      cwd: engineDir,
      env: {
        ...base,
        HOSTERAX_PORT: String(port),
        HOSTERAX_HOME: home,
        // A test engine must not start a proxy container on the developer's Docker (it would take ports
        // 80/443 and replace their own); a test that wants an edge says so.
        HOSTERAX_EDGE_PROVIDER: "external",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        if ((await fetch(`${url}/health`)).ok) break;
      } catch {}
      if (child.exitCode !== null || Date.now() > deadline)
        throw new Error(`engine did not start: ${output.slice(-1500)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const engine = {
      base: url,
      port,
      home,
      pid: child.pid,
      bootstrap: /hxt_[0-9a-f]{48}/.exec(output)?.[0] ?? "",
      output: () => output,
      stop: () =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", resolve);
          child.kill();
          // A graceful shutdown that is still tearing things down (ssh workers, containers) is not left
          // writing into a directory the test is about to delete.
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
          setTimeout(resolve, 8000).unref();
        }),
    };
    engines.push(engine);
    return engine;
  }

  // `x-forwarded-for` stops the engine from mistaking the test for the local machine.
  async function call(engine, token, method, path, body) {
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`${engine.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, data, text };
  }

  async function until(fn, ms = 20000, what = "condition") {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function cleanup() {
    for (const e of engines) await e.stop();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  return { scratch, startEngine, call, until, cleanup };
}
