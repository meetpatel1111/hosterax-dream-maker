import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execSync } from "node:child_process";
import { spawn, execFile } from "./docker-scope.mjs";
import { runOnServer, currentServerId } from "./docker-scope.mjs";
import { spawnSync } from "./safe-exec.mjs";
import fs from "node:fs";
import path from "node:path";

export class SelfHealEngine {
  /**
   * `servers` (optional) connects projects placed on remote servers:
   *   statusOf(serverId) -> { name, ready, error }, dockerApiFor(serverId) -> Docker HTTP client,
   *   readyRemoteIds() -> ids of connected remote servers.
   */
  constructor({ db, publish, restartService, rollbackService, HOME, dockerApi, servers }) {
    this.servers = servers || null;
    this.db = db;
    // Operations that name a project act on the server it lives on.
    for (const op of ["runFullPipelineAudit", "simulateChaos", "autoRemediateCrashLoop"]) {
      const inner = this[op].bind(this);
      this[op] = (name, ...rest) => {
        const row = this.db.prepare("SELECT server_id FROM projects WHERE name=?").get(name);
        return runOnServer(row?.server_id, () => inner(name, ...rest));
      };
    }
    this.publish = publish;
    this.restartService = restartService;
    this.rollbackService = rollbackService;
    this.HOME = HOME;
    this.dockerApi = dockerApi;

    // Track crash history: projectName -> [{ ts: timestamp }]
    this.crashHistory = new Map();
    // Track backoff state: projectName -> { backoffMs, nextRetryTs, inBackOff }
    this.backoffState = new Map();
    // Track circuit breaker: projectName -> { state: 'CLOSED'|'OPEN'|'HALF-OPEN', failures, lastFailureTs, openUntilTs, canarySuccesses }
    this.circuitMap = new Map();
    // Track health status: projectName -> { status, lastProbeTs, message, latencyMs, memoryPercent, tiers, circuitState }
    this.healthMap = new Map();
    // Track consecutive failures per project
    this.consecutiveFailures = new Map();
    // Track last auto-restart ts per project to prevent restart storms
    this.lastRestartTs = new Map();
    this.startTime = Date.now();
    // In-memory event log for UI timeline
    this.events = [];
    // Docker daemon socket health
    this.daemonHealthy = true; // optimistic until the first probe (runs immediately on start())
    this.lastDaemonCheckTs = 0;

    // Ensure database tables for persistent self-healing events & probe configurations
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS self_heal_events (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          event_type TEXT NOT NULL,
          details TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_self_heal_proj ON self_heal_events(project);

        CREATE TABLE IF NOT EXISTS health_configs (
          project TEXT PRIMARY KEY,
          probe_path TEXT NOT NULL DEFAULT '/',
          expected_status INTEGER NOT NULL DEFAULT 200,
          startup_delay_seconds INTEGER NOT NULL DEFAULT 5,
          timeout_seconds INTEGER NOT NULL DEFAULT 3,
          blue_green INTEGER NOT NULL DEFAULT 1,
          max_retries INTEGER NOT NULL DEFAULT 4,
          updated_at INTEGER NOT NULL
        );
      `);
    } catch (err) {
      console.warn("[self-heal] DB initialization warning:", err.message);
    }

    this.timer = null;
    this.pruneTimer = null;
    this.running = false;
  }

  /**
   * Effective probe policy for a project: the saved `health_configs` row wins, otherwise the
   * project's own health path with conservative defaults.
   */
  getHealthConfig(project) {
    const defaults = {
      probePath: "/",
      expectedStatus: 200,
      startupDelaySeconds: 60,
      timeoutSeconds: 3,
      blueGreen: true,
      maxRetries: 4,
    };
    try {
      const row = this.db.prepare("SELECT * FROM health_configs WHERE project=?").get(project);
      if (row) {
        return {
          probePath: row.probe_path,
          expectedStatus: row.expected_status,
          startupDelaySeconds: row.startup_delay_seconds,
          timeoutSeconds: row.timeout_seconds,
          blueGreen: Boolean(row.blue_green),
          maxRetries: row.max_retries,
        };
      }
      const proj = this.db.prepare("SELECT * FROM projects WHERE name=?").get(project);
      return { ...defaults, probePath: proj?.health_path || proj?.health_check_path || "/" };
    } catch {
      return defaults;
    }
  }

  setHealthConfig(project, config) {
    const probePath = config.probePath || "/";
    const expectedStatus = Number(config.expectedStatus || 200);
    const startupDelaySeconds = Number(config.startupDelaySeconds || 5);
    const timeoutSeconds = Number(config.timeoutSeconds || 3);
    const blueGreen = config.blueGreen ? 1 : 0;
    const maxRetries = Number(config.maxRetries || 4);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO health_configs 
        (project, probe_path, expected_status, startup_delay_seconds, timeout_seconds, blue_green, max_retries, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project,
        probePath,
        expectedStatus,
        startupDelaySeconds,
        timeoutSeconds,
        blueGreen,
        maxRetries,
        Date.now(),
      );

    this.logEvent(
      project,
      "config_updated",
      `Health probe policy updated: Path ${probePath}, Expected HTTP ${expectedStatus}, Startup Delay ${startupDelaySeconds}s`,
      "info",
    );
    return this.getHealthConfig(project);
  }

  logEvent(project, eventType, details, status = "info") {
    const event = {
      id: `sh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      project,
      eventType,
      details,
      status,
      timestamp: Date.now(),
    };
    this.events.unshift(event);
    if (this.events.length > 200) this.events.pop();
    try {
      this.onEvent?.(event);
    } catch {}

    try {
      this.db
        .prepare(
          "INSERT INTO self_heal_events (id, project, event_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(event.id, project, eventType, details, status, event.timestamp);
    } catch {}

    console.log(`[self-heal][${project}] ${eventType.toUpperCase()}: ${details}`);
    if (this.publish) {
      this.publish(project, {
        ts: Date.now(),
        stream: "system",
        text: `[self-heal] ${eventType.toUpperCase()}: ${details}`,
      });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.reconciling = false;
    console.log(
      "[self-heal] Autonomous Self-Healing Engine started (AutoHeal v6 Mesh - Zero Spawn Mode)",
    );

    // Run watchdog probe every 15 seconds (with overlap guard to minimize background CPU/RAM)
    this.timer = setInterval(() => {
      if (!this.reconciling) this.runReconciliationLoop();
    }, 15000);

    // Run AutoPrune disk cleaner every 30 minutes
    this.pruneTimer = setInterval(() => this.runAutoPrune(), 30 * 60 * 1000);

    // Initial check (probe Docker right away so the dashboard never shows a stale "healthy")
    this.probeDockerDaemon().catch(() => {});
    setTimeout(() => this.runReconciliationLoop(), 1500);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  /**
   * Probes the Docker daemon: native socket API first, `docker version` CLI as fallback so a
   * socket-path mismatch can never wrongly mark a working Docker as offline.
   */
  async probeDockerDaemon() {
    let version = null;
    if (this.dockerApi) {
      try {
        const ver = await this.dockerApi.getVersion();
        if (ver && ver.Version) version = ver.Version;
      } catch {}
    }
    if (!version) {
      version = await new Promise((resolve) => {
        execFile(
          "docker",
          ["version", "--format", "{{.Server.Version}}"],
          { encoding: "utf8", timeout: 2500 },
          (err, stdout) => resolve(!err && stdout && stdout.trim() ? stdout.trim() : null),
        );
      });
    }
    const isOk = Boolean(version);
    if (isOk !== this.daemonHealthy) {
      if (!isOk) {
        this.logEvent(
          "system",
          "daemon_unresponsive",
          `Docker daemon is unresponsive or offline (looking at ${this.dockerApi?.description ?? "the default socket"}${this.dockerApi?.source ? `, found via ${this.dockerApi.source}` : ""}). Suspending container probes.`,
          "error",
        );
      } else {
        this.logEvent(
          "system",
          "daemon_recovered",
          `Docker daemon connected (Engine v${version}). Resuming probes.`,
          "info",
        );
      }
    }
    this.daemonHealthy = isOk;
    this.daemonVersion = isOk ? version : null;
    this.lastDaemonCheckTs = Date.now();
    return this.daemonHealthy;
  }

  async runReconciliationLoop() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      // 1. Verify Docker Daemon Socket Health First
      const daemonOk = await this.probeDockerDaemon();

      // Stopped, sleeping (scale-to-zero), disabled and archived projects must stay down.
      const projects = this.db
        .prepare(
          "SELECT * FROM projects WHERE COALESCE(enabled,1)=1 AND COALESCE(status,'') NOT IN ('archived','stopped','sleeping')",
        )
        .all();
      if (!projects || projects.length === 0) return;

      // Projects on this machine need this machine's Docker; projects on another server do not.
      for (const proj of projects) {
        if (this.isRemote(proj)) await this.probeRemoteProject(proj);
        else if (daemonOk) await this.probeAndHealProject(proj);
      }
    } catch (err) {
      console.error("[self-heal] Error in reconciliation loop:", err.message);
    } finally {
      this.reconciling = false;
    }
  }

  isRemote(proj) {
    return Boolean(proj.server_id && proj.server_id !== "local");
  }

  /** Check (and if needed heal) a project wherever it lives. */
  probeProject(proj) {
    return this.isRemote(proj) ? this.probeRemoteProject(proj) : this.probeAndHealProject(proj);
  }

  /** The Docker HTTP client for whichever server the current work is scoped to. */
  _api() {
    const sid = currentServerId();
    return sid && this.servers?.dockerApiFor ? this.servers.dockerApiFor(sid) : this.dockerApi;
  }

  /**
   * A project on another server is checked there, but only while that server is reachable: if it is not,
   * nothing is restarted or rolled back (the app may be running fine behind a broken network path), and the
   * project is shown as unreachable until the server answers again.
   */
  async probeRemoteProject(proj) {
    const name = proj.name;
    const srv = this.servers?.statusOf?.(proj.server_id);
    if (!srv?.ready) {
      const prev = this.healthMap.get(name);
      const message = `Server ${srv?.name ?? proj.server_id} is unreachable${srv?.error ? `: ${srv.error}` : ""}. Nothing is restarted until it is back.`;
      if (prev?.status !== "unreachable") {
        this.logEvent(name, "server_unreachable", message, "error");
      }
      this.healthMap.set(name, {
        status: "unreachable",
        lastProbeTs: Date.now(),
        message,
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: this.getCircuit(name).state,
        tiers: { startup: "passed", readiness: "unknown", liveness: "unknown" },
      });
      return;
    }
    await runOnServer(proj.server_id, () => this.probeAndHealProject(proj));
  }

  getCircuit(name) {
    if (!this.circuitMap.has(name)) {
      this.circuitMap.set(name, {
        state: "CLOSED",
        failures: 0,
        lastFailureTs: 0,
        openUntilTs: 0,
        canarySuccesses: 0,
      });
    }
    return this.circuitMap.get(name);
  }

  recordCircuitFailure(name) {
    const c = this.getCircuit(name);
    c.failures += 1;
    c.lastFailureTs = Date.now();

    if (c.failures >= 3 && c.state !== "OPEN") {
      c.state = "OPEN";
      c.openUntilTs = Date.now() + 30000; // 30s cooling isolation
      this.logEvent(
        name,
        "circuit_tripped_open",
        `Circuit Breaker TRIPPED to OPEN state due to rapid flapping (${c.failures} failures). Service isolated for 30s.`,
        "error",
      );
    }
  }

  recordCircuitSuccess(name) {
    const c = this.getCircuit(name);
    if (c.state === "HALF-OPEN") {
      c.canarySuccesses += 1;
      if (c.canarySuccesses >= 2) {
        c.state = "CLOSED";
        c.failures = 0;
        c.canarySuccesses = 0;
        this.logEvent(
          name,
          "circuit_closed_recovered",
          "Canary probes passed 200 OK. Circuit Breaker restored to CLOSED (normal traffic).",
          "success",
        );
      }
    } else if (c.state === "CLOSED" && c.failures > 0) {
      c.failures = 0;
    }
  }

  untrack(name) {
    this.healthMap.delete(name);
    this.circuitMap.delete(name);
    this.backoffState.delete(name);
    this.consecutiveFailures.delete(name);
  }

  resetCircuit(name) {
    this.circuitMap.set(name, {
      state: "CLOSED",
      failures: 0,
      lastFailureTs: 0,
      openUntilTs: 0,
      canarySuccesses: 0,
    });
    this.backoffState.delete(name);
    this.crashHistory.delete(name);
    this.logEvent(
      name,
      "circuit_manually_reset",
      "Circuit Breaker manually reset to CLOSED. Triggering immediate probe...",
      "info",
    );
    const proj = this.db.prepare("SELECT * FROM projects WHERE name=?").get(name);
    if (proj) {
      this.probeProject(proj);
    }
    return { ok: true, message: `Circuit Breaker for "${name}" reset to CLOSED.` };
  }

  async probeAndHealProject(proj) {
    const name = proj.name;
    if (proj.enabled === 0 || ["archived", "stopped", "sleeping"].includes(proj.status)) {
      this.healthMap.delete(name);
      return;
    }
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const port = proj.port || 3000;
    const target = proj.target || "docker";
    const cfg = this.getHealthConfig(name);
    const circuit = this.getCircuit(name);

    // 0. Skip watchdog probing if project is actively deploying or building
    try {
      const latestDeploy = this.db
        .prepare("SELECT * FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
        .get(name);

      if (!latestDeploy) {
        this.healthMap.set(name, {
          status: "pending",
          lastProbeTs: Date.now(),
          message: "No deployments yet — waiting for first deployment...",
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: circuit.state,
          tiers: { startup: "pending", readiness: "pending", liveness: "pending" },
        });
        return;
      }

      const isDeploying =
        latestDeploy &&
        latestDeploy.phase !== "ready" &&
        latestDeploy.phase !== "failed" &&
        latestDeploy.phase !== "cancelled";

      if (isDeploying) {
        this.healthMap.set(name, {
          status: "recovering",
          lastProbeTs: Date.now(),
          message: `Deployment in progress (${latestDeploy.phase})...`,
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: circuit.state,
          tiers: { startup: "warming_up", readiness: "failing", liveness: "recovering" },
        });
        return;
      }

      // 0.05 Skip probing if deployment failed
      if (latestDeploy && latestDeploy.phase === "failed") {
        this.healthMap.set(name, {
          status: "degraded",
          lastProbeTs: Date.now(),
          message: `Deployment failed (${latestDeploy.exit_code ? `exit code ${latestDeploy.exit_code}` : "build or image pull failure"}). Service inactive.`,
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: circuit.state,
          tiers: { startup: "failed", readiness: "failing", liveness: "degraded" },
        });
        return;
      }

      // 0.1 Check Startup Grace Period (engine boot, new deployment, or recent restart)
      const elapsedSinceEngineBoot = Date.now() - (this.startTime || 0);
      const elapsedSinceRestart = Date.now() - (this.lastRestartTs.get(name) || 0);
      const elapsedSinceDeploy = latestDeploy?.finished_at
        ? Date.now() - latestDeploy.finished_at
        : Infinity;

      const isWarmingUp =
        elapsedSinceEngineBoot < 120000 ||
        elapsedSinceRestart < 120000 ||
        elapsedSinceDeploy < Math.max(120000, (cfg.startupDelaySeconds || 120) * 1000);

      if (isWarmingUp) {
        const httpOk = await this.probeHttpEndpoint(
          "127.0.0.1",
          port,
          cfg.probePath,
          cfg.expectedStatus,
          2000,
        );
        if (httpOk) {
          this.recordCircuitSuccess(name);
          this.consecutiveFailures.delete(name);
          this.healthMap.set(name, {
            status: "healthy",
            lastProbeTs: Date.now(),
            message: `Responding on port :${port}`,
            latencyMs: 10,
            memoryPercent: 0,
            circuitState: "CLOSED",
            tiers: { startup: "passed", readiness: "ready", liveness: "healthy" },
          });
          return;
        }
        this.healthMap.set(name, {
          status: "healthy",
          lastProbeTs: Date.now(),
          message: `Startup warmup grace period active...`,
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: circuit.state,
          tiers: { startup: "warming_up", readiness: "ready", liveness: "healthy" },
        });
        return;
      }
    } catch {}

    // 0.2 Circuit Breaker Isolation Check
    if (circuit.state === "OPEN") {
      if (Date.now() < circuit.openUntilTs) {
        this.healthMap.set(name, {
          status: "degraded",
          lastProbeTs: Date.now(),
          message: `Circuit Breaker OPEN: Cooling isolation (${Math.ceil((circuit.openUntilTs - Date.now()) / 1000)}s left)`,
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: "OPEN",
          tiers: { startup: "passed", readiness: "failing", liveness: "degraded" },
        });
        return;
      } else {
        circuit.state = "HALF-OPEN";
        circuit.canarySuccesses = 0;
        this.logEvent(
          name,
          "circuit_half_open",
          "Cooling period elapsed. Transitioned to HALF-OPEN for canary probing.",
          "warning",
        );
      }
    }

    // 1. Check if in CrashLoopBackOff waiting period
    const bState = this.backoffState.get(name);
    if (bState && bState.inBackOff && Date.now() < bState.nextRetryTs) {
      this.healthMap.set(name, {
        status: "crashloop",
        lastProbeTs: Date.now(),
        message: `CrashLoopBackOff: Paused for ${Math.ceil((bState.nextRetryTs - Date.now()) / 1000)}s`,
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: circuit.state,
        tiers: { startup: "passed", readiness: "failing", liveness: "crashloop" },
      });
      return;
    }

    // 2. Perform Liveness Probe & Container Inspection
    let isAlive = false;
    let latencyMs = 0;
    let oomKilled = false;
    let exitCode = 0;
    let statusText = "unknown";
    let memoryPercent = 0;
    let out = "";
    const startT = Date.now();

    if (target === "docker") {
      const api = (() => {
        try {
          return this._api();
        } catch {
          return null; // the server just dropped; the CLI path below fails the same way and counts as not alive
        }
      })();
      try {
        if (api) {
          try {
            const inspectData = await api.inspectContainer(`hx_${cleanName}`);
            if (inspectData && inspectData.State) {
              statusText = inspectData.State.Status || "unknown";
              oomKilled = Boolean(inspectData.State.OOMKilled);
              exitCode = inspectData.State.ExitCode || 0;
              if (statusText === "running") {
                isAlive = true;
              }
            }
          } catch {
            statusText = "exited";
            isAlive = false;
          }
        } else {
          const inspectRes = await new Promise((resolve) => {
            const child = spawn(
              "docker",
              [
                "inspect",
                "--format",
                "{{.State.Status}}|{{.State.OOMKilled}}|{{.State.ExitCode}}",
                `hx_${cleanName}`,
              ],
              { encoding: "utf8" },
            );
            let out = "";
            child.stdout.on("data", (d) => (out += d.toString()));
            child.on("close", (code) => {
              resolve({ stdout: out, status: code });
            });
            child.on("error", () => resolve({ stdout: "", status: 1 }));
            setTimeout(() => {
              try {
                child.kill();
              } catch {}
              resolve({ stdout: out, status: 1 });
            }, 3000);
          });
          out = inspectRes.stdout?.trim() || "";
          const parts = out.split("|");
          statusText = parts[0] || "unknown";
          oomKilled = parts[1] === "true";
          exitCode = parseInt(parts[2] || "0", 10);

          if (statusText === "running") {
            isAlive = true;
          }
        }

        if (statusText === "dead" || statusText === "removing") {
          this.logEvent(
            name,
            "dead_container_evicted",
            `Container stuck in ${statusText} state. Forcing clean eviction and network cleanup...`,
            "warning",
          );
          try {
            if (api) {
              await api.removeContainer(`hx_${cleanName}`, { force: true });
            } else {
              spawnSync("docker", ["rm", "-f", `hx_${cleanName}`]);
            }
          } catch {}
          isAlive = false;
        }
      } catch {
        isAlive = false;
      }
    }

    // 3. Socket / HTTP Readiness & Liveness Probe
    let probePassed = false;
    if (cfg.probePath === "none" || target === "worker" || target === "cli") {
      probePassed = isAlive;
    } else if (isAlive || target !== "docker") {
      if (cfg.probePath && cfg.probePath !== "none") {
        const httpOk = await this.probeHttpEndpoint(
          "127.0.0.1",
          port,
          cfg.probePath,
          cfg.expectedStatus,
          cfg.timeoutSeconds * 1000,
        );
        latencyMs = Date.now() - startT;
        if (httpOk) {
          probePassed = true;
          isAlive = true;
        } else {
          const tcpOk = await this.probeTcpPort("127.0.0.1", port, cfg.timeoutSeconds * 1000);
          if (tcpOk) {
            probePassed = true;
            isAlive = true;
          } else {
            probePassed = false;
            isAlive = false;
          }
        }
      } else {
        const tcpOk = await this.probeTcpPort("127.0.0.1", port, cfg.timeoutSeconds * 1000);
        latencyMs = Date.now() - startT;
        probePassed = tcpOk;
        isAlive = tcpOk;
      }
    }

    // 4. Handle Healthy vs Unhealthy State
    if (isAlive && probePassed) {
      if (this.backoffState.has(name)) {
        this.backoffState.delete(name);
      }
      this.consecutiveFailures.delete(name);
      this.recordCircuitSuccess(name);

      this.healthMap.set(name, {
        status: "healthy",
        lastProbeTs: Date.now(),
        message: `Responding on port :${port} (${latencyMs}ms)`,
        latencyMs,
        memoryPercent,
        circuitState: circuit.state,
        tiers: { startup: "passed", readiness: "ready", liveness: "healthy" },
      });
    } else {
      // If the container process is still running inside Docker, give it grace to complete initialization
      if (isAlive) {
        const fails = (this.consecutiveFailures.get(name) || 0) + 1;
        this.consecutiveFailures.set(name, fails);

        if (fails < 12) {
          this.healthMap.set(name, {
            status: "warming_up",
            lastProbeTs: Date.now(),
            message: `Service warming up on port :${port} (probe check ${fails}/12)...`,
            latencyMs: 0,
            memoryPercent,
            circuitState: circuit.state,
            tiers: { startup: "warming_up", readiness: "failing", liveness: "healthy" },
          });
          return;
        }
      }

      this.recordCircuitFailure(name);
      if (circuit.state === "OPEN") {
        this.healthMap.set(name, {
          status: "degraded",
          lastProbeTs: Date.now(),
          message: `Circuit Breaker OPEN: Service isolated for ${Math.max(1, Math.ceil((circuit.openUntilTs - Date.now()) / 1000))}s to prevent flapping.`,
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: "OPEN",
          tiers: { startup: "passed", readiness: "failing", liveness: "degraded" },
        });
        return;
      }
      await this.handleUnhealthyProject(proj, { oomKilled, exitCode, statusText });
    }
  }

  async handleUnhealthyProject(proj, meta = {}) {
    const name = proj.name;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const now = Date.now();
    const { oomKilled, exitCode, statusText } = meta;
    const circuit = this.getCircuit(name);

    // 1. Log failure mode diagnosis
    if (oomKilled || exitCode === 137) {
      this.logEvent(
        name,
        "oom_killed",
        `Process terminated by OS OOM Killer (Exit 137). High memory pressure detected.`,
        "error",
      );
    } else if (exitCode === 126) {
      this.logEvent(
        name,
        "permission_denied",
        `Execution failed with Exit 126 (Permission Denied). Entrypoint lacks execute mode.`,
        "error",
      );
    } else if (exitCode === 127) {
      this.logEvent(
        name,
        "command_not_found",
        `Execution failed with Exit 127 (Command Not Found). Missing binary in PATH.`,
        "error",
      );
    }

    // 2. Record Crash Event
    const history = this.crashHistory.get(name) || [];
    history.push({ ts: now });
    const recentCrashes = history.filter((c) => now - c.ts <= 60000);
    this.crashHistory.set(name, recentCrashes);

    // 3. CrashLoopBackOff Detection (> 4 crashes in 60 seconds)
    if (recentCrashes.length >= 4) {
      this.logEvent(
        name,
        "crashloop_detected",
        `Service crashed ${recentCrashes.length} times in 60s. Entering CrashLoopBackOff.`,
        "error",
      );

      const rollbackSuccess = await this.attemptAutomaticRollback(proj);
      if (rollbackSuccess) {
        this.healthMap.set(name, {
          status: "rolled_back",
          lastProbeTs: now,
          message: "Auto-rolled back to previous stable deployment",
          latencyMs: 0,
          memoryPercent: 0,
          circuitState: circuit.state,
          tiers: { startup: "passed", readiness: "ready", liveness: "rolled_back" },
        });
        this.crashHistory.delete(name);
        return;
      }

      const backoffMs = Math.min(60000 * Math.pow(2, recentCrashes.length - 4), 300000);
      this.backoffState.set(name, {
        inBackOff: true,
        backoffMs,
        nextRetryTs: now + backoffMs,
      });

      this.healthMap.set(name, {
        status: "crashloop",
        lastProbeTs: now,
        message: `CrashLoopBackOff: Paused for ${Math.ceil(backoffMs / 1000)}s`,
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: circuit.state,
        tiers: { startup: "passed", readiness: "failing", liveness: "crashloop" },
      });
      return;
    }

    // 4. Restart cooldown + in-flight deployment re-check (prevents restart storms racing the deploy pipeline)
    const lastRestart = this.lastRestartTs.get(name) || 0;
    const RESTART_COOLDOWN_MS = 20000;
    if (now - lastRestart < RESTART_COOLDOWN_MS) {
      this.healthMap.set(name, {
        status: "degraded",
        lastProbeTs: now,
        message: `Restart cooldown active (${Math.ceil((RESTART_COOLDOWN_MS - (now - lastRestart)) / 1000)}s left) — waiting before next restart`,
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: circuit.state,
        tiers: { startup: "warming_up", readiness: "failing", liveness: "recovering" },
      });
      return;
    }
    const activeDeploy = this.db
      .prepare("SELECT phase FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
      .get(name);
    const isDeployActive =
      activeDeploy &&
      activeDeploy.phase !== "ready" &&
      activeDeploy.phase !== "failed" &&
      activeDeploy.phase !== "cancelled";

    if (isDeployActive) {
      this.healthMap.set(name, {
        status: "recovering",
        lastProbeTs: now,
        message: `Deployment in progress (${activeDeploy.phase}) — auto-restart deferred`,
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: circuit.state,
        tiers: { startup: "warming_up", readiness: "failing", liveness: "recovering" },
      });
      return;
    }

    // 5. Autonomous Restart Recovery
    this.healthMap.set(name, {
      status: "recovering",
      lastProbeTs: now,
      message: `Unresponsive: Triggering self-healing restart (attempt ${recentCrashes.length})`,
      latencyMs: 0,
      memoryPercent: 0,
      circuitState: circuit.state,
      tiers: { startup: "warming_up", readiness: "failing", liveness: "recovering" },
    });

    this.logEvent(
      name,
      "auto_restart",
      `Container unresponsive on port :${proj.port || 3000}. Auto-resurrecting service...`,
      "warning",
    );

    if (this.restartService) {
      try {
        await this.restartService(name);
        this.lastRestartTs.set(name, Date.now());
        this.logEvent(name, "restart_complete", `Service restarted successfully.`, "success");
      } catch (err) {
        this.lastRestartTs.set(name, Date.now());
        this.logEvent(name, "restart_failed", `Restart failed: ${err.message}`, "error");
      }
    }
  }

  async attemptAutomaticRollback(proj) {
    const name = proj.name;
    try {
      const pastDeploys = this.db
        .prepare(
          "SELECT * FROM deployments WHERE project=? AND (phase='ready' OR exit_code=0) ORDER BY started_at DESC LIMIT 5",
        )
        .all(name);

      if (!pastDeploys || pastDeploys.length < 2) {
        this.logEvent(
          name,
          "rollback_skipped",
          "No previous stable deployment found to roll back to.",
          "warning",
        );
        return false;
      }

      const rollbackTarget = pastDeploys[1];
      this.logEvent(
        name,
        "auto_rollback_trigger",
        `Initiating automated rollback to previous stable release ${rollbackTarget.id} (${rollbackTarget.version || "v0.1.0"})...`,
        "warning",
      );

      if (this.rollbackService) {
        await this.rollbackService(name, rollbackTarget.id);
        this.logEvent(
          name,
          "auto_rollback_complete",
          `Successfully auto-rolled back to ${rollbackTarget.id}`,
          "success",
        );
        return true;
      }
    } catch (err) {
      this.logEvent(name, "auto_rollback_failed", `Auto-rollback failed: ${err.message}`, "error");
    }
    return false;
  }

  probeHttpEndpoint(host, port, endpointPath = "/", expectedStatus = 200, timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!port || Number(port) <= 0) return resolve(false);
      const cleanPath =
        endpointPath && endpointPath.startsWith("/") ? endpointPath : `/${endpointPath || ""}`;
      const req = http.request(
        {
          hostname: host || "127.0.0.1",
          port: Number(port),
          path: cleanPath,
          method: "GET",
          timeout: timeoutMs,
          headers: { Host: "localhost", "User-Agent": "HosteraX-AutoHeal/6.0", Accept: "*/*" },
        },
        (res) => {
          res.resume(); // drain body to avoid leaking the socket
          // A custom expected status must match exactly; otherwise any non-5xx proves the server is serving.
          if (expectedStatus && expectedStatus !== 200) resolve(res.statusCode === expectedStatus);
          else resolve(res.statusCode >= 200 && res.statusCode < 500);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
      req.end();
    });
  }

  probeTcpPort(host, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
      if (!port || Number(port) <= 0) return resolve(false);
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(Number(port), host || "127.0.0.1");
    });
  }

