// hosterax/engine/src/backup-scheduler.mjs
// Scheduled database backups with retention and verification.
//
// A schedule says "back up this database on this cron expression, keep the last N (and nothing older
// than D days), and prove the backups are usable". Each run: take the backup, verify the archive,
// every Nth run restore it into a throwaway container, and only then prune old backups. If any step
// fails the run is recorded as failed, an event is logged, and nothing is pruned — the last good
// backups stay exactly where they are.

import crypto from "node:crypto";
import { calculateNextCronRun } from "./cron-manager.mjs";
import { isSafeContainerName } from "./security.mjs";

const DB_TYPES = [
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "volume",
];
const DRILL_MODES = ["off", "archive", "restore"];
const DAY_MS = 86400000;

/** Strict 5-field cron check. Only forms the engine's cron calculator understands are accepted. */
export function validateCron(expr) {
  const parts = String(expr || "")
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) return "cron needs 5 fields: minute hour day-of-month month day-of-week";
  const bounds = [
    ["minute", 0, 59],
    ["hour", 0, 23],
    ["day-of-month", 1, 31],
    ["month", 1, 12],
    ["day-of-week", 0, 6],
  ];
  for (let i = 0; i < 5; i++) {
    const [label, min, max] = bounds[i];
    for (const item of parts[i].split(",")) {
      let m;
      if (item === "*") continue;
      if ((m = /^\*\/(\d+)$/.exec(item))) {
        if (Number(m[1]) < 1) return `${label}: step must be at least 1`;
      } else if ((m = /^(\d+)-(\d+)$/.exec(item))) {
        if (Number(m[1]) < min || Number(m[2]) > max || Number(m[1]) > Number(m[2]))
          return `${label}: range ${item} is outside ${min}-${max}`;
      } else if (/^\d+$/.test(item)) {
        if (Number(item) < min || Number(item) > max)
          return `${label}: ${item} is outside ${min}-${max}`;
      } else {
        return `${label}: "${item}" is not supported (use *, */n, n, a-b or a comma list)`;
      }
    }
  }
  return null;
}

