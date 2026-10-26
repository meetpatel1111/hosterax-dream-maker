import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import {
  initSecrets,
  createDecryptStream,
  createEncryptStream,
  authenticateEncryptedFile,
  isEncryptedArchive,
} from "../src/secrets.mjs";
import { BackupManager } from "../src/backup-manager.mjs";
import { BackupScheduler, validateCron } from "../src/backup-scheduler.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-backups-"));
initSecrets(home);
const db = new Database(":memory:");
const manager = new BackupManager({ db, HOME: home });

const read = (p) => fs.readFileSync(p);
const gz = (buf) => zlib.gzipSync(buf);

async function encryptToFile(plain, file) {
  fs.writeFileSync(file + ".plain", plain);
  await pipeline(
    fs.createReadStream(file + ".plain"),
    createEncryptStream(),
    fs.createWriteStream(file),
  );
  fs.rmSync(file + ".plain");
}

/** Records a finished backup whose file holds `content` exactly as the dump pipeline would have written it. */
async function plant({
  type,
  content,
  encrypt = false,
  id = "bkp_" + crypto.randomBytes(3).toString("hex"),
}) {
  const file = path.join(home, `${id}.bin`);
  if (encrypt) await encryptToFile(content, file);
  else fs.writeFileSync(file, content);
  const sha = await manager._computeSha256(file);
  db.prepare(
    `INSERT INTO backups (id, project_name, database_name, db_type, file_path, file_size_bytes, sha256, destination, status, created_at, container_name, encrypted)
     VALUES (?, 'p', 'db1', ?, ?, ?, ?, 'local', 'completed', ?, 'c1', ?)`,
  ).run(id, type, file, fs.statSync(file).size, sha, Date.now(), encrypt ? 1 : 0);
  return id;
}

// ───────────────────────── encryption ─────────────────────────

test("encrypted archives round-trip, hide their content and refuse tampering", async () => {
  const plain = Buffer.concat([Buffer.from("SECRET-ROW-DATA "), crypto.randomBytes(300000)]);
  const file = path.join(home, "round.enc");
  await encryptToFile(plain, file);

  assert.ok(isEncryptedArchive(file));
  assert.ok(!read(file).includes("SECRET-ROW-DATA"), "plaintext leaked into the archive");

  const out = [];
  await pipeline(fs.createReadStream(file), createDecryptStream(), async function* (src) {
    for await (const c of src) out.push(c);
  });
  assert.ok(Buffer.concat(out).equals(plain), "decrypted bytes differ from the original");
  await authenticateEncryptedFile(file);

  const tampered = Buffer.from(read(file));
  tampered[tampered.length >> 1] ^= 0xff;
  const tamperedFile = path.join(home, "tampered.enc");
  fs.writeFileSync(tamperedFile, tampered);
  await assert.rejects(authenticateEncryptedFile(tamperedFile), /authentication/);

  const truncatedFile = path.join(home, "truncated.enc");
  fs.writeFileSync(truncatedFile, read(file).subarray(0, 100));
  await assert.rejects(authenticateEncryptedFile(truncatedFile), /authentication|truncated/);

  const notOurs = path.join(home, "plain.gz");
  fs.writeFileSync(notOurs, gz(Buffer.from("hello")));
  assert.equal(isEncryptedArchive(notOurs), false);
  await assert.rejects(authenticateEncryptedFile(notOurs), /not a HosteraX encrypted archive/);
});

// ───────────────────────── verification ─────────────────────────

test("verification accepts complete archives of every kind, encrypted or not", async () => {
  const pg = Buffer.from(
    "CREATE TABLE t();\n--\n-- PostgreSQL database cluster dump complete\n--\n",
  );
  const my = Buffer.from("INSERT INTO t VALUES (1);\n-- Dump completed on 2026-10-23 10:00:00\n");
  const rdb = Buffer.concat([Buffer.from("REDIS0011"), crypto.randomBytes(64)]);
  const tarHeader = Buffer.alloc(512);
  tarHeader.write("ustar  \0", 257, "latin1");

  const cases = [
    ["postgres", gz(pg)],
    ["mysql", gz(my)],
    ["mariadb", gz(my)],
    ["redis", gz(rdb)],
    ["volume", gz(tarHeader)],
    ["mongodb", crypto.randomBytes(256)],
  ];
  for (const [type, content] of cases) {
    for (const encrypt of [false, true]) {
      const id = await plant({ type, content, encrypt });
      const r = await manager.verifyBackup(id);
      assert.equal(r.ok, true, `${type} encrypted=${encrypt}: ${r.message}`);
      const row = db.prepare("SELECT verify_status, verified_at FROM backups WHERE id=?").get(id);
      assert.equal(row.verify_status, "verified");
      assert.ok(row.verified_at > 0);
    }
  }
});

