// hosterax/engine/src/docker-api.mjs
// Native Docker Engine REST API Client & Full Engine Controller for HosteraX
// Connects over Named Pipe (\\.\pipe\docker_engine) on Windows and Unix Socket (/var/run/docker.sock) on Linux/macOS.
// Supports Containers, Images, Volumes, Networks, Exec, Live Updates, and Event Streaming with zero CLI overhead.

import http from "node:http";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

/** Where unix-socket Docker daemons live on the setups people actually use. */
function candidateSockets({ env, home, uid }) {
  const run = env.XDG_RUNTIME_DIR || (uid != null ? `/run/user/${uid}` : "");
  return [
    "/var/run/docker.sock", // Docker Engine, and Docker Desktop's compatibility link
    `${home}/.docker/run/docker.sock`, // Docker Desktop (macOS)
    `${home}/.colima/default/docker.sock`, // Colima
    `${home}/.colima/docker.sock`,
    `${home}/.rd/docker.sock`, // Rancher Desktop
    `${home}/.orbstack/run/docker.sock`, // OrbStack
    run && `${run}/docker.sock`, // rootless Docker
    run && `${run}/podman/podman.sock`, // rootless Podman (Docker-compatible API)
    "/run/podman/podman.sock",
  ].filter(Boolean);
}

function parseHost(host) {
  if (host.startsWith("unix://")) return { socketPath: host.slice("unix://".length) };
  if (host.startsWith("npipe://")) return { socketPath: host.slice("npipe://".length) };
  if (host.startsWith("tcp://") || host.startsWith("http://")) {
    const u = new URL(host.replace("tcp://", "http://"));
    return { host: u.hostname, port: Number(u.port || 2375) };
  }
  return null; // ssh:// and anything else cannot be spoken to directly
}

/**
 * Work out which Docker daemon the Docker CLI is using, so the native client talks to the same one.
 * Order: DOCKER_HOST, the CLI's current context (Colima, Rancher Desktop, OrbStack, Docker Desktop and
 * remote contexts are selected that way), then the usual socket locations that exist, then the default.
 * `run` and `exists` are injectable for tests.
 */
export function detectDockerHost({
  env = process.env,
  platform = os.platform(),
  home = os.homedir(),
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  exists = (p) => fs.existsSync(p),
  run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", timeout: 1500, windowsHide: true }),
} = {}) {
  if (env.DOCKER_HOST) {
    const parsed = parseHost(env.DOCKER_HOST);
    if (parsed) return { ...parsed, source: "DOCKER_HOST", description: env.DOCKER_HOST };
  }
  if (platform === "win32")
    return {
      socketPath: "\\\\.\\pipe\\docker_engine",
      source: "default",
      description: "npipe:////./pipe/docker_engine",
    };

  try {
    const r = run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
    const host = String(r.stdout || "").trim();
    const parsed = host && r.status === 0 ? parseHost(host) : null;
    if (parsed && (!parsed.socketPath || exists(parsed.socketPath)))
      return { ...parsed, source: "docker context", description: host };
  } catch {}

  for (const socketPath of candidateSockets({ env, home, uid })) {
    if (exists(socketPath))
      return { socketPath, source: "known socket", description: `unix://${socketPath}` };
  }
  return {
    socketPath: "/var/run/docker.sock",
    source: "default",
    description: "unix:///var/run/docker.sock",
  };
}

export class DockerApiClient {
  constructor({ socketPath, host, port } = {}) {
    this.isWindows = os.platform() === "win32";

    if (socketPath) {
      this.socketPath = socketPath;
      this.host = null;
      this.port = null;
      this.source = "explicit";
    } else if (host) {
      this.socketPath = null;
      this.host = host;
      this.port = port || 2375;
      this.source = "explicit";
    } else {
      const d = detectDockerHost();
      this.socketPath = d.socketPath || null;
      this.host = d.host || null;
      this.port = d.port || null;
      this.source = d.source;
      this.description = d.description;
    }
    this.description ||=
      this.socketPath != null ? `unix://${this.socketPath}` : `tcp://${this.host}:${this.port}`;

    this.apiVersion = "v1.45";
  }

