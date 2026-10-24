import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// The engine prepares statements ad hoc and opens databases it does not keep, so the garbage
// collector frees better-sqlite3 objects at arbitrary moments. better-sqlite3 11 and 12 aborted the
// whole process when that happened on Node 24.21+ ("Assertion failed: (env) != nullptr" in
// node::RemoveEnvironmentCleanupHook, raised from the Statement and Database destructors); 13 does
// not. A crash takes the process down, so the check runs in a child process, with enough allocation
// to make V8 collect the young generation where those objects live.
const script = `
import Database from "better-sqlite3";
await null; // continue from the microtask queue, where the abort was seen
let sink = 0;
const churn = (i) => { sink += new Array(2000).fill(i).length; };
const keep = new Database(":memory:");
for (let i = 0; i < 40000; i++) { keep.prepare("select ? as n").get(i); churn(i); }
for (let i = 0; i < 2000; i++) { new Database(":memory:").prepare("select 1").get(); churn(i); }
console.log("survived");
`;

test("better-sqlite3 survives garbage collection of statements and databases on this Node", () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: engineDir,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(
      r.status,
      0,
      `attempt ${attempt}: exited ${r.status ?? r.signal}\n${(r.stderr || "").split("\n").slice(0, 6).join("\n")}`,
    );
    assert.match(r.stdout, /survived/);
  }
});
