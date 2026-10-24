import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import zlib from "node:zlib";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn, execFile } from "node:child_process";
import { spawnSync } from "./safe-exec.mjs";
import { S3StorageClient } from "./s3-storage.mjs";
import { isSafeContainerName, isValidEnvKey } from "./security.mjs";
import {
  encryptSecret,
  decryptSecret,
  decryptJson,
  createEncryptStream,
  createDecryptStream,
  authenticateEncryptedFile,
} from "./secrets.mjs";

const DRILL_SKIP_ENV = new Set(["PATH", "HOME", "HOSTNAME", "TERM"]);

// Commands run inside the scratch container. They use the container's own environment (copied from the
// source container), never interpolated values.
const DRILL_SCRIPTS = {
  postgres: {
    ready: 'pg_isready -q -h 127.0.0.1 -U "${POSTGRES_USER:-postgres}"',
    check:
      'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "${POSTGRES_USER:-postgres}" -d postgres -Atc "select count(*) from pg_database where not datistemplate"',
  },
  mysql: {
    ready:
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysqladmin || command -v mariadb-admin)"; [ -n "$B" ] && "$B" ping -h 127.0.0.1 -uroot ${P:+-p"$P"} --silent',
    check:
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysql || command -v mariadb)"; "$B" -h 127.0.0.1 -uroot ${P:+-p"$P"} -Nse "select count(*) from information_schema.schemata"',
  },
  mongo: {
    ready:
      'B="$(command -v mongosh || command -v mongo)"; "$B" --quiet --eval "db.adminCommand({ping:1}).ok" | grep -q 1',
    check:
      'B="$(command -v mongosh || command -v mongo)"; "$B" --quiet ${MONGO_INITDB_ROOT_USERNAME:+-u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin} --eval "db.adminCommand({listDatabases:1}).ok"',
  },
  redis: {
    ready:
      'A=""; [ -n "$REDIS_PASSWORD" ] && A="-a $REDIS_PASSWORD --no-auth-warning"; redis-cli $A ping | grep -q PONG',
    check:
      'A=""; [ -n "$REDIS_PASSWORD" ] && A="-a $REDIS_PASSWORD --no-auth-warning"; redis-cli $A dbsize',
  },
};

export class BackupManager {
  constructor({ db, HOME }) {
    this.db = db;
    this.HOME = HOME;
    this.backupsDir = path.join(this.HOME, "backups");
    fs.mkdirSync(this.backupsDir, { recursive: true });

    this.initSchema();
  }

  initSchema() {
    try {
      const cols = this.db
        .prepare("PRAGMA table_info(backups)")
        .all()
        .map((c) => c.name);
      if (cols.length > 0 && !cols.includes("database_name")) {
        // Drop legacy empty table
        this.db.exec("DROP TABLE backups");
      }
    } catch {}

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        project_name TEXT,
        database_name TEXT NOT NULL,
        db_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL,
        destination TEXT NOT NULL DEFAULT 'local',
        status TEXT NOT NULL DEFAULT 'completed',
        s3_key TEXT,
        s3_synced_at INTEGER,
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_backups_db ON backups(database_name);
      CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);

      CREATE TABLE IF NOT EXISTS storage_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        endpoint TEXT,
        region TEXT DEFAULT 'us-east-1',
        bucket TEXT NOT NULL,
        access_key_id TEXT NOT NULL,
        secret_access_key TEXT NOT NULL,
        prefix TEXT DEFAULT 'hosterax-backups',
        auto_sync INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    for (const col of [
      "container_name TEXT",
      "schedule_id TEXT",
      "encrypted INTEGER NOT NULL DEFAULT 0",
      "verified_at INTEGER",
      "verify_status TEXT",
      "verify_message TEXT",
    ]) {
      try {
        this.db.exec(`ALTER TABLE backups ADD COLUMN ${col}`);
      } catch {}
    }

    // Older versions recorded a tiny placeholder text file as a "completed" snapshot whenever the
    // real dump failed. Flag those honestly so nobody trusts them for a restore.
    try {
      const markers = [
        "MONGODUMP_ARCHIVE_V1",
        "-- HosteraX Managed Database Backup",
        "-- HosteraX MySQL Dump",
        "REDIS0009\nDATABASE=",
        "VOLUME_SNAPSHOT_V1",
      ];
      const suspects = this.db
        .prepare(
          "SELECT id, file_path FROM backups WHERE status='completed' AND file_size_bytes < 1024",
        )
        .all();
      for (const row of suspects) {
        try {
          const head = fs.readFileSync(row.file_path, "utf8").slice(0, 80);
          if (markers.some((m) => head.startsWith(m))) {
            this.db
              .prepare("UPDATE backups SET status='invalid', error_message=? WHERE id=?")
              .run(
                "Placeholder file written by an older HosteraX version — this was never a real backup.",
                row.id,
              );
          }
        } catch {}
      }
    } catch {}

