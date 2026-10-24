// End to end with REAL Docker and real databases: provision a PostgreSQL and a Redis container, put data in,
// back up through the engine, verify, restore into a throwaway container (the drill), restore over the
// original, encrypt, tamper, schedule. Nothing is faked: the containers, dumps, archives and restores are real.
//
// Skipped when there is no Docker daemon or the images cannot be pulled.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-backups-real-");
const docker = (...args) => {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  return spawnSync("docker", args, { encoding: "utf8", env, timeout: 180000 });
};

const ENGINES = {
  postgres: { image: "postgres:16-alpine" },
  redis: { image: "redis:7-alpine" },
};

let why = "";
let engine;
let admin;
const api = (method, path, body) => h.call(engine, admin, method, path, body);

before(async () => {
  if (docker("info").status !== 0) why = "no Docker daemon is running on this machine";
  for (const { image } of Object.values(ENGINES)) {
    if (why) break;
    if (docker("image", "inspect", image).status !== 0 && docker("pull", image).status !== 0)
      why = `cannot pull ${image} (no registry access?)`;
  }
  if (why) return;
  engine = await h.startEngine({ env: { HOSTERAX_EDGE_PROVIDER: "external" } });
  admin = engine.bootstrap;
  await api("POST", "/api/projects", { name: "dbproj", source: "x", target: "process" });
});
after(async () => {
  if (engine && admin) await api("DELETE", "/api/projects/dbproj?permanent=true").catch(() => {});
  await h.cleanup();
  if (why) return;
  for (const n of ["pgreal", "redisreal"]) {
    docker("rm", "-f", `hx_db_${n}`);
    docker("volume", "rm", "-f", `hx_dbvol_${n}`);
  }
  // any scratch container a drill left behind
  const left = docker("ps", "-a", "-q", "--filter", "name=hx_drill_")
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  if (left.length) docker("rm", "-f", ...left);
});

const real = (name, fn) =>
  test(name, async (t) => {
    if (why) return t.skip(why);
    await fn(t);
  });

const creds = (conn) => {
  const u = new URL(conn);
  return { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
};
const pgSql = (db, sql) => {
  const { user, pass } = creds(db.connection_string);
  return docker(
    "exec",
    "-e",
    `PGPASSWORD=${pass}`,
    `hx_db_${db.name}`,
    "psql",
    "-U",
    user,
    "-d",
    db.name,
    "-tA",
    "-c",
    sql,
  );
};
const redisCli = (db, ...args) => {
  const { pass } = creds(db.connection_string);
  return docker("exec", `hx_db_${db.name}`, "redis-cli", "-a", pass, "--no-auth-warning", ...args);
};
async function waitReady(db, probe) {
  await h.until(
    () =>
      probe(db).status === 0 &&
      !/starting up|not ready|could not/i.test(probe(db).stdout + probe(db).stderr),
    90000,
    `${db.engine} to accept queries`,
  );
}
async function provision(name, engineName) {
  const r = await api("POST", "/api/projects/dbproj/databases", { name, engine: engineName });
  assert.equal(r.status < 300, true, r.text);
  assert.equal(
    docker("inspect", "--format", "{{.State.Status}}", `hx_db_${name}`).stdout.trim(),
    "running",
  );
  return r.data;
}
/** Takes a backup through the API and returns its stored record (the create call answers with a summary). */
async function takeBackup(path, body) {
  const r = await api("POST", path, body);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.ok, true, r.text);
  const row = (await api("GET", `/api/backups/${r.data.id}`)).data;
  assert.equal(row.status, "completed", row.error_message);
  return row;
}
/** Waits for a restore drill's verdict (a plain verify leaves its own, different message). */
const pollDrill = async (id, ms = 240000) =>
  h.until(
    async () => {
      const b = (await api("GET", `/api/backups/${id}`)).data;
      return /restore drill/i.test(b.verify_message ?? "") ? b : null;
    },
    ms,
    `the restore drill of ${id}`,
  );

let pg;
let rd;
const stamp = `real-data-${Date.now()}`;