  /** Dangling images and old build cache on each connected remote server (never volumes or running containers). */
  pruneRemoteServers() {
    for (const serverId of this.servers?.readyRemoteIds?.() ?? []) {
      try {
        runOnServer(serverId, () => {
          spawnSync("docker", ["image", "prune", "-f"], { encoding: "utf8", timeout: 30000 });
          spawnSync("docker", ["builder", "prune", "-f", "--keep-storage", "2GB"], {
            encoding: "utf8",
            timeout: 30000,
          });
        });
      } catch {}
    }
  }

  runAutoPrune() {
    this.pruneRemoteServers();
    try {
      console.log("[self-heal] Running AutoPrune disk reclamation...");
      let reclaimedMb = 0;

      // 1. Prune dangling Docker images
      try {
        const pruneRes = spawnSync("docker", ["image", "prune", "-f"], {
          encoding: "utf8",
          timeout: 15000,
        });
        if (pruneRes.stdout) {
          const spaceMatch = pruneRes.stdout.match(
            /Total reclaimed space:\s*([0-9.]+)\s*([A-Za-z]+)/i,
          );
          if (spaceMatch) {
            this.logEvent(
              "system",
              "autoprune_docker",
              `Cleaned dangling images. Reclaimed: ${spaceMatch[1]} ${spaceMatch[2]}`,
              "success",
            );
          }
        }
      } catch {}

      // 2. Prune Docker build cache (buildx / overlay2 layers)
      try {
        const bPrune = spawnSync("docker", ["builder", "prune", "-f", "--keep-storage", "2GB"], {
          encoding: "utf8",
          timeout: 20000,
        });
        if (bPrune.stdout) {
          const spaceMatch = bPrune.stdout.match(
            /Total reclaimed space:\s*([0-9.]+)\s*([A-Za-z]+)/i,
          );
          if (spaceMatch) {
            this.logEvent(
              "system",
              "autoprune_builder",
              `Cleaned builder cache layers. Reclaimed: ${spaceMatch[1]} ${spaceMatch[2]}`,
              "success",
            );
          }
        }
      } catch {}

      // 3. Prune orphaned Docker networks
      try {
        spawnSync("docker", ["network", "prune", "-f"], { encoding: "utf8", timeout: 5000 });
      } catch {}

      // 4. Rotate old build run.log files older than 7 days
      const deploysDir = path.join(this.HOME, "deployments");
      if (fs.existsSync(deploysDir)) {
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        const entries = fs.readdirSync(deploysDir);
        for (const dir of entries) {
          const p = path.join(deploysDir, dir);
          try {
            const stat = fs.statSync(p);
            if (now - stat.mtimeMs > maxAge) {
              fs.rmSync(p, { recursive: true, force: true });
              reclaimedMb += 5;
            }
          } catch {}
        }
      }

      if (reclaimedMb > 0) {
        this.logEvent(
          "system",
          "autoprune_logs",
          `Cleaned aged build logs. Reclaimed ~${reclaimedMb} MB.`,
          "info",
        );
      }
    } catch (err) {
      console.warn("[self-heal] AutoPrune error:", err.message);
    }
  }

