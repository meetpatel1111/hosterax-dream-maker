// hosterax/engine/src/cron-manager.mjs
// Autonomous Scheduled Cron Jobs & Distributed Task Execution Subsystem for HosteraX
// Supports standard 5-field CRON expressions, container exec, HTTP webhooks, and automatic DB snapshots.

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";

/**
 * Robust zero-dependency 5-field CRON parser & next-run calculator
 * Format: minute hour day-of-month month day-of-week
 */
export function calculateNextCronRun(cronExpr, fromTimestamp = Date.now()) {
  const parts = (cronExpr || "").trim().split(/\s+/);
  if (parts.length !== 5) {
    // Default fallback: 1 hour from now
    return fromTimestamp + 3600000;
  }

  const [minField, hourField, domField, monthField, dowField] = parts;

  function matchField(val, field, min, max) {
    if (field === "*") return true;
    const items = field.split(",");
    for (const item of items) {
      if (item.startsWith("*/")) {
        const step = parseInt(item.slice(2), 10);
        if (!isNaN(step) && step > 0 && val % step === 0) return true;
      } else if (item.includes("-")) {
        const [start, end] = item.split("-").map(Number);
        if (val >= start && val <= end) return true;
      } else if (parseInt(item, 10) === val) {
        return true;
      }
    }
    return false;
  }

  // Iterate minute-by-minute into the future up to 366 days
  const date = new Date(fromTimestamp + 60000);
  date.setSeconds(0, 0);

  const maxChecks = 525600; // 365 days in minutes
  for (let i = 0; i < maxChecks; i++) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dom = date.getDate();
    const month = date.getMonth() + 1; // 1-12
    const dow = date.getDay(); // 0-6 (Sun-Sat)

    if (
      matchField(minute, minField, 0, 59) &&
      matchField(hour, hourField, 0, 23) &&
      matchField(dom, domField, 1, 31) &&
      matchField(month, monthField, 1, 12) &&
      matchField(dow, dowField, 0, 6)
    ) {
      return date.getTime();
    }

    date.setMinutes(date.getMinutes() + 1);
  }

  return fromTimestamp + 86400000; // Fallback: 24h
}

export class CronManager {
  constructor({ db, backupManager }) {
    this.db = db;
    this.backupManager = backupManager;
    this.timer = null;
    this.runningJobs = new Set();

    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_name TEXT,
        schedule_type TEXT NOT NULL DEFAULT 'cron',
        cron_expression TEXT NOT NULL,
        job_type TEXT NOT NULL,
        command TEXT,
        http_url TEXT,
        http_method TEXT DEFAULT 'GET',
        http_headers_json TEXT,
        target_container TEXT,
        timeout_seconds INTEGER DEFAULT 300,
        max_retries INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_status TEXT,
        last_duration_ms INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        job_name TEXT NOT NULL,
        project_name TEXT,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER,
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled, next_run_at);
    `);
  }

  startScheduler() {
    if (this.timer) clearInterval(this.timer);
    // Poll every 10 seconds for due jobs
    this.timer = setInterval(() => this.tick(), 10000);
    this.tick();
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    const now = Date.now();
    try {
      const dueJobs = this.db
        .prepare(
          `
        SELECT * FROM cron_jobs
        WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ?
      `,
        )
        .all(now);

      for (const job of dueJobs) {
        if (!this.runningJobs.has(job.id)) {
          // Schedule next run timestamp immediately to prevent double execution
          const nextRun = calculateNextCronRun(job.cron_expression, now);
          this.db.prepare("UPDATE cron_jobs SET next_run_at=? WHERE id=?").run(nextRun, job.id);

          this.executeJob(job.id, "scheduled").catch((err) => {
            console.error(`[cron-manager] Error running job "${job.name}":`, err.message);
          });
        }
      }
    } catch (e) {
      console.error("[cron-manager] Tick error:", e.message);
    }
  }

  listJobs() {
    return this.db.prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC").all();
  }

  getJob(id) {
    return this.db.prepare("SELECT * FROM cron_jobs WHERE id=?").get(id);
  }

  createJob(data) {
    const id = `job_${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();
    const cronExpr = (data.cron_expression || "0 0 * * *").trim();
    const nextRun = calculateNextCronRun(cronExpr, now);

    const record = {
      id,
      name: data.name || "Scheduled Job",
      project_name: data.project_name || null,
      schedule_type: data.schedule_type || "cron",
      cron_expression: cronExpr,
      job_type: data.job_type || "command", // 'command', 'http', 'backup'
      command: data.command || "",
      http_url: data.http_url || "",
      http_method: data.http_method || "GET",
      http_headers_json:
        typeof data.http_headers === "object"
          ? JSON.stringify(data.http_headers)
          : data.http_headers_json || "{}",
      target_container:
        data.target_container || (data.project_name ? `hx_${data.project_name}` : null),
      timeout_seconds: data.timeout_seconds ? Number(data.timeout_seconds) : 300,
      max_retries: data.max_retries ? Number(data.max_retries) : 0,
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
      next_run_at: nextRun,
      last_run_at: null,
      last_status: null,
      last_duration_ms: null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `
      INSERT INTO cron_jobs (
        id, name, project_name, schedule_type, cron_expression, job_type,
        command, http_url, http_method, http_headers_json, target_container,
        timeout_seconds, max_retries, enabled, next_run_at, created_at, updated_at
      ) VALUES (
        @id, @name, @project_name, @schedule_type, @cron_expression, @job_type,
        @command, @http_url, @http_method, @http_headers_json, @target_container,
        @timeout_seconds, @max_retries, @enabled, @next_run_at, @created_at, @updated_at
      )
    `,
      )
      .run(record);

    return this.getJob(id);
  }