real("a PostgreSQL container is provisioned for real and takes data", async () => {
  pg = await provision("pgreal", "postgres");
  assert.equal(pg.engine, "postgres");
  await waitReady(pg, (d) => pgSql(d, "select 1"));
  assert.equal(pgSql(pg, "create table notes(id serial primary key, body text)").status, 0);
  assert.equal(pgSql(pg, `insert into notes(body) values ('${stamp}')`).status, 0);
  assert.equal(pgSql(pg, "select count(*) from notes").stdout.trim(), "1");
});

real(
  "a real pg_dump backup is checksummed, verifies, and the file is a real gzip of SQL",
  async () => {
    const b = await takeBackup(`/api/databases/${pg.id}/backup`);
    assert.equal(b.db_type, "postgres");
    assert.ok(existsSync(b.file_path) && statSync(b.file_path).size > 200);
    const head = readFileSync(b.file_path).subarray(0, 2);
    assert.deepEqual([...head], [0x1f, 0x8b], "a gzip file");
    const zcat = spawnSync("gzip", ["-dc", b.file_path], { encoding: "utf8" });
    assert.match(zcat.stdout, /CREATE TABLE public\.notes/);
    assert.ok(zcat.stdout.includes(stamp), "the data really is in the dump");
    assert.match(
      zcat.stdout,
      /PostgreSQL database dump complete/,
      "a complete dump, not a truncated one",
    );
    pg.backup = b;

    const v = await api("POST", `/api/backups/${b.id}/verify`);
    assert.equal(v.status, 200, v.text);
    assert.equal(v.data.ok, true, v.text);
  },
);

real("the restore drill brings the backup up in a throwaway container and removes it", async () => {
  const r = await api("POST", `/api/backups/${pg.backup.id}/drill`);
  assert.equal(r.status, 202, r.text);
  const done = await pollDrill(pg.backup.id);
  assert.equal(done.verify_status, "verified", done.verify_message);
  assert.match(done.verify_message, /restor/i);
  assert.equal(
    docker("ps", "-a", "-q", "--filter", "name=hx_drill_").stdout.trim(),
    "",
    "no scratch container is left behind",
  );
  // the live database was never touched
  assert.equal(pgSql(pg, "select count(*) from notes").stdout.trim(), "1");
});

real("restoring over the live database brings deleted data back", async () => {
  assert.equal(pgSql(pg, "delete from notes").status, 0);
  assert.equal(pgSql(pg, "select count(*) from notes").stdout.trim(), "0");
  const r = await api("POST", `/api/backups/${pg.backup.id}/restore`, {});
  assert.equal(r.status, 200, r.text);
  await waitReady(pg, (d) => pgSql(d, "select 1"));
  assert.equal(pgSql(pg, "select body from notes").stdout.trim(), stamp);
});

real("an encrypted backup hides its content, verifies, and restores", async () => {
  const b = await takeBackup("/api/backups/create", {
    databaseName: pg.name,
    dbType: "postgres",
    projectName: "dbproj",
    containerName: `hx_db_${pg.name}`,
    encrypt: true,
  });
  assert.match(b.file_path, /\.enc$/);
  const raw = readFileSync(b.file_path);
  assert.notDeepEqual([...raw.subarray(0, 2)], [0x1f, 0x8b], "not a plain gzip");
  assert.ok(!raw.includes(Buffer.from(stamp)), "the data is not readable in the file");
  assert.equal((await api("POST", `/api/backups/${b.id}/verify`)).data.ok, true);

  assert.equal(pgSql(pg, "delete from notes").status, 0);
  assert.equal((await api("POST", `/api/backups/${b.id}/restore`, {})).status, 200);
  await waitReady(pg, (d) => pgSql(d, "select 1"));
  assert.equal(pgSql(pg, "select body from notes").stdout.trim(), stamp);

  // a flipped byte in the archive is caught, and the restore refuses
  const bytes = Buffer.from(raw);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(b.file_path, bytes);
  const bad = await api("POST", `/api/backups/${b.id}/verify`);
  assert.equal(bad.data.ok, false, bad.text);
  assert.equal(pgSql(pg, "delete from notes").status, 0);
  const refused = await api("POST", `/api/backups/${b.id}/restore`, {});
  assert.notEqual(refused.status, 200, "a tampered archive is not restored");
  assert.equal(
    pgSql(pg, "select count(*) from notes").stdout.trim(),
    "0",
    "and the database was left alone",
  );
  // put the data back from the good backup for the next steps
  assert.equal((await api("POST", `/api/backups/${pg.backup.id}/restore`, {})).status, 200);
  await waitReady(pg, (d) => pgSql(d, "select 1"));
});