test("verification catches truncated, incomplete, altered and mislabelled archives", async () => {
  const pgFull = gz(
    Buffer.from("CREATE TABLE t();\n-- PostgreSQL database cluster dump complete\n"),
  );

  // 1. gzip cut in half
  let id = await plant({ type: "postgres", content: pgFull.subarray(0, pgFull.length >> 1) });
  let r = await manager.verifyBackup(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /cannot be read|incomplete/);

  // 2. a valid gzip of a dump that never finished
  id = await plant({ type: "postgres", content: gz(Buffer.from("CREATE TABLE t();\n")) });
  r = await manager.verifyBackup(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /incomplete/);

  // 3. the file changed after it was recorded
  id = await plant({ type: "postgres", content: pgFull });
  fs.appendFileSync(db.prepare("SELECT file_path FROM backups WHERE id=?").get(id).file_path, "x");
  r = await manager.verifyBackup(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /SHA-256/);

  // 4. wrong content for the declared type
  id = await plant({ type: "redis", content: gz(Buffer.from("not an rdb")) });
  assert.match((await manager.verifyBackup(id)).message, /not a Redis RDB/);
  id = await plant({ type: "volume", content: gz(Buffer.from("not a tar")) });
  assert.match((await manager.verifyBackup(id)).message, /not a tar archive/);

  // 5. tampered encrypted archive
  id = await plant({ type: "postgres", content: pgFull, encrypt: true });
  const file = db.prepare("SELECT file_path FROM backups WHERE id=?").get(id).file_path;
  const bytes = read(file);
  bytes[40] ^= 0xff;
  fs.writeFileSync(file, bytes);
  db.prepare("UPDATE backups SET sha256=? WHERE id=?").run(await manager._computeSha256(file), id);
  r = await manager.verifyBackup(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /authentication/);
  assert.equal(
    db.prepare("SELECT verify_status FROM backups WHERE id=?").get(id).verify_status,
    "failed",
  );
});

// ───────────────────────── restore drill (fake Docker) ─────────────────────────

/** A BackupManager whose Docker calls are recorded and answered by `answer(args)` instead of run. */
class FakeDockerManager extends BackupManager {
  constructor(opts, { answer, restoreError } = {}) {
    super(opts);
    this.calls = [];
    this.restores = [];
    this.answer = answer ?? defaultAnswer;
    this.restoreError = restoreError;
  }
  async _docker(args) {
    this.calls.push(args);
    return this.answer(args);
  }
  async _restoreByType(type, container, file, opts) {
    this.restores.push({ type, container, file, opts });
    if (this.restoreError) throw new Error(this.restoreError);
  }
  _sleep() {
    return Promise.resolve();
  }
}

function defaultAnswer(args) {
  if (args[0] === "inspect") {
    return args.includes("{{.Config.Image}}")
      ? "postgres:16-alpine\n"
      : '["POSTGRES_PASSWORD=pw","POSTGRES_USER=app","PATH=/usr/bin","HOME=/root"]';
  }
  if (args[0] === "exec") return "3\n"; // readiness probes succeed; the sanity query answers with a count
  return "";
}

async function drillSetup(options) {
  const m = new FakeDockerManager({ db: new Database(":memory:"), HOME: home }, options);
  const id = "bkp_drill_" + crypto.randomBytes(3).toString("hex");
  const file = path.join(home, `${id}.sql.gz`);
  fs.writeFileSync(file, gz(Buffer.from("-- PostgreSQL database cluster dump complete\n")));
  m.db
    .prepare(
      `INSERT INTO backups (id, project_name, database_name, db_type, file_path, file_size_bytes, sha256, destination, status, created_at, container_name, encrypted)
       VALUES (?, 'p', 'db1', 'postgres', ?, 10, '', 'local', 'completed', ?, 'hx_pg', 0)`,
    )
    .run(id, file, Date.now());
  return { m, id };
}

const removedScratch = (m) => m.calls.at(-1);