  updateJob(id, updates) {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job "${id}" not found.`);

    const now = Date.now();
    const cronExpr =
      updates.cron_expression !== undefined ? updates.cron_expression.trim() : job.cron_expression;
    const nextRun =
      updates.cron_expression !== undefined ? calculateNextCronRun(cronExpr, now) : job.next_run_at;

    const merged = {
      ...job,
      ...updates,
      cron_expression: cronExpr,
      next_run_at: nextRun,
      updated_at: now,
    };

    this.db
      .prepare(
        `
      UPDATE cron_jobs SET
        name=@name,
        project_name=@project_name,
        schedule_type=@schedule_type,
        cron_expression=@cron_expression,
        job_type=@job_type,
        command=@command,
        http_url=@http_url,
        http_method=@http_method,
        http_headers_json=@http_headers_json,
        target_container=@target_container,
        timeout_seconds=@timeout_seconds,
        max_retries=@max_retries,
        enabled=@enabled,
        next_run_at=@next_run_at,
        updated_at=@updated_at
      WHERE id=@id
    `,
      )
      .run(merged);

    return this.getJob(id);
  }

  deleteJob(id) {
    this.db.prepare("DELETE FROM job_runs WHERE job_id=?").run(id);
    const res = this.db.prepare("DELETE FROM cron_jobs WHERE id=?").run(id);
    return res.changes > 0;
  }

  listJobRuns(jobId = null, limit = 50) {
    if (jobId) {
      return this.db
        .prepare("SELECT * FROM job_runs WHERE job_id=? ORDER BY started_at DESC LIMIT ?")
        .all(jobId, limit);
    }
    return this.db.prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?").all(limit);
  }

  getJobRun(runId) {
    return this.db.prepare("SELECT * FROM job_runs WHERE id=?").get(runId);
  }

  /**
   * Execute a scheduled job immediately
   */
  async executeJob(id, triggerType = "manual") {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job "${id}" not found.`);

    const runId = `run_${crypto.randomBytes(6).toString("hex")}`;
    const startedAt = Date.now();
    this.runningJobs.add(id);

    this.db
      .prepare(
        `
      INSERT INTO job_runs (
        id, job_id, job_name, project_name, trigger_type, status, started_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'running', ?
      )
    `,
      )
      .run(runId, job.id, job.name, job.project_name, triggerType, startedAt);