  async simulateChaos(projectName, chaosType = "kill") {
    const proj = this.db.prepare("SELECT * FROM projects WHERE name=?").get(projectName);
    if (!proj) throw new Error("Project not found");

    const cleanName = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const startT = Date.now();

    if (chaosType === "kill") {
      this.logEvent(
        projectName,
        "chaos_injected",
        "Chaos Drill: Force-killing container to test instant resurrection (<4s)...",
        "warning",
      );
      spawnSync("docker", ["kill", `hx_${cleanName}`], { timeout: 4000 });
      // Reset circuit breaker & crash history so watchdog can restart cleanly
      this.circuitMap.set(projectName, {
        state: "CLOSED",
        failures: 0,
        lastFailureTs: 0,
        openUntilTs: 0,
        canarySuccesses: 0,
      });
      this.backoffState.delete(projectName);
      this.crashHistory.delete(projectName);

      // Immediately restart via restartService (recreates if missing)
      this.healthMap.set(projectName, {
        status: "recovering",
        lastProbeTs: Date.now(),
        message: "Chaos Drill: Resurrecting container...",
        latencyMs: 0,
        memoryPercent: 0,
        circuitState: "CLOSED",
        tiers: { startup: "warming_up", readiness: "failing", liveness: "recovering" },
      });

      if (this.restartService) {
        try {
          await this.restartService(projectName);
          this.logEvent(
            projectName,
            "restart_complete",
            "Service resurrected after chaos drill.",
            "success",
          );
          // Touch deployment finished_at so startup grace period kicks in
          const dep = this.db
            .prepare("SELECT id FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
            .get(projectName);
          if (dep) {
            this.db
              .prepare("UPDATE deployments SET finished_at=? WHERE id=?")
              .run(Date.now(), dep.id);
          }
        } catch (err) {
          this.logEvent(
            projectName,
            "restart_failed",
            `Chaos recovery failed: ${err.message}`,
            "error",
          );
        }
      }

      return { ok: true, message: "Container killed & resurrected. Startup grace active." };
    }

    if (chaosType === "memory_spike") {
      this.logEvent(
        projectName,
        "chaos_injected",
        "Chaos Drill [SIMULATED]: no real memory pressure is applied — this only exercises the alert path.",
        "warning",
      );
      this.logEvent(
        projectName,
        "memory_warning_near_oom",
        "[SIMULATED] Memory utilization 92% (drill event, not a measurement).",
        "warning",
      );
      return {
        ok: true,
        message: "Simulated memory alert recorded (no real memory pressure was applied).",
      };
    }

    if (chaosType === "flapping") {
      this.logEvent(
        projectName,
        "chaos_injected",
        "Chaos Drill: Simulating rapid flapping oscillation to test Circuit Breaker...",
        "warning",
      );
      this.recordCircuitFailure(projectName);
      this.recordCircuitFailure(projectName);
      this.recordCircuitFailure(projectName);
      return { ok: true, message: "Circuit breaker tripped to OPEN." };
    }

    return { ok: true, message: `Chaos ${chaosType} simulated.` };
  }

  /** Runs a docker CLI command (no shell) and resolves { ok, stdout }. */
  dockerCli(args, timeout = 3500) {
    return new Promise((resolve) => {
      execFile(
        "docker",
        args,
        { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => resolve({ ok: !err, stdout: stdout || "" }),
      );
    });
  }

  /** True when the registry answers HTTPS (any status) within the timeout. */
  probeRegistry(host = "registry-1.docker.io", timeoutMs = 4000) {
    return new Promise((resolve) => {
      const req = https.request(
        { host, path: "/v2/", method: "GET", timeout: timeoutMs },
        (res) => {
          res.resume();
          resolve({ ok: true, status: res.statusCode });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0 });
      });
      req.on("error", () => resolve({ ok: false, status: 0 }));
      req.end();
    });
  }