test("a restore drill restores into an isolated scratch container and always removes it", async () => {
  const { m, id } = await drillSetup();
  const result = await m.restoreDrill(id);
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /Restore drill passed/);

  const run = m.calls.find((a) => a[0] === "run");
  assert.ok(run, "no scratch container was started");
  assert.equal(run[run.indexOf("--network") + 1], "none", "the scratch container must be isolated");
  assert.ok(run.includes("hosterax.drill=1"));
  assert.ok(run.includes("POSTGRES_PASSWORD=pw") && run.includes("POSTGRES_USER=app"));
  assert.ok(
    !run.some((a) => a.startsWith("PATH=") || a.startsWith("HOME=")),
    "PATH and HOME must not be copied",
  );
  assert.equal(run.at(-1), "postgres:16-alpine");

  const scratch = run[run.indexOf("--name") + 1];
  assert.match(scratch, /^hx_drill_[0-9a-f]+$/);
  assert.equal(m.restores.length, 1);
  assert.equal(m.restores[0].container, scratch, "the restore must target the scratch container");
  assert.notEqual(m.restores[0].container, "hx_pg", "the source database must never be touched");

  assert.deepEqual(removedScratch(m).slice(0, 3), ["rm", "-f", "-v"]);
  assert.ok(removedScratch(m).includes(scratch));
  assert.equal(
    m.db.prepare("SELECT verify_status FROM backups WHERE id=?").get(id).verify_status,
    "verified",
  );
});

test("drill containers belong to their engine: cleanup never touches another engine's drill", async () => {
  const { m, id } = await drillSetup();
  assert.equal((await m.restoreDrill(id)).ok, true);
  const run = m.calls.find((a) => a[0] === "run");
  assert.ok(
    run.includes(`hosterax.engine=${m.instanceId}`),
    "the scratch container names its engine",
  );

  m.calls.length = 0;
  await m.cleanupDrillContainers();
  const ps = m.calls.find((a) => a[0] === "ps");
  assert.ok(ps.includes("label=hosterax.drill=1"));
  assert.ok(ps.includes(`label=hosterax.engine=${m.instanceId}`), "only this engine's containers");

  // Another engine (another data directory) on the same Docker daemon has a different identity, so its
  // restart cannot remove a drill that is running here.
  const elsewhere = new FakeDockerManager({
    db: new Database(":memory:"),
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-backups-other-")),
  });
  assert.notEqual(elsewhere.instanceId, m.instanceId);
  assert.match(m.instanceId, /^[0-9a-f]{12}$/);
});

test("a drill whose restored database gives no usable answer does not pass", async () => {
  const { m, id } = await drillSetup({
    answer: (args) =>
      args[0] === "exec" && args.at(-1).includes("count(*)") ? "oops" : defaultAnswer(args),
  });
  const result = await m.restoreDrill(id);
  assert.equal(result.ok, false);
  assert.match(result.message, /unexpected answer/);
  assert.equal(removedScratch(m)[0], "rm");
  assert.equal(
    m.db.prepare("SELECT verify_status FROM backups WHERE id=?").get(id).verify_status,
    "failed",
  );
});

test("a failed restore is reported and the scratch container is still removed", async () => {
  const { m, id } = await drillSetup({ restoreError: "psql exited with code 3" });
  const result = await m.restoreDrill(id);
  assert.equal(result.ok, false);
  assert.match(result.message, /psql exited with code 3/);
  assert.deepEqual(removedScratch(m).slice(0, 3), ["rm", "-f", "-v"]);
});

test("a database that never becomes ready fails the drill instead of hanging", async () => {
  const { m, id } = await drillSetup({
    answer: (args) => {
      if (args[0] === "exec") throw new Error("not ready");
      return defaultAnswer(args);
    },
  });
  const result = await m.restoreDrill(id, { readyTimeoutMs: 50 });
  assert.equal(result.ok, false);
  assert.match(result.message, /did not become ready/);
  assert.equal(m.restores.length, 0, "nothing may be restored into a database that is not ready");
  assert.deepEqual(removedScratch(m).slice(0, 3), ["rm", "-f", "-v"]);
});

test("volume backups skip the restore drill instead of faking one", async () => {
  const { m, id } = await drillSetup();
  m.db.prepare("UPDATE backups SET db_type='volume' WHERE id=?").run(id);
  const result = await m.restoreDrill(id);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(m.calls.length, 0);
});

// ───────────────────────── scheduler ─────────────────────────

test("cron validation accepts supported forms and rejects the rest", () => {
  for (const ok of ["0 2 * * *", "*/15 * * * *", "30 3 1 * *", "0 9-17 * * 1-5", "0 0,12 * * *"])
    assert.equal(validateCron(ok), null, ok);
  for (const bad of [
    "",
    "* * * *",
    "61 * * * *",
    "0 25 * * *",
    "0 0 0 * *",
    "0 0 * 13 *",
    "0 0 * * 7",
    "a b c d e",
    "0 0 * * MON",
  ])
    assert.ok(validateCron(bad), `"${bad}" should be rejected`);
});

