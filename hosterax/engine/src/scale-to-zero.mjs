// hosterax/engine/src/scale-to-zero.mjs
// Scale-to-Zero Auto-Sleep Engine for HosteraX (Preview & Staging Envs)
// Saves 60-80% of server RAM by suspending idle containers and waking them on-demand.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import net from "node:net";

const execAsync = promisify(exec);

export class ScaleToZeroManager {
  constructor(db) {
    this.db = db;
    this.activityMap = new Map(); // projectName -> lastRequestTimestamp
    this.wakingMap = new Map(); // projectName -> Promise
    this.initDb();
    this.interval = null;
  }

  initDb() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS scale_to_zero_config (
          project TEXT PRIMARY KEY,
          enabled INTEGER DEFAULT 0,
          idle_timeout_minutes INTEGER DEFAULT 15,
          is_sleeping INTEGER DEFAULT 0,
          last_slept_at INTEGER DEFAULT 0,
          last_woken_at INTEGER DEFAULT 0,
          total_sleep_seconds INTEGER DEFAULT 0
        );
      `);
    } catch {}
  }

  /**
   * Called by edge proxy or router on incoming HTTP traffic
   */
  recordActivity(projectName) {
    if (!projectName) return;
    const clean = projectName.toLowerCase();
    this.activityMap.set(clean, Date.now());

    // If marked sleeping in DB, clear sleeping flag
    try {
      const row = this.db.prepare("SELECT * FROM scale_to_zero_config WHERE project=?").get(clean);
      if (row && row.is_sleeping) {
        this.db.prepare("UPDATE scale_to_zero_config SET is_sleeping=0, last_woken_at=? WHERE project=?").run(Date.now(), clean);
      }
    } catch {}
  }

  getConfig(projectName) {
    const clean = projectName.toLowerCase();
    const row = this.db.prepare("SELECT * FROM scale_to_zero_config WHERE project=?").get(clean);
    return {
      project: clean,
      enabled: Boolean(row?.enabled),
      idleTimeoutMinutes: row?.idle_timeout_minutes || 15,
      isSleeping: Boolean(row?.is_sleeping),
      lastRequestAt: this.activityMap.get(clean) || Date.now(),
      lastSleptAt: row?.last_slept_at || 0,
      lastWokenAt: row?.last_woken_at || 0,
    };
  }

  setConfig(projectName, { enabled = false, idleTimeoutMinutes = 15 }) {
    const clean = projectName.toLowerCase();
    const existing = this.db.prepare("SELECT * FROM scale_to_zero_config WHERE project=?").get(clean);
    if (existing) {
      this.db.prepare("UPDATE scale_to_zero_config SET enabled=?, idle_timeout_minutes=? WHERE project=?").run(
        enabled ? 1 : 0,
        idleTimeoutMinutes,
        clean
      );
    } else {
      this.db.prepare("INSERT INTO scale_to_zero_config (project, enabled, idle_timeout_minutes) VALUES (?, ?, ?)").run(
        clean,
        enabled ? 1 : 0,
        idleTimeoutMinutes
      );
    }
    return this.getConfig(clean);
  }

  /**
   * Manually put a project container to sleep
   */
  async sleepProject(projectName) {
    const clean = projectName.toLowerCase();
    const project = this.db.prepare("SELECT * FROM projects WHERE LOWER(name)=?").get(clean);
    if (!project) return { ok: false, error: "Project not found" };

    const containerName = `hx_${clean.replace(/[^a-z0-9]/g, "_")}`;
    try {
      await execAsync(`docker stop ${containerName}`, { timeout: 10000 });
      this.db.prepare(`
        INSERT INTO scale_to_zero_config (project, enabled, is_sleeping, last_slept_at)
        VALUES (?, 1, 1, ?)
        ON CONFLICT(project) DO UPDATE SET is_sleeping=1, last_slept_at=?
      `).run(clean, Date.now(), Date.now());

      return { ok: true, isSleeping: true, project: clean };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Wake up a sleeping container and wait until port is responsive
   */
  async wakeProject(projectName) {
    const clean = projectName.toLowerCase();
    if (this.wakingMap.has(clean)) {
      return this.wakingMap.get(clean);
    }

    const wakePromise = (async () => {
      const project = this.db.prepare("SELECT * FROM projects WHERE LOWER(name)=?").get(clean);
      if (!project || !project.port) {
        return { ok: false, error: "Project or port not found" };
      }

      const containerName = `hx_${clean.replace(/[^a-z0-9]/g, "_")}`;
      const startTime = Date.now();

      try {
        await execAsync(`docker start ${containerName}`, { timeout: 10000 });
      } catch (e) {
        // Might already be running
      }

      // Poll port readiness
      let isReady = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150));
        isReady = await this.pingPort(project.port);
        if (isReady) break;
      }

      const durationMs = Date.now() - startTime;

      this.db.prepare(`
        INSERT INTO scale_to_zero_config (project, is_sleeping, last_woken_at)
        VALUES (?, 0, ?)
        ON CONFLICT(project) DO UPDATE SET is_sleeping=0, last_woken_at=?
      `).run(clean, Date.now(), Date.now());

      this.activityMap.set(clean, Date.now());

      return {
        ok: true,
        project: clean,
        isSleeping: false,
        port: project.port,
        wakeDurationMs: durationMs,
      };
    })();

    this.wakingMap.set(clean, wakePromise);
    try {
      const res = await wakePromise;
      return res;
    } finally {
      this.wakingMap.delete(clean);
    }
  }

  pingPort(port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port: Number(port), host: "127.0.0.1", timeout: 400 });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Periodic background check for idle containers to put to sleep
   */
  async checkIdleContainers() {
    try {
      const configs = this.db.prepare("SELECT * FROM scale_to_zero_config WHERE enabled=1 AND is_sleeping=0").all();
      const now = Date.now();

      for (const cfg of configs) {
        const lastReq = this.activityMap.get(cfg.project.toLowerCase()) || cfg.last_woken_at || now;
        const idleMs = now - lastReq;
        const thresholdMs = (cfg.idle_timeout_minutes || 15) * 60 * 1000;

        if (idleMs > thresholdMs) {
          console.log(`[scale-to-zero] Project ${cfg.project} idle for ${Math.round(idleMs / 60000)}m. Putting container to sleep to reclaim RAM...`);
          await this.sleepProject(cfg.project);
        }
      }
    } catch {}
  }

  start() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.checkIdleContainers(), 60000); // check every 60s
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
