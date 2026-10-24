import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { spawn, execFile } from "node:child_process";
import { spawnSync } from "./safe-exec.mjs";
import { S3StorageClient } from "./s3-storage.mjs";
import { isSafeContainerName } from "./security.mjs";
import { encryptSecret, decryptSecret, decryptJson } from "./secrets.mjs";

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

    try {
      this.db.exec("ALTER TABLE backups ADD COLUMN container_name TEXT");
    } catch {}

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
  async createBackup({ databaseName, dbType, projectName, containerName }) {
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
    const fileName = `${targetDb}_${Date.now()}.${ext}`;
    const outPath = path.join(dbSubDir, fileName);

    const createdAt = Date.now();

    // Insert pending record
    this.db
      .prepare(
        `
      INSERT INTO backups (id, project_name, database_name, db_type, file_path, file_size_bytes, sha256, destination, status, created_at, container_name)
      VALUES (?, ?, ?, ?, ?, 0, '', 'local', 'in_progress', ?, ?)
    `,
      )
      .run(bkpId, projectName || targetDb, targetDb, type, outPath, createdAt, cont);

    try {
      if (type === "mongodb" || type === "mongo") {
        await this._dumpMongo(cont, outPath);
      } else if (type === "postgres" || type === "postgresql") {
        await this._dumpPostgres(cont, outPath);
      } else if (type === "mysql" || type === "mariadb") {
        await this._dumpMysql(cont, outPath);
      } else if (type === "redis") {
        await this._dumpRedis(cont, outPath);
      } else {
        // Generic volume or directory backup
        await this._dumpVolume(cont, outPath);
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

    if (type === "mongodb" || type === "mongo") {
      await this._restoreMongo(cont, bkp.file_path);
    } else if (type === "postgres" || type === "postgresql") {
      await this._restorePostgres(cont, bkp.file_path);
    } else if (type === "mysql" || type === "mariadb") {
      await this._restoreMysql(cont, bkp.file_path);
    } else if (type === "redis") {
      await this._restoreRedis(cont, bkp.file_path);
    } else {
      await this._restoreVolume(cont, bkp.file_path);
    }

    return {
      ok: true,
      id,
      database: bkp.database_name,
      verifiedSha256: currentHash,
      restoredAt: new Date().toISOString(),
      message: `Snapshot "${id}" verified (SHA-256: ${currentHash.slice(0, 16)}...) and restored successfully to container "${cont}".`,
    };
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
  // Internal helpers — everything runs `docker` WITHOUT a shell and fails loudly.
  // A backup that did not really happen is never recorded as "completed".
  // -------------------------------------------------------------

  _assertContainer(name) {
    if (!isSafeContainerName(name))
      throw new Error(`Invalid container name: ${JSON.stringify(name)}`);
  }

  /** Streams `docker <args>` stdout into outPath (optionally gzip-compressed). */
  async _streamToFile(args, outPath, { gzip = false } = {}) {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = fs.createWriteStream(outPath);
    let stderr = "";
    let bytes = 0;
    child.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.stdout.on("data", (d) => (bytes += d.length));
    const written = new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
    });
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    (gzip ? child.stdout.pipe(zlib.createGzip()) : child.stdout).pipe(out);
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
  async _streamFromFile(args, filePath, { gunzip = false } = {}) {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.stdout.resume();
    child.stdin.on("error", () => {}); // surfaced through the exit code
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    const src = fs.createReadStream(filePath);
    const input = gunzip ? src.pipe(zlib.createGunzip()) : src;
    src.on("error", (e) => child.kill() && child.stdin.destroy(e));
    input.on("error", (e) => {
      stderr += `input error: ${e.message}`;
      child.stdin.end();
    });
    input.pipe(child.stdin);
    const code = await exited;
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

  async _dumpMongo(containerName, outPath) {
    this._assertContainer(containerName);
    const script =
      'exec mongodump --archive --gzip ${MONGO_INITDB_ROOT_USERNAME:+--username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin}';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath);
  }

  async _dumpPostgres(containerName, outPath) {
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
      { gzip: true },
    );
  }

  async _dumpMysql(containerName, outPath) {
    this._assertContainer(containerName);
    const script =
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysqldump || command -v mariadb-dump)"; [ -n "$B" ] || { echo "mysqldump not found in container" >&2; exit 127; }; exec "$B" --all-databases --single-transaction -uroot ${P:+-p"$P"}';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath, { gzip: true });
  }

  async _dumpRedis(containerName, outPath) {
    this._assertContainer(containerName);
    const script =
      'A=""; [ -n "$REDIS_PASSWORD" ] && A="-a $REDIS_PASSWORD --no-auth-warning"; [ "$(redis-cli $A SAVE)" = "OK" ] && cat /data/dump.rdb';
    await this._streamToFile(["exec", containerName, "sh", "-c", script], outPath, { gzip: true });
  }

  /** Archives every named Docker volume attached to the container into one tar.gz. */
  async _dumpVolume(containerName, outPath) {
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
    await this._streamToFile(args, outPath);
  }

  // -------------------------------------------------------------
  // Restores
  // -------------------------------------------------------------

  async _restoreMongo(containerName, filePath) {
    this._assertContainer(containerName);
    const script =
      'exec mongorestore --archive --gzip --drop ${MONGO_INITDB_ROOT_USERNAME:+--username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin}';
    await this._streamFromFile(["exec", "-i", containerName, "sh", "-c", script], filePath);
  }

  async _restorePostgres(containerName, filePath) {
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
      { gunzip: true },
    );
  }

  async _restoreMysql(containerName, filePath) {
    this._assertContainer(containerName);
    const script =
      'P="${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"; B="$(command -v mysql || command -v mariadb)"; [ -n "$B" ] || { echo "mysql client not found in container" >&2; exit 127; }; exec "$B" -uroot ${P:+-p"$P"}';
    await this._streamFromFile(["exec", "-i", containerName, "sh", "-c", script], filePath, {
      gunzip: true,
    });
  }

  async _restoreRedis(containerName, filePath) {
    this._assertContainer(containerName);
    const tmp = path.join(os.tmpdir(), `hx-redis-${crypto.randomBytes(6).toString("hex")}.rdb`);
    try {
      await pipeline(fs.createReadStream(filePath), zlib.createGunzip(), fs.createWriteStream(tmp));
      // The RDB must be swapped in while Redis is stopped, otherwise it overwrites it on shutdown.
      await this._docker(["stop", containerName], 60000);
      await this._docker(["cp", tmp, `${containerName}:/data/dump.rdb`]);
      await this._docker(["start", containerName]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async _restoreVolume(containerName, filePath) {
    this._assertContainer(containerName);
    const volumes = await this._volumesOf(containerName);
    if (volumes.length === 0)
      throw new Error(`Container "${containerName}" has no named volumes to restore into.`);
    await this._docker(["stop", containerName], 60000);
    try {
      const args = ["run", "--rm", "-i"];
      for (const v of volumes) args.push("-v", `${v}:/backup/${v}`);
      args.push("alpine:3.20", "tar", "xzf", "-", "-C", "/backup");
      await this._streamFromFile(args, filePath);
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