function schedulerSetup({ failBackup = false, failVerify = false, failDrill = false } = {}) {
  const sdb = new Database(":memory:");
  new BackupManager({ db: sdb, HOME: home }); // creates the backups table
  let clock = new Date("2026-10-23T10:00:00").getTime();
  const log = { backups: 0, verified: [], drills: [], deleted: [], remote: [], events: [] };
  const fake = {
    async createBackup(opts) {
      log.backups += 1;
      const id = `b${log.backups}`;
      if (failBackup) throw new Error("docker exec failed");
      sdb
        .prepare(
          `INSERT INTO backups (id, database_name, db_type, file_path, sha256, status, created_at, schedule_id, s3_key)
           VALUES (?, ?, ?, '/nowhere', 'x', 'completed', ?, ?, ?)`,
        )
        .run(id, opts.databaseName, opts.dbType, clock, opts.scheduleId, `k/${id}`);
      return { id };
    },
    async verifyBackup(id) {
      log.verified.push(id);
      return failVerify ? { ok: false, message: "Verification failed: incomplete" } : { ok: true };
    },
    async restoreDrill(id) {
      log.drills.push(id);
      return failDrill ? { ok: false, message: "Restore drill failed: boom" } : { ok: true };
    },
    deleteBackup(id) {
      log.deleted.push(id);
      sdb.prepare("DELETE FROM backups WHERE id=?").run(id);
    },
    async deleteRemoteS3Backup(key) {
      log.remote.push(key);
    },
    async cleanupDrillContainers() {},
  };
  const scheduler = new BackupScheduler({
    db: sdb,
    backups: fake,
    now: () => clock,
    recordEvent: (...args) => log.events.push(args),
  });
  return {
    scheduler,
    sdb,
    log,
    advance: (ms) => (clock += ms),
    set: (t) => (clock = t),
    now: () => clock,
  };
}

const base = {
  databaseName: "shop",
  dbType: "postgres",
  containerName: "hx_shop",
  cron: "0 2 * * *",
};
const HOUR = 3600000;

test("schedules are validated and get their first run time", () => {
  const { scheduler, now } = schedulerSetup();
  const s = scheduler.create({ ...base, keepLast: 3, drill: "restore", drillEvery: 2 });
  assert.equal(s.cron, "0 2 * * *");
  assert.equal(s.keepLast, 3);
  assert.ok(s.nextRunAt > now());
  assert.equal(new Date(s.nextRunAt).getHours(), 2);

  for (const bad of [
    { ...base, cron: "nope" },
    { ...base, dbType: "oracle" },
    { ...base, databaseName: "../etc" },
    { ...base, containerName: "bad name; rm -rf /" },
    { ...base, keepLast: 0 },
    { ...base, drill: "sometimes" },
  ])
    assert.throws(() => scheduler.create(bad));
  assert.equal(scheduler.update("missing", { keepLast: 2 }), null);
  assert.equal(scheduler.update(s.id, { keepLast: 5 }).keepLast, 5);
  assert.throws(() => scheduler.update(s.id, { cron: "nope" }));
});

test("only due schedules run, and a successful run prunes to keepLast", async () => {
  const { scheduler, sdb, log, advance } = schedulerSetup();
  const s = scheduler.create({ ...base, keepLast: 2, drill: "archive" });

  await scheduler.tick();
  assert.equal(log.backups, 0, "nothing is due yet");

  for (let day = 1; day <= 4; day++) {
    advance(24 * HOUR);
    await scheduler.tick();
  }
  assert.equal(log.backups, 4);
  assert.deepEqual(log.verified, ["b1", "b2", "b3", "b4"]);
  const kept = sdb
    .prepare("SELECT id FROM backups WHERE schedule_id=? ORDER BY created_at")
    .all(s.id);
  assert.deepEqual(
    kept.map((r) => r.id),
    ["b3", "b4"],
  );
  assert.deepEqual(log.deleted, ["b1", "b2"]);
  assert.deepEqual(log.remote, ["k/b1", "k/b2"], "remote copies are pruned with the local ones");
  const after = scheduler.get(s.id);
  assert.equal(after.lastStatus, "ok");
  assert.equal(after.lastBackupId, "b4");
  assert.ok(after.nextRunAt > Date.now() - 1);
});

