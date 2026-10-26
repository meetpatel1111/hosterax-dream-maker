// The `backups` table is created by the engine's core schema before BackupManager ever sees it, so the
// columns BackupManager and BackupScheduler rely on have to be added to a table that already exists. A test
// that gives BackupManager an empty in-memory database cannot see that: it creates its own, complete table.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHarness } from "./helpers/engine-harness.mjs";

const h = createHarness("hosterax-backups-schema-");
after(() => h.cleanup());

test("a freshly started engine has every column the backup code reads and writes", async () => {
  const engine = await h.startEngine();
  await engine.stop();
  const db = new Database(join(engine.home, "hosterax.db"), { readonly: true });
  const have = new Set(
    db
      .prepare("PRAGMA table_info(backups)")
      .all()
      .map((c) => c.name),
  );
  db.close();
  for (const column of [
    "s3_key", // read by retention, written by S3 sync
    "s3_synced_at",
    "container_name",
    "schedule_id",
    "encrypted",
    "verified_at",
    "verify_status",
    "verify_message",
  ])
    assert.ok(have.has(column), `backups.${column} is missing`);
});