  /**
   * Low-level HTTP request dispatcher over Unix Socket, Windows Named Pipe, or TCP
   */
  request(method, endpoint, { body = null, headers = {}, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const pathWithVersion = endpoint.startsWith("/v1.")
        ? endpoint
        : `/${this.apiVersion}${endpoint}`;

      const options = {
        method,
        path: pathWithVersion,
        headers: {
          "User-Agent": "HosteraX-Native-Engine/1.1.0",
          ...headers,
        },
        timeout,
      };

      if (this.socketPath) {
        options.socketPath = this.socketPath;
      } else {
        options.host = this.host || "127.0.0.1";
        options.port = this.port || 2375;
      }

      let payload = null;
      if (body) {
        if (typeof body === "object") {
          payload = JSON.stringify(body);
          options.headers["Content-Type"] = "application/json";
          options.headers["Content-Length"] = Buffer.byteLength(payload);
        } else {
          payload = String(body);
          options.headers["Content-Length"] = Buffer.byteLength(payload);
        }
      }

      const req = http.request(options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const errMessage = parsed?.message || parsed || `HTTP ${res.statusCode}`;
            const err = new Error(
              `Docker API Error [${res.statusCode} ${method} ${endpoint}]: ${errMessage}`,
            );
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
          }
        });
      });

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Docker API Timeout after ${timeout}ms [${method} ${endpoint}]`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 1. CONTAINERS SUBSYSTEM
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * List containers with optional filters
   */
  async listContainers({ all = true, filters = null } = {}) {
    let url = `/containers/json?all=${all ? "1" : "0"}`;
    if (filters) {
      url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
    }
    return this.request("GET", url);
  }

  /**
   * Resolves a container name or ID (e.g. stirling-pdf -> hx_stirling_pdf).
   * Only exact name matches are accepted — a substring match could hit an unrelated container.
   */
  async resolveContainerId(nameOrId) {
    if (!nameOrId) return nameOrId;
    const clean = nameOrId.trim();

    // 1. Direct inspect check
    try {
      const res = await this.request("GET", `/containers/${encodeURIComponent(clean)}/json`);
      if (res && res.Id) return res.Id;
    } catch {}

    // 2. Candidate list
    const candidates = [
      clean,
      `hx_${clean}`,
      `hx_${clean.replace(/[^a-z0-9_]/g, "_")}`,
      clean.replace(/[^a-z0-9_]/g, "_"),
      clean.replace(/_/g, "-"),
      `hx_${clean.replace(/_/g, "-")}`,
    ];

    for (const c of candidates) {
      try {
        const res = await this.request("GET", `/containers/${encodeURIComponent(c)}/json`);
        if (res && res.Id) return res.Id;
      } catch {}
    }

    // 3. Fallback to container list scan
    try {
      const list = await this.listContainers({ all: true });
      const found = list.find((c) => {
        const names = c.Names || [];
        return names.some((n) => {
          const stripped = n.replace(/^\//, "");
          return (
            stripped === clean ||
            stripped === `hx_${clean}` ||
            stripped === `hx_${clean.replace(/[^a-z0-9_]/g, "_")}`
          );
        });
      });
      if (found) return found.Id;
    } catch {}

    return clean;
  }

  /**
   * Inspect a container by name or ID (returns deep metadata, state, ports, mounts)
   */
  async inspectContainer(nameOrId) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("GET", `/containers/${encodeURIComponent(target)}/json`);
  }

  /**
   * Create a new container
   */
  async createContainer(name, config) {
    const url = name ? `/containers/create?name=${encodeURIComponent(name)}` : `/containers/create`;
    return this.request("POST", url, { body: config });
  }

  /**
   * Start a container
   */
  async startContainer(nameOrId) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("POST", `/containers/${encodeURIComponent(target)}/start`);
  }

  /**
   * Stop a container with timeout
   */
  async stopContainer(nameOrId, timeout = 10) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("POST", `/containers/${encodeURIComponent(target)}/stop?t=${timeout}`);
  }

  /**
   * Restart a container
   */
  async restartContainer(nameOrId, timeout = 10) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("POST", `/containers/${encodeURIComponent(target)}/restart?t=${timeout}`);
  }

  /**
   * Kill a container with signal
   */
  async killContainer(nameOrId, signal = "SIGKILL") {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("POST", `/containers/${encodeURIComponent(target)}/kill?signal=${signal}`);
  }

  /**
   * Remove a container
   */
  async removeContainer(nameOrId, { force = true, removeVolumes = true } = {}) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request(
      "DELETE",
      `/containers/${encodeURIComponent(target)}?force=${force ? "1" : "0"}&v=${removeVolumes ? "1" : "0"}`,
    );
  }

  /**
   * Dynamically update container resource limits ON THE FLY with ZERO RESTARTS
   * @param {string} nameOrId
   * @param {object} resources e.g. { Memory: 1073741824, NanoCPUs: 2000000000, MemorySwap: -1 }
   */
  async updateContainer(nameOrId, resources = {}) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("POST", `/containers/${encodeURIComponent(target)}/update`, {
      body: resources,
    });
  }

  /**
   * Get single-shot resource stats for a container (CPU, Memory, Network, Block I/O)
   */
  async getContainerStats(nameOrId) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("GET", `/containers/${encodeURIComponent(target)}/stats?stream=false`);
  }

  /**
   * Fetch stdout/stderr logs from a container
   */
  async getContainerLogs(nameOrId, { tail = 100, timestamps = false } = {}) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request(
      "GET",
      `/containers/${encodeURIComponent(target)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=${timestamps ? "1" : "0"}`,
    );
  }

  /**
   * Inspect processes running inside a container (top)
   */
  async getContainerTop(nameOrId, psArgs = "-ef") {
    const target = await this.resolveContainerId(nameOrId);
    return this.request(
      "GET",
      `/containers/${encodeURIComponent(target)}/top?ps_args=${encodeURIComponent(psArgs)}`,
    );
  }

  /**
   * Inspect filesystem changes inside a container
   */
  async getContainerChanges(nameOrId) {
    const target = await this.resolveContainerId(nameOrId);
    return this.request("GET", `/containers/${encodeURIComponent(target)}/changes`);
  }

  /**
   * Run a one-off command inside a container (Docker Exec API)
   * @param {string} nameOrId
   * @param {string|string[]} cmd e.g. ["ls", "-la"] or "node --version"
   */
  async execCommand(nameOrId, cmd, { workingDir = null, env = [] } = {}) {
    const target = await this.resolveContainerId(nameOrId);
    const cmdArray = Array.isArray(cmd) ? cmd : ["sh", "-c", cmd];

    // 1. Create Exec Instance
    const execInstance = await this.request(
      "POST",
      `/containers/${encodeURIComponent(target)}/exec`,
      {
        body: {
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          Cmd: cmdArray,
          WorkingDir: workingDir,
          Env: env,
        },
      },
    );

    const execId = execInstance.Id;

    // 2. Start Exec Instance and collect output
    const output = await this.request("POST", `/exec/${execId}/start`, {
      body: { Detach: false, Tty: false },
    });

    // 3. Inspect Exec Instance for Exit Code
    const execDetails = await this.request("GET", `/exec/${execId}/json`);

    return {
      execId,
      exitCode: execDetails.ExitCode,
      running: execDetails.Running,
      output:
        typeof output === "string"
          ? output.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "").trim()
          : output,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 2. IMAGES SUBSYSTEM
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * List local Docker images
   */
  async listImages() {
    return this.request("GET", `/images/json`);
  }

  /**
   * Inspect a Docker image
   */
  async inspectImage(nameOrId) {
    return this.request("GET", `/images/${encodeURIComponent(nameOrId)}/json`);
  }

  /**
   * Pull an image from Docker Hub, GHCR, Quay, or GCR
   */
  async pullImage(imageTag) {
    return this.request("POST", `/images/create?fromImage=${encodeURIComponent(imageTag)}`, {
      timeout: 120000,
    });
  }

  /**
   * Remove an image
   */
  async removeImage(nameOrId, force = false) {
    return this.request(
      "DELETE",
      `/images/${encodeURIComponent(nameOrId)}?force=${force ? "1" : "0"}`,
    );
  }

  /**
   * Prune unused and dangling images
   */
  async pruneImages() {
    return this.request("POST", `/images/prune`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. VOLUMES SUBSYSTEM
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * List Docker persistent volumes
   */
  async listVolumes() {
    return this.request("GET", `/volumes`);
  }

  /**
   * Inspect a Docker volume
   */
  async inspectVolume(name) {
    return this.request("GET", `/volumes/${encodeURIComponent(name)}`);
  }

  /**
   * Create a named persistent volume
   */
  async createVolume(name, { driver = "local", labels = {} } = {}) {
    return this.request("POST", `/volumes/create`, {
      body: { Name: name, Driver: driver, Labels: labels },
    });
  }

  /**
   * Remove a volume
   */
  async removeVolume(name, force = false) {
    return this.request(
      "DELETE",
      `/volumes/${encodeURIComponent(name)}?force=${force ? "1" : "0"}`,
    );
  }

  /**
   * Prune unused volumes
   */
  async pruneVolumes() {
    return this.request("POST", `/volumes/prune`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 4. NETWORKS SUBSYSTEM
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * List Docker virtual networks
   */
  async listNetworks() {
    return this.request("GET", `/networks`);
  }

  /**
   * Inspect a network
   */
  async inspectNetwork(nameOrId) {
    return this.request("GET", `/networks/${encodeURIComponent(nameOrId)}`);
  }

  /**
   * Create an isolated bridge network
   */
  async createNetwork(name, { driver = "bridge", internal = false, labels = {} } = {}) {
    return this.request("POST", `/networks/create`, {
      body: {
        Name: name,
        Driver: driver,
        Internal: internal,
        Labels: labels,
      },
    });
  }

  /**
   * Remove a network
   */
  async removeNetwork(nameOrId) {
    return this.request("DELETE", `/networks/${encodeURIComponent(nameOrId)}`);
  }

  /**
   * Connect a container to a network
   */
  async connectNetwork(networkId, containerId) {
    return this.request("POST", `/networks/${encodeURIComponent(networkId)}/connect`, {
      body: { Container: containerId },
    });
  }

  /**
   * Disconnect a container from a network
   */
  async disconnectNetwork(networkId, containerId, force = false) {
    return this.request("POST", `/networks/${encodeURIComponent(networkId)}/disconnect`, {
      body: { Container: containerId, Force: force },
    });
  }

  /**
   * Prune unused networks
   */
  async pruneNetworks() {
    return this.request("POST", `/networks/prune`);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 5. SYSTEM & DISK TELEMETRY SUBSYSTEM
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Get Docker system information (OS, architecture, CPUs, total memory, runtime)
   */
  async getSystemInfo() {
    return this.request("GET", `/info`);
  }

  /**
   * Get Docker engine version details
   */
  async getVersion() {
    return this.request("GET", `/version`);
  }

  /**
   * Get Docker disk usage data (containers, images, volumes, build cache size)
   */
  async getDiskUsage() {
    return this.request("GET", `/system/df`);
  }

  /**
   * Prune all unused Docker data (containers, images, networks, volumes, build cache)
   */
  async pruneAll() {
    const results = {};
    try {
      results.containers = await this.request("POST", "/containers/prune");
    } catch {}
    try {
      results.images = await this.request("POST", "/images/prune");
    } catch {}
    try {
      results.networks = await this.request("POST", "/networks/prune");
    } catch {}
    try {
      results.volumes = await this.request("POST", "/volumes/prune");
    } catch {}
    try {
      results.buildCache = await this.request("POST", "/build/prune");
    } catch {}
    return results;
  }
}