    let status = "success";
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    let errorMessage = null;

    try {
      if (job.job_type === "backup" && this.backupManager) {
        // Execute automated database backup
        const target = job.project_name || "all";
        stdout = `[backup-job] Initiating scheduled database snapshot for "${target}"...\n`;
        const res = await this.backupManager.createBackup({
          databaseName: job.project_name || "default",
          dbType: "volume",
          projectName: job.project_name || null,
        });
        stdout += `[backup-job] Successfully created snapshot: ${res.id} (${res.sizeMb} MB, SHA-256: ${res.sha256})\n`;
      } else if (job.job_type === "http") {
        // Execute HTTP request
        const res = await this._runHttpJob(job);
        stdout = `[http-job] HTTP ${job.http_method} ${job.http_url} -> Status ${res.statusCode}\n\nResponse:\n${res.bodyText}`;
        if (res.statusCode >= 400) {
          status = "failed";
          exitCode = res.statusCode;
          errorMessage = `HTTP error ${res.statusCode}`;
        }
      } else {
        // Execute shell command (inside container if target_container specified, else host)
        const execRes = await this._runCommandJob(job);
        stdout = execRes.stdout;
        stderr = execRes.stderr;
        exitCode = execRes.exitCode;
        if (exitCode !== 0) {
          status = "failed";
          errorMessage = `Command failed with exit code ${exitCode}`;
        }
      }
    } catch (err) {
      status = "failed";
      exitCode = 1;
      errorMessage = err.message;
      stderr += `\n[error] ${err.message}`;
    } finally {
      this.runningJobs.delete(id);
      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;

      this.db
        .prepare(
          `
        UPDATE job_runs SET
          status=?, finished_at=?, duration_ms=?, exit_code=?, stdout=?, stderr=?, error_message=?
        WHERE id=?
      `,
        )
        .run(status, finishedAt, durationMs, exitCode, stdout, stderr, errorMessage, runId);

      this.db
        .prepare(
          `
        UPDATE cron_jobs SET
          last_run_at=?, last_status=?, last_duration_ms=?
        WHERE id=?
      `,
        )
        .run(startedAt, status, durationMs, id);
    }

    return this.getJobRun(runId);
  }

  async _runCommandJob(job) {
    return new Promise((resolve) => {
      let cmd = "sh";
      let args = ["-c", job.command];

      if (job.target_container) {
        cmd = "docker";
        args = ["exec", job.target_container, "sh", "-c", job.command];
      } else if (process.platform === "win32") {
        cmd = "powershell.exe";
        args = ["-NoProfile", "-Command", job.command];
      }

      let stdout = "";
      let stderr = "";
      let child;

      try {
        child = spawn(cmd, args, { encoding: "utf8" });
      } catch (err) {
        return resolve({ exitCode: 1, stdout: "", stderr: err.message });
      }

      const timeoutMs = (job.timeout_seconds || 300) * 1000;
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve({
          exitCode: 124,
          stdout,
          stderr: stderr + `\n[timeout] Process killed after ${job.timeout_seconds}s limit.`,
        });
      }, timeoutMs);

      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));

      child.on("close", (code) => {
        clearTimeout(t);
        resolve({ exitCode: code ?? 0, stdout, stderr });
      });

      child.on("error", (err) => {
        clearTimeout(t);
        resolve({ exitCode: 1, stdout, stderr: err.message });
      });
    });
  }

  async _runHttpJob(job) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(job.http_url);
      const isHttps = parsed.protocol === "https:";
      const client = isHttps ? https : http;

      let headers = { "User-Agent": "HosteraX-CronScheduler/1.0" };
      try {
        if (job.http_headers_json) {
          headers = { ...headers, ...JSON.parse(job.http_headers_json) };
        }
      } catch {}

      const req = client.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: job.http_method || "GET",
          headers,
          timeout: (job.timeout_seconds || 60) * 1000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode,
              bodyText: body.toString("utf8"),
            });
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`HTTP request timed out after ${job.timeout_seconds}s`));
      });
      req.end();
    });
  }
}