test("keepDays drops old backups but always keeps the newest", async () => {
  const { scheduler, sdb, log, advance, now } = schedulerSetup();
  const s = scheduler.create({ ...base, keepLast: 50, keepDays: 3, drill: "off" });
  for (let i = 1; i <= 6; i++) {
    sdb
      .prepare(
        "INSERT INTO backups (id, database_name, db_type, file_path, sha256, status, created_at, schedule_id) VALUES (?, 'shop', 'postgres', '/x', 'x', 'completed', ?, ?)",
      )
      .run(`old${i}`, now() - i * 24 * HOUR, s.id);
  }
  advance(24 * HOUR);
  await scheduler.runNow(s.id);
  const remaining = sdb
    .prepare("SELECT id FROM backups WHERE schedule_id=? ORDER BY created_at DESC")
    .all(s.id);
  // the new backup plus those younger than 3 days; everything older is gone
  assert.ok(remaining.some((r) => r.id === "b1"));
  assert.ok(!remaining.some((r) => ["old4", "old5", "old6"].includes(r.id)));
  assert.ok(log.deleted.length >= 3);
});

test("a failing run is recorded, raises an event and prunes nothing", async () => {
  for (const mode of [{ failBackup: true }, { failVerify: true }, { failDrill: true }]) {
    const { scheduler, sdb, log } = schedulerSetup(mode);
    const s = scheduler.create({ ...base, keepLast: 1, drill: "restore", drillEvery: 1 });
    for (const id of ["keep1", "keep2"])
      sdb
        .prepare(
          "INSERT INTO backups (id, database_name, db_type, file_path, sha256, status, created_at, schedule_id) VALUES (?, 'shop', 'postgres', '/x', 'x', 'completed', 1, ?)",
        )
        .run(id, s.id);

    const result = await scheduler.runNow(s.id);
    assert.equal(result.ok, false, JSON.stringify(mode));
    assert.equal(scheduler.get(s.id).lastStatus, "failed");
    assert.ok(scheduler.get(s.id).lastError);
    assert.equal(log.deleted.length, 0, "good backups must survive a failed run");
    assert.equal(log.events.length, 1);
    assert.equal(log.events[0][1], "backup_failed");
    assert.equal(log.events[0][3], "failed");
  }
});

test("restore drills run on the first run, then every Nth, and always when run manually", async () => {
  const { scheduler, log, advance } = schedulerSetup();
  const s = scheduler.create({ ...base, drill: "restore", drillEvery: 3, keepLast: 50 });
  for (let i = 0; i < 4; i++) {
    advance(24 * HOUR);
    await scheduler.tick();
  }
  assert.deepEqual(log.drills, ["b1", "b4"], "first run, then every third");
  await scheduler.runNow(s.id); // manual
  assert.deepEqual(log.drills, ["b1", "b4", "b5"]);
  assert.ok(scheduler.get(s.id).lastDrillAt);
});

test("a schedule cannot run twice at once and runs after downtime fire once", async () => {
  const { scheduler, log, advance } = schedulerSetup();
  const s = scheduler.create({ ...base, drill: "off" });
  const first = scheduler.runNow(s.id);
  await assert.rejects(scheduler.runNow(s.id), /already running/);
  await first;

  advance(10 * 24 * HOUR); // the engine was off for ten days
  await scheduler.tick();
  assert.equal(log.backups, 2, "one catch-up run, not ten");
  advance(HOUR);
  await scheduler.tick();
  assert.equal(log.backups, 2);
});

test("starting the scheduler fails backups left in progress by a crash", () => {
  const { scheduler, sdb } = schedulerSetup();
  sdb
    .prepare(
      "INSERT INTO backups (id, database_name, db_type, file_path, sha256, status, created_at) VALUES ('stuck', 'shop', 'postgres', '/x', '', 'in_progress', 1)",
    )
    .run();
  scheduler.start();
  scheduler.stop();
  const row = sdb.prepare("SELECT status, error_message FROM backups WHERE id='stuck'").get();
  assert.equal(row.status, "failed");
  assert.match(row.error_message, /engine restart/);
});

test("a legacy backup_schedules table from an older engine is set aside, not clobbered", () => {
  const legacy = new Database(":memory:");
  legacy.exec(
    "CREATE TABLE backup_schedules (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, interval_minutes INTEGER, retention INTEGER, enabled INTEGER, last_run_at INTEGER, created_at INTEGER NOT NULL)",
  );
  legacy
    .prepare("INSERT INTO backup_schedules (id, database_id, created_at) VALUES ('old', 'd', 1)")
    .run();
  new BackupManager({ db: legacy, HOME: home });
  const scheduler = new BackupScheduler({ db: legacy, backups: {} });
  assert.equal(scheduler.create(base).databaseName, "shop");
  assert.equal(legacy.prepare("SELECT id FROM backup_schedules_legacy").get().id, "old");
});
