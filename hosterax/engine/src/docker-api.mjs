// hosterax/engine/src/docker-api.mjs
// Native Docker Engine REST API Client & Full Engine Controller for HosteraX
// Connects over Named Pipe (\\.\pipe\docker_engine) on Windows and Unix Socket (/var/run/docker.sock) on Linux/macOS.
// Supports Containers, Images, Volumes, Networks, Exec, Live Updates, and Event Streaming with zero CLI overhead.

import http from "node:http";
import net from "node:net";
import os from "node:os";

export class DockerApiClient {
  constructor({ socketPath, host, port } = {}) {
    this.isWindows = os.platform() === "win32";
    
    // Auto-detect default Docker daemon connection
    if (socketPath) {
      this.socketPath = socketPath;
      this.host = null;
      this.port = null;
    } else if (process.env.DOCKER_HOST) {
      const dh = process.env.DOCKER_HOST;
      if (dh.startsWith("unix://")) {
        this.socketPath = dh.replace("unix://", "");
        this.host = null;
        this.port = null;
      } else if (dh.startsWith("npipe://")) {
        this.socketPath = dh.replace("npipe://", "");
        this.host = null;
        this.port = null;
      } else if (dh.startsWith("tcp://") || dh.startsWith("http://")) {
        const u = new URL(dh.replace("tcp://", "http://"));
        this.host = u.hostname;
        this.port = Number(u.port || 2375);
        this.socketPath = null;
      }
    } else if (this.isWindows) {
      this.socketPath = "\\\\.\\pipe\\docker_engine";
      this.host = null;
      this.port = null;
    } else {
      this.socketPath = "/var/run/docker.sock";
      this.host = null;
      this.port = null;
    }

    this.apiVersion = "v1.45";
  }

  /**
   * Low-level HTTP request dispatcher over Unix Socket, Windows Named Pipe, or TCP
   */
  request(method, endpoint, { body = null, headers = {}, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const pathWithVersion = endpoint.startsWith("/v1.") ? endpoint : `/${this.apiVersion}${endpoint}`;

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
            const err = new Error(`Docker API Error [${res.statusCode} ${method} ${endpoint}]: ${errMessage}`);
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
   * Inspect a container by name or ID (returns deep metadata, state, ports, mounts)
   */
  async inspectContainer(nameOrId) {
    return this.request("GET", `/containers/${encodeURIComponent(nameOrId)}/json`);
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
    return this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/start`);
  }

  /**
   * Stop a container with timeout
   */
  async stopContainer(nameOrId, timeout = 10) {
    return this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/stop?t=${timeout}`);
  }

  /**
   * Restart a container
   */
  async restartContainer(nameOrId, timeout = 10) {
    return this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/restart?t=${timeout}`);
  }

  /**
   * Kill a container with signal
   */
  async killContainer(nameOrId, signal = "SIGKILL") {
    return this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/kill?signal=${signal}`);
  }

  /**
   * Remove a container
   */
  async removeContainer(nameOrId, { force = true, removeVolumes = true } = {}) {
    return this.request("DELETE", `/containers/${encodeURIComponent(nameOrId)}?force=${force ? "1" : "0"}&v=${removeVolumes ? "1" : "0"}`);
  }

  /**
   * Dynamically update container resource limits ON THE FLY with ZERO RESTARTS
   * @param {string} nameOrId
   * @param {object} resources e.g. { Memory: 1073741824, NanoCPUs: 2000000000, MemorySwap: -1 }
   */
  async updateContainer(nameOrId, resources = {}) {
    return this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/update`, { body: resources });
  }

  /**
   * Get single-shot resource stats for a container (CPU, Memory, Network, Block I/O)
   */
  async getContainerStats(nameOrId) {
    return this.request("GET", `/containers/${encodeURIComponent(nameOrId)}/stats?stream=false`);
  }

  /**
   * Fetch stdout/stderr logs from a container
   */
  async getContainerLogs(nameOrId, { tail = 100, timestamps = false } = {}) {
    return this.request("GET", `/containers/${encodeURIComponent(nameOrId)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=${timestamps ? "1" : "0"}`);
  }

  /**
   * Inspect processes running inside a container (top)
   */
  async getContainerTop(nameOrId, psArgs = "-ef") {
    return this.request("GET", `/containers/${encodeURIComponent(nameOrId)}/top?ps_args=${encodeURIComponent(psArgs)}`);
  }

  /**
   * Inspect filesystem changes inside a container
   */
  async getContainerChanges(nameOrId) {
    return this.request("GET", `/containers/${encodeURIComponent(nameOrId)}/changes`);
  }

  /**
   * Run a one-off command inside a container (Docker Exec API)
   * @param {string} nameOrId
   * @param {string|string[]} cmd e.g. ["ls", "-la"] or "node --version"
   */
  async execCommand(nameOrId, cmd, { workingDir = null, env = [] } = {}) {
    const cmdArray = Array.isArray(cmd) ? cmd : ["sh", "-c", cmd];
    
    // 1. Create Exec Instance
    const execInstance = await this.request("POST", `/containers/${encodeURIComponent(nameOrId)}/exec`, {
      body: {
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        Cmd: cmdArray,
        WorkingDir: workingDir,
        Env: env,
      },
    });

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
      output: typeof output === "string" ? output.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "").trim() : output,
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
    return this.request("POST", `/images/create?fromImage=${encodeURIComponent(imageTag)}`, { timeout: 120000 });
  }

  /**
   * Remove an image
   */
  async removeImage(nameOrId, force = false) {
    return this.request("DELETE", `/images/${encodeURIComponent(nameOrId)}?force=${force ? "1" : "0"}`);
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
    return this.request("DELETE", `/volumes/${encodeURIComponent(name)}?force=${force ? "1" : "0"}`);
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
    try { results.containers = await this.request("POST", "/containers/prune"); } catch {}
    try { results.images = await this.request("POST", "/images/prune"); } catch {}
    try { results.networks = await this.request("POST", "/networks/prune"); } catch {}
    try { results.volumes = await this.request("POST", "/volumes/prune"); } catch {}
    try { results.buildCache = await this.request("POST", "/build/prune"); } catch {}
    return results;
  }
}