function intInRange(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

export class BackupScheduler {
  constructor({ db, backups, recordEvent = () => {}, now = () => Date.now(), tickMs = 30000 }) {
    this.db = db;
    this.backups = backups;
    this.recordEvent = recordEvent;
    this.now = now;
    this.tickMs = tickMs;
    this.timer = null;
    this.queue = Promise.resolve();
    this.active = new Set();
    this.initSchema();
  }

  initSchema() {
    // An earlier version declared an unused table with this name and a different shape
    // (database_id / interval_minutes). Nothing ever wrote to it; keep it aside rather than drop it.
    try {
      const cols = this.db
        .prepare("PRAGMA table_info(backup_schedules)")
        .all()
        .map((c) => c.name);
      if (cols.length && !cols.includes("cron_expression")) {
        this.db.exec("DROP TABLE IF EXISTS backup_schedules_legacy");
        this.db.exec("ALTER TABLE backup_schedules RENAME TO backup_schedules_legacy");
      }
    } catch {}
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backup_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        database_name TEXT NOT NULL,
        db_type TEXT NOT NULL,
        project_name TEXT,
        container_name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        keep_last INTEGER NOT NULL DEFAULT 7,
        keep_days INTEGER NOT NULL DEFAULT 0,
        drill TEXT NOT NULL DEFAULT 'archive',
        drill_every INTEGER NOT NULL DEFAULT 7,
        runs_since_drill INTEGER NOT NULL DEFAULT 7,
        encrypt INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        last_status TEXT,
        last_error TEXT,
        last_backup_id TEXT,
        last_drill_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  _shape(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      databaseName: r.database_name,
      dbType: r.db_type,
      projectName: r.project_name,
      containerName: r.container_name,
      cron: r.cron_expression,
      keepLast: r.keep_last,
      keepDays: r.keep_days,
      drill: r.drill,
      drillEvery: r.drill_every,
      encrypt: r.encrypt === 1,
      enabled: r.enabled === 1,
      lastRunAt: r.last_run_at,
      lastStatus: r.last_status,
      lastError: r.last_error,
      lastBackupId: r.last_backup_id,
      lastDrillAt: r.last_drill_at,
      nextRunAt: r.next_run_at,
      createdAt: r.created_at,
    };
  }

  list() {
    return this.db
      .prepare("SELECT * FROM backup_schedules ORDER BY created_at DESC")
      .all()
      .map((r) => this._shape(r));
  }

  get(id) {
    return this._shape(this.db.prepare("SELECT * FROM backup_schedules WHERE id=?").get(id));
  }

  _validateFields(cfg, { partial = false } = {}) {
    const out = {};
    if (!partial || cfg.cron !== undefined) {
      const err = validateCron(cfg.cron);
      if (err) throw new Error(err);
      out.cron = String(cfg.cron).trim().split(/\s+/).join(" ");
    }
    if (!partial || cfg.keepLast !== undefined)
      out.keepLast = intInRange(cfg.keepLast, "keepLast", 1, 365, 7);
    if (!partial || cfg.keepDays !== undefined)
      out.keepDays = intInRange(cfg.keepDays, "keepDays", 0, 3650, 0);
    if (!partial || cfg.drill !== undefined) {
      const drill = cfg.drill ?? "archive";
      if (!DRILL_MODES.includes(drill))
        throw new Error(`drill must be one of: ${DRILL_MODES.join(", ")}`);
      out.drill = drill;
    }
    if (!partial || cfg.drillEvery !== undefined)
      out.drillEvery = intInRange(cfg.drillEvery, "drillEvery", 1, 365, 7);
    if (cfg.encrypt !== undefined) out.encrypt = Boolean(cfg.encrypt);
    if (cfg.enabled !== undefined) out.enabled = Boolean(cfg.enabled);
    if (cfg.name !== undefined) out.name = String(cfg.name).trim().slice(0, 80);
    return out;
  }

  create(cfg) {
    const databaseName = String(cfg.databaseName || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(databaseName))
      throw new Error("databaseName is required (letters, digits, '_', '-', '.')");
    const dbType = String(cfg.dbType || "").toLowerCase();
    if (!DB_TYPES.includes(dbType))
      throw new Error(`dbType must be one of: ${DB_TYPES.join(", ")}`);
    const containerName = String(cfg.containerName || databaseName);
    if (!isSafeContainerName(containerName)) throw new Error("containerName is not a valid name");
    const f = this._validateFields(cfg);
    const now = this.now();
    const id = `bsch_${crypto.randomBytes(5).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO backup_schedules (id, name, database_name, db_type, project_name, container_name,
           cron_expression, keep_last, keep_days, drill, drill_every, runs_since_drill, encrypt, enabled,
           next_run_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      )
      .run(
        id,
        f.name || `${databaseName} (${f.cron})`,
        databaseName,
        dbType,
        cfg.projectName || null,
        containerName,
        f.cron,
        f.keepLast,
        f.keepDays,
        f.drill,
        f.drillEvery,
        f.drillEvery, // the first run gets a full drill, which proves the setup works
        f.encrypt ? 1 : 0,
        calculateNextCronRun(f.cron, now),
        now,
        now,
      );
    return this.get(id);
  }

  update(id, patch) {
    const current = this.db.prepare("SELECT * FROM backup_schedules WHERE id=?").get(id);
    if (!current) return null;
    const f = this._validateFields(patch, { partial: true });
    const sets = [];
    const values = [];
    const put = (col, v) => {
      sets.push(`${col}=?`);
      values.push(v);
    };
    if (f.name !== undefined) put("name", f.name);
    if (f.cron !== undefined) {
      put("cron_expression", f.cron);
      put("next_run_at", calculateNextCronRun(f.cron, this.now()));
    }
    if (f.keepLast !== undefined) put("keep_last", f.keepLast);
    if (f.keepDays !== undefined) put("keep_days", f.keepDays);
    if (f.drill !== undefined) put("drill", f.drill);
    if (f.drillEvery !== undefined) put("drill_every", f.drillEvery);
    if (f.encrypt !== undefined) put("encrypt", f.encrypt ? 1 : 0);
    if (f.enabled !== undefined) {
      put("enabled", f.enabled ? 1 : 0);
      if (f.enabled && !current.enabled)
        put("next_run_at", calculateNextCronRun(f.cron ?? current.cron_expression, this.now()));
    }
    if (sets.length) {
      put("updated_at", this.now());
      this.db
        .prepare(`UPDATE backup_schedules SET ${sets.join(", ")} WHERE id=?`)
        .run(...values, id);
    }
    return this.get(id);
  }

  /** Removes the schedule. Backups it already took are kept. */
  remove(id) {
    const r = this.db.prepare("DELETE FROM backup_schedules WHERE id=?").run(id);
    this.db.prepare("UPDATE backups SET schedule_id=NULL WHERE schedule_id=?").run(id);
    return r.changes > 0;
  }

  // ───────────── running ─────────────

  start() {
    // Nothing can really be running when the engine boots; whatever was is now dead.
    try {
      this.db
        .prepare(
          "UPDATE backups SET status='failed', error_message='interrupted by an engine restart', finished_at=? WHERE status='in_progress'",
        )
        .run(this.now());
      this.db
        .prepare(
          "UPDATE backup_schedules SET last_status='failed', last_error='interrupted by an engine restart' WHERE last_status='running'",
        )
        .run();
    } catch {}
    this.backups.cleanupDrillContainers?.().catch(() => {});
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs every enabled schedule whose time has come. Missed runs (engine was down) run once. */
  async tick() {
    const due = this.db
      .prepare(
        "SELECT id FROM backup_schedules WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?",
      )
      .all(this.now());
    for (const { id } of due) {
      try {
        await this.runNow(id, { manual: false });
      } catch {
        // already running, or removed meanwhile — the next tick decides again
      }
    }
  }

  /** Serialises runs: dumps and drills are heavy, so only one happens at a time. */
  runNow(id, { manual = true } = {}) {
    const schedule = this.get(id);
    if (!schedule) return Promise.reject(new Error("schedule not found"));
    if (this.active.has(id)) return Promise.reject(new Error("this schedule is already running"));
    this.active.add(id);
    const run = this.queue.then(() => this._execute(id, manual));
    this.queue = run.catch(() => {});
    return run.finally(() => this.active.delete(id));
  }

  async _execute(id, manual) {
    const row = this.db.prepare("SELECT * FROM backup_schedules WHERE id=?").get(id);
    if (!row) throw new Error("schedule not found");
    const started = this.now();
    this.db
      .prepare("UPDATE backup_schedules SET last_status='running', last_run_at=? WHERE id=?")
      .run(started, id);

    let backup = null;
    let drilled = false;
    let error = null;
    let pruned = 0;
    let runsSinceDrill = row.runs_since_drill;
    try {
      backup = await this.backups.createBackup({
        databaseName: row.database_name,
        dbType: row.db_type,
        projectName: row.project_name,
        containerName: row.container_name,
        encrypt: row.encrypt === 1,
        scheduleId: id,
      });
      if (row.drill !== "off") {
        const verified = await this.backups.verifyBackup(backup.id);
        if (!verified.ok) throw new Error(verified.message);
        runsSinceDrill += 1;
        if (row.drill === "restore" && (manual || runsSinceDrill >= row.drill_every)) {
          const drill = await this.backups.restoreDrill(backup.id);
          if (!drill.ok) throw new Error(drill.message);
          if (!drill.skipped) {
            drilled = true;
            runsSinceDrill = 0;
          }
        }
      }
      pruned = await this._applyRetention(row);
    } catch (e) {
      error = e.message;
    }

    const finished = this.now();
    this.db
      .prepare(
        `UPDATE backup_schedules SET last_status=?, last_error=?, last_backup_id=COALESCE(?, last_backup_id),
           runs_since_drill=?, last_drill_at=COALESCE(?, last_drill_at), next_run_at=?, updated_at=? WHERE id=?`,
      )
      .run(
        error ? "failed" : "ok",
        error,
        backup?.id ?? null,
        runsSinceDrill,
        drilled ? finished : null,
        calculateNextCronRun(row.cron_expression, finished),
        finished,
        id,
      );
    if (error) {
      this.recordEvent(
        row.project_name || row.database_name,
        "backup_failed",
        `Scheduled backup "${row.name}" failed: ${error}`,
        "failed",
      );
    }
    return {
      ok: !error,
      scheduleId: id,
      backupId: backup?.id ?? null,
      drilled,
      pruned,
      error,
    };
  }

  /** Keeps the newest keep_last backups of this schedule, and drops anything older than keep_days. */
  async _applyRetention(schedule) {
    const rows = this.db
      .prepare(
        "SELECT id, created_at, s3_key FROM backups WHERE schedule_id=? AND status='completed' ORDER BY created_at DESC",
      )
      .all(schedule.id);
    const cutoff = schedule.keep_days > 0 ? this.now() - schedule.keep_days * DAY_MS : null;
    const doomed = rows.filter(
      (r, i) => i >= schedule.keep_last || (cutoff !== null && i >= 1 && r.created_at < cutoff),
    );
    // Failed attempts are noise after two weeks.
    const stale = this.db
      .prepare(
        "SELECT id, s3_key FROM backups WHERE schedule_id=? AND status='failed' AND created_at<?",
      )
      .all(schedule.id, this.now() - 14 * DAY_MS);
    for (const r of [...doomed, ...stale]) {
      if (r.s3_key) await this.backups.deleteRemoteS3Backup?.(r.s3_key).catch(() => {});
      this.backups.deleteBackup(r.id);
    }
    return doomed.length + stale.length;
  }
}