real("a tampered plain backup fails its checksum", async () => {
  const b = await takeBackup(`/api/databases/${pg.id}/backup`);
  const bytes = Buffer.from(readFileSync(b.file_path));
  bytes[bytes.length - 10] ^= 0x55;
  writeFileSync(b.file_path, bytes);
  const v = await api("POST", `/api/backups/${b.id}/verify`);
  assert.equal(v.data.ok, false, v.text);
});

real("a Redis container is backed up and restored for real", async () => {
  rd = await provision("redisreal", "redis");
  await waitReady(rd, (d) => redisCli(d, "ping"));
  assert.equal(redisCli(rd, "set", "hx:key", stamp).stdout.trim(), "OK");
  const b = await takeBackup(`/api/databases/${rd.id}/backup`);
  assert.equal(b.db_type, "redis");
  assert.equal((await api("POST", `/api/backups/${b.id}/verify`)).data.ok, true);
  assert.equal((await api("POST", `/api/backups/${b.id}/drill`)).status, 202);
  const done = await pollDrill(b.id);
  assert.equal(done.verify_status, "verified", done.verify_message);

  assert.equal(redisCli(rd, "del", "hx:key").stdout.trim(), "1");
  assert.equal((await api("POST", `/api/backups/${b.id}/restore`, {})).status, 200);
  await waitReady(rd, (d) => redisCli(d, "ping"));
  assert.equal(redisCli(rd, "get", "hx:key").stdout.trim(), stamp);
});

real(
  "a schedule runs a verified backup with a restore drill, and retention keeps only the newest",
  async () => {
    const s = await api("POST", "/api/backups/schedules", {
      managedDatabase: pg.name,
      cron: "0 3 * * *",
      keepLast: 1,
      drill: "restore",
      drillEvery: 1,
    });
    assert.equal(s.status, 201, s.text);
    const runAndWait = async () => {
      const before =
        (await api("GET", "/api/backups/schedules")).data.find((x) => x.id === s.data.id)
          .lastRunAt ?? 0;
      assert.equal((await api("POST", `/api/backups/schedules/${s.data.id}/run`)).status, 202);
      return h.until(
        async () => {
          const now = (await api("GET", "/api/backups/schedules")).data.find(
            (x) => x.id === s.data.id,
          );
          return now.lastStatus && now.lastStatus !== "running" && now.lastRunAt > before
            ? now
            : null;
        },
        300000,
        "the scheduled run",
      );
    };
    const first = await runAndWait();
    assert.equal(first.lastStatus, "ok", first.lastError);
    assert.ok(first.lastDrillAt, "the restore drill ran");
    const second = await runAndWait();
    assert.equal(second.lastStatus, "ok", second.lastError);
    const mine = (await api("GET", `/api/backups?database=${pg.name}`)).data.filter(
      (b) => b.schedule_id === s.data.id || b.id === second.lastBackupId,
    );
    assert.equal(mine.length <= 1, true, `retention keeps one, found ${mine.length}`);
    const kept = (await api("GET", `/api/backups/${second.lastBackupId}`)).data;
    assert.equal(kept.verify_status, "verified");
    assert.ok(existsSync(kept.file_path));
  },
);

real("removing a database removes its container and volume", async () => {
  for (const d of [pg, rd]) {
    const r = await api("DELETE", `/api/databases/${d.id}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(docker("ps", "-a", "-q", "--filter", `name=^hx_db_${d.name}$`).stdout.trim(), "");
    assert.notEqual(docker("volume", "inspect", `hx_dbvol_${d.name}`).status, 0);
  }
});