    // Encrypt any S3 secret that is still stored in plaintext.
    try {
      for (const row of this.db
        .prepare("SELECT id, secret_access_key FROM storage_providers")
        .all()) {
        const enc = encryptSecret(row.secret_access_key);
        if (enc !== row.secret_access_key)
          this.db
            .prepare("UPDATE storage_providers SET secret_access_key=? WHERE id=?")
            .run(enc, row.id);
      }
    } catch {}
  }

  /**
   * Detect running database containers and projects
   */
  async detectTargets() {
    const targets = [];

    // 1. Inspect running Docker containers
    try {
      const res = spawnSync("docker", ["ps", "--format", "{{.Names}}|{{.Image}}|{{.Ports}}"], {
        encoding: "utf8",
        timeout: 4000,
      });

      if (res.stdout) {
        const lines = res.stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          const [name, image, ports] = line.split("|");
          const lowerImg = (image || "").toLowerCase();
          const lowerName = (name || "").toLowerCase();

          let dbType = null;
          let label = name;

          if (lowerImg.includes("mongo") || lowerName.includes("mongo")) {
            dbType = "mongodb";
            label = "MongoDB";
          } else if (lowerImg.includes("postgres") || lowerName.includes("postgres")) {
            dbType = "postgres";
            label = "PostgreSQL";
          } else if (lowerImg.includes("mysql") || lowerName.includes("mysql")) {
            dbType = "mysql";
            label = "MySQL";
          } else if (lowerImg.includes("mariadb") || lowerName.includes("mariadb")) {
            dbType = "mariadb";
            label = "MariaDB";
          } else if (lowerImg.includes("redis") || lowerName.includes("redis")) {
            dbType = "redis";
            label = "Redis";
          } else if (lowerImg.includes("clickhouse") || lowerName.includes("clickhouse")) {
            dbType = "clickhouse";
            label = "ClickHouse";
          }

          if (dbType) {
            targets.push({
              id: name,
              name,
              containerName: name,
              dbType,
              image,
              label: `${label} (${name})`,
              ports,
              isContainer: true,
            });
          }
        }
      }
    } catch {}

    // 2. Add projects from SQLite if they have attached databases or persistent volumes
    try {
      const projects = this.db.prepare("SELECT name, source, target, env_json FROM projects").all();
      for (const p of projects) {
        const env = decryptJson(p.env_json);
        const hasMongo = env.MONGO_DB_URI || env.MONGODB_URI;
        const hasPostgres = env.DATABASE_URL?.includes("postgres") || env.POSTGRES_URL;
        const hasRedis = env.REDIS_URL || env.REDIS_HOST;

        targets.push({
          id: `proj_${p.name}`,
          name: p.name,
          containerName: `hx_${p.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          dbType: hasMongo ? "mongodb" : hasPostgres ? "postgres" : hasRedis ? "redis" : "volume",
          image: p.source,
          label: `Project: ${p.name}`,
          isContainer: false,
          projectName: p.name,
        });
      }
    } catch {}

    return targets;
  }

  /**
   * List all backups
   */
  listBackups(filter = {}) {
    let sql = "SELECT * FROM backups";
    const params = [];

    if (filter.database_name) {
      sql += " WHERE database_name=?";
      params.push(filter.database_name);
    } else if (filter.project_name) {
      sql += " WHERE project_name=?";
      params.push(filter.project_name);
    }

    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...params);

    return rows.map((r) => ({
      ...r,
      sizeMb: parseFloat((r.file_size_bytes / 1048576).toFixed(2)),
      existsOnDisk: fs.existsSync(r.file_path),
    }));
  }

  /**
   * Get single backup by ID
   */
  getBackup(id) {
    const row = this.db.prepare("SELECT * FROM backups WHERE id=?").get(id);
    if (!row) return null;
    return {
      ...row,
      sizeMb: parseFloat((row.file_size_bytes / 1048576).toFixed(2)),
      existsOnDisk: fs.existsSync(row.file_path),
    };
  }

  /**
   * Create a real database snapshot
   */
  async createBackup({
    databaseName,
    dbType,
    projectName,
    containerName,
    encrypt = false,
    scheduleId = null,
  }) {
    const bkpId = `bkp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const targetDb = databaseName || containerName || "database";
    const type = (dbType || "mongodb").toLowerCase();
    const cont = containerName || databaseName || "hx_mongo";

    const dbSubDir = path.join(this.backupsDir, targetDb.replace(/[^a-zA-Z0-9_-]/g, "_"));
    fs.mkdirSync(dbSubDir, { recursive: true });

    const ext =
      type === "mongodb" || type === "mongo"
        ? "dump.gz"
        : type === "redis"
          ? "rdb.gz"
          : ["postgres", "postgresql", "mysql", "mariadb"].includes(type)
            ? "sql.gz"
            : "tar.gz";
    const fileName = `${targetDb}_${Date.now()}.${ext}${encrypt ? ".enc" : ""}`;
    const outPath = path.join(dbSubDir, fileName);

    const createdAt = Date.now();

    // Insert pending record
    this.db
      .prepare(
        `
      INSERT INTO backups (id, project_name, database_name, db_type, file_path, file_size_bytes, sha256, destination, status, created_at, container_name, schedule_id, encrypted)
      VALUES (?, ?, ?, ?, ?, 0, '', 'local', 'in_progress', ?, ?, ?, ?)
    `,
      )
      .run(
        bkpId,
        projectName || targetDb,
        targetDb,
        type,
        outPath,
        createdAt,
        cont,
        scheduleId,
        encrypt ? 1 : 0,
      );

    try {
      const opts = { encrypt: Boolean(encrypt) };
      if (type === "mongodb" || type === "mongo") {
        await this._dumpMongo(cont, outPath, opts);
      } else if (type === "postgres" || type === "postgresql") {
        await this._dumpPostgres(cont, outPath, opts);
      } else if (type === "mysql" || type === "mariadb") {
        await this._dumpMysql(cont, outPath, opts);
      } else if (type === "redis") {
        await this._dumpRedis(cont, outPath, opts);
      } else {
        // Generic volume or directory backup
        await this._dumpVolume(cont, outPath, opts);
      }

      // Verify file generated and compute SHA-256 hash
      if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
        throw new Error("Backup file was not created or has 0 bytes");
      }

      const fileStats = fs.statSync(outPath);
      const sha256 = await this._computeSha256(outPath);
      const finishedAt = Date.now();

      this.db
        .prepare(
          `
        UPDATE backups
        SET file_size_bytes=?, sha256=?, status='completed', finished_at=?
        WHERE id=?
      `,
        )
        .run(fileStats.size, sha256, finishedAt, bkpId);

      const s3Raw = this.getRawS3Config();
      let s3Synced = false;
      let s3Location = null;
      if (s3Raw && s3Raw.auto_sync && s3Raw.bucket) {
        try {
          const syncRes = await this.syncBackupToS3(bkpId);
          s3Synced = syncRes.ok;
          s3Location = syncRes.location;
        } catch (s3Err) {
          console.warn("[backup-manager] S3 auto-sync error:", s3Err.message);
        }
      }

      return {
        ok: true,
        id: bkpId,
        database: targetDb,
        type,
        encrypted: Boolean(encrypt),
        sizeMb: parseFloat((fileStats.size / 1048576).toFixed(2)),
        fileSizeBytes: fileStats.size,
        sha256,
        filePath: outPath,
        s3Synced,
        s3Location,
        createdAt: new Date(createdAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
      };
    } catch (err) {
      this.db
        .prepare(
          `
        UPDATE backups
        SET status='failed', error_message=?, finished_at=?
        WHERE id=?
      `,
        )
        .run(err.message, Date.now(), bkpId);
      throw err;
    }
  }

  /**
   * Instant Restore Pipeline with SHA-256 Checksum Verification
   */
  async restoreBackup(id, targetContainer = null) {
    const bkp = this.getBackup(id);
    if (!bkp) throw new Error(`Backup with ID "${id}" not found.`);

    if (bkp.status !== "completed") {
      throw new Error(
        `Backup "${id}" is ${bkp.status} and cannot be restored${bkp.error_message ? `: ${bkp.error_message}` : "."}`,
      );
    }

    if (!fs.existsSync(bkp.file_path)) {
      throw new Error(`Backup file "${bkp.file_path}" does not exist on disk.`);
    }

    // 1. Verify SHA-256 integrity
    const currentHash = await this._computeSha256(bkp.file_path);
    if (bkp.sha256 && currentHash !== bkp.sha256) {
      throw new Error(
        `SHA-256 integrity mismatch! Expected ${bkp.sha256}, but file computed ${currentHash}. Restore aborted to prevent corruption.`,
      );
    }

    const cont = bkp.container_name || targetContainer || bkp.database_name;
    const type = bkp.db_type.toLowerCase();

    // GCM only proves authenticity at the end of the file, so check it before any byte reaches a database.
    if (bkp.encrypted) await authenticateEncryptedFile(bkp.file_path);
    await this._restoreByType(type, cont, bkp.file_path, { decrypt: Boolean(bkp.encrypted) });

    return {
      ok: true,
      id,
      database: bkp.database_name,
      verifiedSha256: currentHash,
      restoredAt: new Date().toISOString(),
      message: `Snapshot "${id}" verified (SHA-256: ${currentHash.slice(0, 16)}...) and restored successfully to container "${cont}".`,
    };
  }

  _restoreByType(type, container, filePath, opts = {}) {
    if (type === "mongodb" || type === "mongo")
      return this._restoreMongo(container, filePath, opts);
    if (type === "postgres" || type === "postgresql")
      return this._restorePostgres(container, filePath, opts);
    if (type === "mysql" || type === "mariadb")
      return this._restoreMysql(container, filePath, opts);
    if (type === "redis") return this._restoreRedis(container, filePath, opts);
    return this._restoreVolume(container, filePath, opts);
  }

  /** A readable stream of the backup as a standard archive (decrypted when it was stored encrypted). */
  async openBackupStream(bkp) {
    if (!bkp.encrypted) return fs.createReadStream(bkp.file_path);
    await authenticateEncryptedFile(bkp.file_path);
    return fs.createReadStream(bkp.file_path).pipe(createDecryptStream());
  }

  /**
   * Delete snapshot
   */
  deleteBackup(id) {
    const bkp = this.getBackup(id);
    if (!bkp) return { ok: false, message: "Backup not found" };

    try {
      if (fs.existsSync(bkp.file_path)) {
        fs.unlinkSync(bkp.file_path);
      }
    } catch {}

    this.db.prepare("DELETE FROM backups WHERE id=?").run(id);
    return { ok: true, id, message: `Backup "${id}" removed successfully.` };
  }

  // -------------------------------------------------------------
  // Verification and restore drills
  // -------------------------------------------------------------

  /** Streams an archive (decrypting / gunzipping as needed) and keeps its first and last bytes. */
  async _inspectArchive(bkp) {
    const type = bkp.db_type.toLowerCase();
    const gzipped = !(type === "mongodb" || type === "mongo");
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let bytes = 0;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        bytes += chunk.length;
        if (head.length < 600) head = Buffer.concat([head, chunk]).subarray(0, 600);
        tail = Buffer.concat([tail, chunk]).subarray(-4096);
        cb();
      },
    });
    await pipeline(
      fs.createReadStream(bkp.file_path),
      ...(bkp.encrypted ? [createDecryptStream()] : []),
      ...(gzipped ? [zlib.createGunzip()] : []),
      sink,
    );
    return { head, tail, bytes };
  }

  /**
   * Proves a backup is intact without touching Docker: the checksum still matches, the encryption
   * (if any) authenticates, the archive decompresses end to end, and it ends the way a complete dump
   * of its type does. The result is stored on the backup row.
   */
  async verifyBackup(id) {
    const bkp = this.getBackup(id);
    if (!bkp) throw new Error(`Backup with ID "${id}" not found.`);
    const checks = [];
    let failure = null;
    try {
      if (bkp.status !== "completed") throw new Error(`the backup is ${bkp.status}`);
      if (!fs.existsSync(bkp.file_path)) throw new Error("the archive file is missing from disk");
      if (fs.statSync(bkp.file_path).size === 0) throw new Error("the archive file is empty");
      const sha = await this._computeSha256(bkp.file_path);
      if (bkp.sha256 && sha !== bkp.sha256)
        throw new Error("the SHA-256 no longer matches — the file changed after it was written");
      checks.push("checksum matches");
      if (bkp.encrypted) {
        await authenticateEncryptedFile(bkp.file_path);
        checks.push("encryption authenticated");
      }
      let inspected;
      try {
        inspected = await this._inspectArchive(bkp);
      } catch (e) {
        throw new Error(`the archive cannot be read: ${e.message}`);
      }
      if (inspected.bytes === 0) throw new Error("the archive contains no data");
      const type = bkp.db_type.toLowerCase();
      const tail = inspected.tail.toString("latin1");
      if (type === "postgres" || type === "postgresql") {
        if (!/PostgreSQL database (cluster )?dump complete/.test(tail))
          throw new Error("the dump is incomplete (no completion footer)");
        checks.push("dump is complete");
      } else if (type === "mysql" || type === "mariadb") {
        if (!/-- Dump completed/.test(tail))
          throw new Error("the dump is incomplete (no completion footer)");
        checks.push("dump is complete");
      } else if (type === "redis") {
        if (!inspected.head.toString("latin1").startsWith("REDIS"))
          throw new Error("the data is not a Redis RDB snapshot");
        checks.push("RDB header present");
      } else if (type === "mongodb" || type === "mongo") {
        checks.push("archive readable (mongodump archives cannot be inspected further)");
      } else {
        if (inspected.head.subarray(257, 262).toString("latin1") !== "ustar")
          throw new Error("the data is not a tar archive");
        checks.push("tar header present");
      }
      if (type !== "mongodb" && type !== "mongo") checks.push("decompresses cleanly");
    } catch (e) {
      failure = e.message;
    }
    const ok = !failure;
    const message = ok
      ? `Archive verified: ${checks.join(", ")}.`
      : `Verification failed: ${failure}`;
    this.db
      .prepare("UPDATE backups SET verified_at=?, verify_status=?, verify_message=? WHERE id=?")
      .run(Date.now(), ok ? "verified" : "failed", message, id);
    return { ok, id, checks, message };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * The strongest check there is: restore the backup into a throwaway container started from the same
   * image as the source, confirm the database answers, and delete the container. The source database is
   * never touched. Needs a working Docker daemon; volume backups fall back to archive verification.
   */
  async restoreDrill(id, { readyTimeoutMs = 120000 } = {}) {
    const bkp = this.getBackup(id);
    if (!bkp) throw new Error(`Backup with ID "${id}" not found.`);
    const type = bkp.db_type.toLowerCase();
    const kind = type.startsWith("postgres")
      ? "postgres"
      : type === "mysql" || type === "mariadb"
        ? "mysql"
        : type === "mongodb" || type === "mongo"
          ? "mongo"
          : type === "redis"
            ? "redis"
            : null;
    if (!kind) {
      return {
        ok: true,
        skipped: true,
        id,
        message:
          "Restore drills are not available for volume backups; the archive was verified instead.",
      };
    }
    const script = DRILL_SCRIPTS[kind];
    const started = Date.now();
    const scratch = `hx_drill_${crypto.randomBytes(5).toString("hex")}`;
    let failure = null;
    try {
      if (bkp.status !== "completed") throw new Error(`the backup is ${bkp.status}`);
      if (!bkp.container_name) throw new Error("the backup does not record its source container");
      this._assertContainer(bkp.container_name);
      if (bkp.encrypted) await authenticateEncryptedFile(bkp.file_path);

      const image = (
        await this._docker(["inspect", bkp.container_name, "--format", "{{.Config.Image}}"])
      ).trim();
      if (!image) throw new Error("could not determine the source container's image");
      const envList = JSON.parse(
        (await this._docker(["inspect", bkp.container_name, "--format", "{{json .Config.Env}}"])) ||
          "[]",
      );
      const envArgs = [];
      for (const kv of envList) {
        const i = String(kv).indexOf("=");
        const key = i > 0 ? kv.slice(0, i) : "";
        if (isValidEnvKey(key) && !DRILL_SKIP_ENV.has(key)) envArgs.push("-e", kv);
      }
      await this._docker(
        [
          "run",
          "-d",
          "--name",
          scratch,
          "--label",
          "hosterax.drill=1",
          "--network",
          "none",
          "--memory",
          "1g",
          ...envArgs,
          image,
        ],
        180000,
      );

      // Official images start a temporary server while initialising and then restart; require the
      // database to answer twice, a few seconds apart, before restoring into it.
      const deadline = Date.now() + readyTimeoutMs;
      let consecutive = 0;
      while (consecutive < 2) {
        if (Date.now() > deadline) throw new Error("the scratch database did not become ready");
        try {
          await this._docker(["exec", scratch, "sh", "-c", script.ready], 15000);
          consecutive += 1;
        } catch {
          consecutive = 0;
        }
        if (consecutive < 2) await this._sleep(3000);
      }

      await this._restoreByType(type, scratch, bkp.file_path, { decrypt: Boolean(bkp.encrypted) });
      if (kind === "redis") await this._sleep(1000); // the container restarts to load the RDB

      const answer = (
        await this._docker(["exec", scratch, "sh", "-c", script.check], 30000)
      ).trim();
      if (!/^\d+$/.test(answer))
        throw new Error(`the restored database gave an unexpected answer: ${answer || "(empty)"}`);
    } catch (e) {
      failure = e.message;
    } finally {
      await this._docker(["rm", "-f", "-v", scratch]).catch(() => {});
    }
    const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
    const ok = !failure;
    const message = ok
      ? `Restore drill passed: restored into a scratch ${kind} container and it answered (${seconds}s).`
      : `Restore drill failed: ${failure}`;
    this.db
      .prepare("UPDATE backups SET verified_at=?, verify_status=?, verify_message=? WHERE id=?")
      .run(Date.now(), ok ? "verified" : "failed", message, id);
    return { ok, id, message, durationSeconds: seconds };
  }

  /** Removes scratch containers left behind by a drill that was interrupted (e.g. engine restart). */
  async cleanupDrillContainers() {
    try {
      const ids = (await this._docker(["ps", "-aq", "--filter", "label=hosterax.drill=1"], 15000))
        .split(/\s+/)
        .filter(Boolean);
      if (ids.length) await this._docker(["rm", "-f", "-v", ...ids], 60000);
      return ids.length;
    } catch {
      return 0; // Docker unavailable — nothing to clean
    }
  }

  // -------------------------------------------------------------
  // Internal helpers — everything runs `docker` WITHOUT a shell and fails loudly.
  // A backup that did not really happen is never recorded as "completed".
  // -------------------------------------------------------------

  _assertContainer(name) {
    if (!isSafeContainerName(name))
      throw new Error(`Invalid container name: ${JSON.stringify(name)}`);
  }

  /** Streams `docker <args>` stdout into outPath (optionally gzip-compressed). */
  async _streamToFile(args, outPath, { gzip = false, encrypt = false } = {}) {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = fs.createWriteStream(outPath);
    let stderr = "";
    let bytes = 0;
    child.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.stdout.on("data", (d) => (bytes += d.length));
    const written = pipeline(
      child.stdout,
      ...(gzip ? [zlib.createGzip()] : []),
      ...(encrypt ? [createEncryptStream()] : []),
      out,
    );
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    try {
      const [code] = await Promise.all([exited, written]);
      if (code !== 0)
        throw new Error(
          `docker ${args[0]} exited with code ${code}: ${stderr.trim() || "no error output"}`,
        );
      if (bytes === 0)
        throw new Error(`docker ${args[0]} produced no data: ${stderr.trim() || "empty output"}`);
    } catch (err) {
      out.destroy();
      try {
        fs.rmSync(outPath, { force: true });
      } catch {}
      throw err;
    }
  }

  /** Feeds a (optionally gunzipped) file to `docker <args>` on stdin. */
  async _streamFromFile(args, filePath, { gunzip = false, decrypt = false } = {}) {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let inputError = null;
    child.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.stdout.resume();
    child.stdin.on("error", () => {}); // surfaced through the exit code
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    const onInputError = (e) => {
      inputError = inputError || e;
      stderr += `input error: ${e.message}`;
      child.stdin.end();
    };
    const src = fs.createReadStream(filePath);
    src.on("error", (e) => child.kill() && child.stdin.destroy(e));
    let input = src;
    for (const stage of [
      ...(decrypt ? [createDecryptStream()] : []),
      ...(gunzip ? [zlib.createGunzip()] : []),
    ]) {
      stage.on("error", onInputError);
      input = input.pipe(stage);
    }
    input.on("error", onInputError);
    input.pipe(child.stdin);
    const code = await exited;
    if (inputError) throw new Error(`restore input was unreadable: ${inputError.message}`);
    if (code !== 0)
      throw new Error(
        `docker ${args[0]} exited with code ${code}: ${stderr.trim() || "no error output"}`,
      );
  }

  _docker(args, timeout = 60000) {
    return new Promise((resolve, reject) => {
      execFile(
        "docker",
        args,
        { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) =>
          err
            ? reject(new Error(`docker ${args[0]} failed: ${(stderr || err.message).trim()}`))
            : resolve(stdout),
      );
    });
  }

  async _volumesOf(containerName) {
    const out = await this._docker([
      "inspect",
      containerName,
      "--format",
      '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}',
    ]);
    return out.split(/\s+/).filter(Boolean);
  }

  // -------------------------------------------------------------
  // Dumps
  // -------------------------------------------------------------

  async _dumpMongo(containerName, outPath, opts = {}) {
    this._assertContainer(containerName);
    const script =
      'exec mongodump --archive --gzip ${MONGO_INITDB_ROOT_USERNAME:+--username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin}';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath, {
      encrypt: opts.encrypt,
    });
  }

  async _dumpPostgres(containerName, outPath, opts = {}) {
    this._assertContainer(containerName);
    await this._streamToFile(
      [
        "exec",
        containerName,
        "sh",
        "-c",
        'exec pg_dumpall -U "${POSTGRES_USER:-postgres}" --clean --if-exists',
      ],
      outPath,
      { gzip: true, encrypt: opts.encrypt },
    );
  }

  async _dumpMysql(containerName, outPath, opts = {}) {
    this._assertContainer(containerName);
    const script =
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysqldump || command -v mariadb-dump)"; [ -n "$B" ] || { echo "mysqldump not found in container" >&2; exit 127; }; exec "$B" --all-databases --single-transaction -uroot ${P:+-p"$P"}';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath, {
      gzip: true,
      encrypt: opts.encrypt,
    });
  }

  async _dumpRedis(containerName, outPath, opts = {}) {
    this._assertContainer(containerName);
    const script =
      'A=""; [ -n "$REDIS_PASSWORD" ] && A="-a $REDIS_PASSWORD --no-auth-warning"; [ "$(redis-cli $A SAVE)" = "OK" ] && cat /data/dump.rdb';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath, {
      gzip: true,
      encrypt: opts.encrypt,
    });
  }

  /** Archives every named Docker volume attached to the container into one tar.gz. */
  async _dumpVolume(containerName, outPath, opts = {}) {
    this._assertContainer(containerName);
    const volumes = await this._volumesOf(containerName);
    if (volumes.length === 0) {
      throw new Error(
        `Container "${containerName}" has no named volumes — nothing persistent to back up.`,
      );
    }
    const args = ["run", "--rm"];
    for (const v of volumes) args.push("-v", `${v}:/backup/${v}:ro`);
    args.push("alpine:3.20", "tar", "czf", "-", "-C", "/backup", ".");
    await this._streamToFile(args, outPath, { encrypt: opts.encrypt });
  }

  // -------------------------------------------------------------
  // Restores
  // -------------------------------------------------------------

  async _restoreMongo(containerName, filePath, opts = {}) {
    this._assertContainer(containerName);
    const script =
      'exec mongorestore --archive --gzip --drop ${MONGO_INITDB_ROOT_USERNAME:+--username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin}';
    await this._streamFromFile(["exec", "-i", containerName, "sh", "-c", script], filePath, {
      decrypt: opts.decrypt,
    });
  }

  async _restorePostgres(containerName, filePath, opts = {}) {
    this._assertContainer(containerName);
    await this._streamFromFile(
      [
        "exec",
        "-i",
        containerName,
        "sh",
        "-c",
        'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d postgres',
      ],
      filePath,
      { gunzip: true, decrypt: opts.decrypt },
    );
  }

  async _restoreMysql(containerName, filePath, opts = {}) {
    this._assertContainer(containerName);
    const script =
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysql || command -v mariadb)"; [ -n "$B" ] || { echo "mysql client not found in container" >&2; exit 127; }; exec "$B" -uroot ${P:+-p"$P"}';
    await this._streamFromFile(["exec", "-i", containerName, "sh", "-c", script], filePath, {
      gunzip: true,
      decrypt: opts.decrypt,
    });
  }

  async _restoreRedis(containerName, filePath, opts = {}) {
    this._assertContainer(containerName);
    const tmp = path.join(os.tmpdir(), `hx-redis-${crypto.randomBytes(6).toString("hex")}.rdb`);
    try {
      await pipeline(
        fs.createReadStream(filePath),
        ...(opts.decrypt ? [createDecryptStream()] : []),
        zlib.createGunzip(),
        fs.createWriteStream(tmp),
      );
      // The RDB must be swapped in while Redis is stopped, otherwise it overwrites it on shutdown.
      await this._docker(["stop", containerName], 60000);
      await this._docker(["cp", tmp, `${containerName}:/data/dump.rdb`]);
      await this._docker(["start", containerName]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async _restoreVolume(containerName, filePath, opts = {}) {
    this._assertContainer(containerName);
    const volumes = await this._volumesOf(containerName);
    if (volumes.length === 0)
      throw new Error(`Container "${containerName}" has no named volumes to restore into.`);
    await this._docker(["stop", containerName], 60000);
    try {
      const args = ["run", "--rm", "-i"];
      for (const v of volumes) args.push("-v", `${v}:/backup/${v}`);
      args.push("alpine:3.20", "tar", "xzf", "-", "-C", "/backup");
      await this._streamFromFile(args, filePath, { decrypt: opts.decrypt });
    } finally {
      await this._docker(["start", containerName]).catch(() => {});
    }
  }

  async _computeSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (d) => hash.update(d));
      stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
      stream.on("error", reject);
    });
  }

  // ────────── S3 / Cloudflare R2 Remote Storage Subsystem ──────────

  getS3Config() {
    const row = this.db.prepare("SELECT * FROM storage_providers WHERE id='default_s3'").get();
    if (!row) {
      return {
        configured: false,
        name: "Remote S3 Bucket",
        provider_type: "s3",
        endpoint: "",
        region: "us-east-1",
        bucket: "",
        access_key_id: "",
        secret_access_key: "",
        prefix: "hosterax-backups",
        auto_sync: 0,
      };
    }
    return {
      configured: Boolean(row.bucket && row.access_key_id && row.secret_access_key),
      name: row.name,
      provider_type: row.provider_type,
      endpoint: row.endpoint || "",
      region: row.region || "us-east-1",
      bucket: row.bucket,
      access_key_id: row.access_key_id,
      secret_access_key: row.secret_access_key ? "••••••••••••••••" : "",
      prefix: row.prefix || "hosterax-backups",
      auto_sync: row.auto_sync || 0,
      updated_at: row.updated_at,
    };
  }

  getRawS3Config() {
    const row = this.db.prepare("SELECT * FROM storage_providers WHERE id='default_s3'").get();
    return row ? { ...row, secret_access_key: decryptSecret(row.secret_access_key) } : row;
  }

  saveS3Config(cfg) {
    const now = Date.now();
    const existing = this.getRawS3Config();

    const secretKey =
      cfg.secret_access_key && !cfg.secret_access_key.includes("•••")
        ? cfg.secret_access_key
        : existing?.secret_access_key || "";

    const clean = {
      id: "default_s3",
      name: cfg.name || "Remote S3 Storage",
      provider_type: cfg.provider_type || "s3",
      endpoint: (cfg.endpoint || "").trim(),
      region: (cfg.region || "us-east-1").trim(),
      bucket: (cfg.bucket || "").trim(),
      access_key_id: (cfg.access_key_id || "").trim(),
      secret_access_key: encryptSecret(secretKey.trim()),
      prefix: (cfg.prefix || "hosterax-backups").trim(),
      auto_sync: cfg.auto_sync ? 1 : 0,
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    this.db
      .prepare(
        `
      INSERT INTO storage_providers (id, name, provider_type, endpoint, region, bucket, access_key_id, secret_access_key, prefix, auto_sync, created_at, updated_at)
      VALUES (@id, @name, @provider_type, @endpoint, @region, @bucket, @access_key_id, @secret_access_key, @prefix, @auto_sync, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        provider_type=excluded.provider_type,
        endpoint=excluded.endpoint,
        region=excluded.region,
        bucket=excluded.bucket,
        access_key_id=excluded.access_key_id,
        secret_access_key=excluded.secret_access_key,
        prefix=excluded.prefix,
        auto_sync=excluded.auto_sync,
        updated_at=excluded.updated_at
    `,
      )
      .run(clean);

    return this.getS3Config();
  }

  async testS3Connection(cfg = null) {
    const raw = cfg || this.getRawS3Config();
    if (!raw) return { ok: false, message: "No S3 storage credentials configured." };

    const client = new S3StorageClient({
      endpoint: raw.endpoint,
      region: raw.region,
      bucket: raw.bucket,
      accessKeyId: raw.access_key_id,
      secretAccessKey: raw.secret_access_key,
      prefix: raw.prefix,
    });

    return await client.testConnection();
  }

  async syncBackupToS3(backupId) {
    const bkp = this.getBackup(backupId);
    if (!bkp) throw new Error(`Backup with ID "${backupId}" not found.`);

    const raw = this.getRawS3Config();
    if (!raw || !raw.bucket) throw new Error("S3 remote storage is not configured.");

    const client = new S3StorageClient({
      endpoint: raw.endpoint,
      region: raw.region,
      bucket: raw.bucket,
      accessKeyId: raw.access_key_id,
      secretAccessKey: raw.secret_access_key,
      prefix: raw.prefix,
    });

    const filename = path.basename(bkp.file_path);
    const s3Key = `${raw.prefix || "hosterax-backups"}/${bkp.database_name}/${filename}`;

    const res = await client.uploadBackupFile(bkp.file_path, s3Key);

    const now = Date.now();
    this.db
      .prepare("UPDATE backups SET s3_key=?, s3_synced_at=?, destination='s3_synced' WHERE id=?")
      .run(s3Key, now, backupId);

    return {
      ok: true,
      backupId,
      s3Key,
      location: res.location,
      syncedAt: new Date(now).toISOString(),
    };
  }

  async listRemoteS3Backups() {
    const raw = this.getRawS3Config();
    if (!raw || !raw.bucket) return [];

    const client = new S3StorageClient({
      endpoint: raw.endpoint,
      region: raw.region,
      bucket: raw.bucket,
      accessKeyId: raw.access_key_id,
      secretAccessKey: raw.secret_access_key,
      prefix: raw.prefix,
    });

    return await client.listRemoteBackups();
  }

  async deleteRemoteS3Backup(s3Key) {
    const raw = this.getRawS3Config();
    if (!raw || !raw.bucket) return false;

    const client = new S3StorageClient({
      endpoint: raw.endpoint,
      region: raw.region,
      bucket: raw.bucket,
      accessKeyId: raw.access_key_id,
      secretAccessKey: raw.secret_access_key,
      prefix: raw.prefix,
    });

    return await client.deleteRemoteBackup(s3Key);
  }
}
