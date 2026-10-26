import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree, waitForTreeExit } from "../src/process-tree.mjs";

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};

/** A program that starts a child of its own and prints that child's pid, then waits forever. */
function startTree() {
  const grandchild = `setInterval(() => {}, 1000)`;
  const parent = `
    const c = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
    console.log(c.pid);
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", parent], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolve) =>
    child.stdout.once("data", (d) => resolve({ child, grandchildPid: Number(String(d).trim()) })),
  );
}

test("killTree ends a process and what it started, and waitForTreeExit returns once they are gone", async () => {
  const { child, grandchildPid } = await startTree();
  assert.ok(!gone(child.pid) && !gone(grandchildPid), "both are running");
  const began = Date.now();
  killTree(child.pid, child);
  await waitForTreeExit(child.pid, 10000);
  // on POSIX the group is signalled at once; a leader-only kill would leave the child to the delayed SIGKILL
  if (process.platform !== "win32")
    assert.ok(Date.now() - began < 2500, "ended at once, not by the delayed SIGKILL");
  assert.ok(gone(child.pid), "the process is gone");
  for (let i = 0; i < 100 && !gone(grandchildPid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(gone(grandchildPid), "and so is the process it started");
});

test("it works for an engine started with a PATH that holds nothing (taskkill is not looked up there)", async () => {
  const saved = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), "hx-empty-path-"));
  try {
    const { child, grandchildPid } = await startTree();
    killTree(child.pid, child);
    await waitForTreeExit(child.pid, 10000);
    assert.ok(gone(child.pid));
    for (let i = 0; i < 100 && !gone(grandchildPid); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(gone(grandchildPid));
  } finally {
    process.env.PATH = saved;
  }
});