  /**
   * 9-stage audit. Every stage performs a real check against Docker / the database / the network;
   * a stage that cannot be verified is reported as "warning", never silently "passed".
   */
  async runFullPipelineAudit(projectName) {
    const proj = this.db.prepare("SELECT * FROM projects WHERE name=?").get(projectName);
    if (!proj) throw new Error("Project not found");

    const name = proj.name;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const containerName = `hx_${cleanName}`;
    const port = proj.port || 3000;
    const cfg = this.getHealthConfig(name);
    const startT = Date.now();
    const stage = (id, title, status, detail) => ({ stage: id, name: title, status, detail });

    const daemonUp = await this.probeDockerDaemon();
    let inspect = null;
    if (daemonUp) {
      const res = await this.dockerCli(["inspect", containerName]);
      if (res.ok) {
        try {
          inspect = JSON.parse(res.stdout)[0] || null;
        } catch {}
      }
    }

    // 1. Build: outcome of the most recent deployment
    const lastDep = this.db
      .prepare(
        "SELECT id, phase, version, exit_code, finished_at FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1",
      )
      .get(name);
    let buildStatus;
    if (!lastDep)
      buildStatus = stage("build", "1. Build Healer", "warning", "No deployment has been run yet");
    else if (lastDep.phase === "failed" || (lastDep.exit_code ?? 0) !== 0)
      buildStatus = stage(
        "build",
        "1. Build Healer",
        "failing",
        `Last deployment ${lastDep.version || lastDep.id} failed (exit ${lastDep.exit_code ?? "?"})`,
      );
    else if (["ready", "success"].includes(lastDep.phase))
      buildStatus = stage(
        "build",
        "1. Build Healer",
        "passed",
        `Last deployment ${lastDep.version || lastDep.id} succeeded`,
      );
    else
      buildStatus = stage(
        "build",
        "1. Build Healer",
        "warning",
        `Last deployment is still ${lastDep.phase}`,
      );

    // 2. Registry connectivity
    const reg = await this.probeRegistry();
    const registryStatus = reg.ok
      ? stage(
          "registry",
          "2. Registry Resolver",
          "passed",
          `Docker Hub registry reachable (HTTP ${reg.status})`,
        )
      : stage(
          "registry",
          "2. Registry Resolver",
          "warning",
          "Docker Hub registry unreachable (offline or blocked) — only locally cached images can be used",
        );

    // 3. Image present locally
    let pullStatus;
    if (!daemonUp)
      pullStatus = stage(
        "pull",
        "3. Pull Engine",
        "warning",
        "Docker daemon is offline — cannot inspect images",
      );
    else if (!inspect)
      pullStatus = stage(
        "pull",
        "3. Pull Engine",
        "warning",
        `Container ${containerName} does not exist`,
      );
    else {
      const img = await this.dockerCli([
        "image",
        "inspect",
        inspect.Config?.Image || "",
        "--format",
        "{{.Id}}",
      ]);
      pullStatus = img.ok
        ? stage(
            "pull",
            "3. Pull Engine",
            "passed",
            `Image ${inspect.Config?.Image} present locally (${img.stdout.trim().slice(7, 19)})`,
          )
        : stage(
            "pull",
            "3. Pull Engine",
            "failing",
            `Image ${inspect.Config?.Image} is missing locally`,
          );
    }

    // 4. Container startup state
    let startupStatus;
    if (!inspect)
      startupStatus = stage(
        "startup",
        "4. Startup Guard",
        daemonUp ? "failing" : "warning",
        daemonUp ? `Container ${containerName} not found` : "Docker daemon offline",
      );
    else {
      const st = inspect.State || {};
      const restarts = inspect.RestartCount ?? 0;
      const init = inspect.HostConfig?.Init ? "init (PID 1 reaper) enabled" : "no init process";
      startupStatus = st.Running
        ? stage(
            "startup",
            "4. Startup Guard",
            restarts > 3 ? "warning" : "passed",
            `Running; ${restarts} restart(s); ${init}`,
          )
        : stage(
            "startup",
            "4. Startup Guard",
            "failing",
            `Not running (status ${st.Status}, exit code ${st.ExitCode})`,
          );
    }

    // 5. Network
    const portOpen = await this.probeTcpPort("127.0.0.1", port, 2000);
    const networkStatus = stage(
      "network",
      "5. Network Healer",
      portOpen ? "passed" : "failing",
      portOpen
        ? `Host port :${port} is accepting connections`
        : `Nothing is listening on host port :${port}`,
    );

    // 6. HTTP health
    let httpOk = false;
    let latencyMs = 0;
    if (portOpen) {
      const pStart = Date.now();
      httpOk = await this.probeHttpEndpoint(
        "127.0.0.1",
        port,
        cfg.probePath,
        cfg.expectedStatus,
        3000,
      );
      latencyMs = Date.now() - pStart;
    }
    const healthStatus = stage(
      "health",
      "6. Health Probes",
      httpOk ? "passed" : portOpen ? "warning" : "failing",
      httpOk
        ? `GET ${cfg.probePath} answered as expected (${latencyMs}ms)`
        : portOpen
          ? `Port is open but GET ${cfg.probePath} did not return the expected response`
          : "No response — port closed",
    );

    // 7. Storage: named volumes vs. bind mounts / no persistence
    let storageStatus;
    if (!inspect)
      storageStatus = stage(
        "storage",
        "7. Storage Sentinel",
        "warning",
        "Container not inspectable",
      );
    else {
      const mounts = inspect.Mounts || [];
      const named = mounts.filter((m) => m.Type === "volume");
      const binds = mounts.filter((m) => m.Type === "bind");
      storageStatus = stage(
        "storage",
        "7. Storage Sentinel",
        binds.length ? "warning" : "passed",
        mounts.length
          ? `${named.length} named volume(s), ${binds.length} bind mount(s)`
          : "Stateless container (no persistent mounts)",
      );
    }

    // 8. Resources: container memory + host disk
    let memPct = null;
    if (inspect?.State?.Running) {
      const stats = await this.dockerCli(
        ["stats", "--no-stream", "--format", "{{.MemPerc}}", containerName],
        4500,
      );
      const parsed = parseFloat(stats.stdout);
      if (stats.ok && Number.isFinite(parsed)) memPct = parsed;
    }
    let diskFreePct = null;
    try {
      const st = fs.statfsSync(this.HOME);
      diskFreePct = Math.round((st.bavail / st.blocks) * 100);
    } catch {}
    const resWarn = (memPct ?? 0) > 75 || (diskFreePct ?? 100) < 10;
    const resFail = (memPct ?? 0) > 90 || (diskFreePct ?? 100) < 3;
    const resourceStatus = stage(
      "resources",
      "8. Resource Sentinel",
      resFail ? "failing" : resWarn ? "warning" : memPct === null ? "warning" : "passed",
      `Container RAM: ${memPct === null ? "n/a" : memPct.toFixed(1) + "%"}; host disk free: ${diskFreePct === null ? "n/a" : diskFreePct + "%"}`,
    );

    // 9. Orchestration: circuit breaker + rollback targets
    const circuit = this.getCircuit(name);
    const rollbackTargets =
      this.db
        .prepare(
          "SELECT COUNT(*) c FROM deployments WHERE project=? AND phase IN ('ready','success')",
        )
        .get(name)?.c || 0;
    const orchStatus = stage(
      "orchestration",
      "9. Orchestration & Rollback",
      circuit.state === "OPEN"
        ? "failing"
        : circuit.state === "HALF-OPEN" || circuit.failures > 0
          ? "warning"
          : "passed",
      `Circuit ${circuit.state} (${circuit.failures} recent failure(s)); ${rollbackTargets} rollback target(s)`,
    );

    const stages = [
      buildStatus,
      registryStatus,
      pullStatus,
      startupStatus,
      networkStatus,
      healthStatus,
      storageStatus,
      resourceStatus,
      orchStatus,
    ];
    const failing = stages.filter((x) => x.status === "failing").length;
    const warning = stages.filter((x) => x.status === "warning").length;

    this.logEvent(
      name,
      "pipeline_audit_completed",
      `9-stage audit finished in ${Date.now() - startT}ms: ${failing} failing, ${warning} warning, ${9 - failing - warning} passed.`,
      failing ? "error" : warning ? "warning" : "success",
    );

    return {
      project: name,
      auditTimestamp: Date.now(),
      durationMs: Date.now() - startT,
      overallStatus: failing === 0 && warning === 0 ? "all_healthy" : "warning",
      failing,
      warnings: warning,
      stages,
    };
  }

  getStatusSummary() {
    const summary = {
      running: this.running,
      daemonHealthy: this.daemonHealthy,
      totalTracked: this.healthMap.size,
      healthyCount: 0,
      recoveringCount: 0,
      crashloopCount: 0,
      projects: {},
    };

    for (const [name, data] of this.healthMap.entries()) {
      summary.projects[name] = data;
      if (data.status === "healthy") summary.healthyCount++;
      else if (data.status === "recovering") summary.recoveringCount++;
      else if (data.status === "crashloop") summary.crashloopCount++;
    }

    return summary;
  }

  getProjectEvents(projectName, limit = 20) {
    if (projectName && projectName !== "all") {
      return this.events.filter((e) => e.project === projectName).slice(0, limit);
    }
    return this.events.slice(0, limit);
  }

  async autoRemediateCrashLoop(projectName) {
    const proj = this.db.prepare("SELECT * FROM projects WHERE name=?").get(projectName);
    if (!proj) throw new Error("Project not found");

    this.logEvent(
      projectName,
      "auto_remediation_started",
      `Analyzing service health for "${projectName}" and executing clean restart...`,
      "warning",
    );

    // 1. Keep original image or sanitize tag
    let resolvedImage = proj.source;
    if (resolvedImage && !resolvedImage.includes(":") && !resolvedImage.includes("/")) {
      resolvedImage = `${resolvedImage}:latest`;
    }

    // 2. Reset Circuit Breaker & CrashLoop backoff
    this.circuitMap.set(projectName, {
      state: "CLOSED",
      failures: 0,
      lastFailureTs: 0,
      openUntilTs: 0,
      canarySuccesses: 0,
    });
    this.backoffState.delete(projectName);
    this.crashHistory.delete(projectName);

    this.logEvent(
      projectName,
      "auto_remediation_restarted",
      `Auto-Remediation: Reset circuit breaker and restarting container for "${projectName}"...`,
      "success",
    );

    // 3. Trigger clean restart
    if (this.restartService) {
      await this.restartService(projectName);
    }

    return {
      ok: true,
      project: projectName,
      image: resolvedImage,
      message: `Auto-Remediated! Clean restart initiated for "${projectName}".`,
    };
  }
}
