// Ending a process we started together with everything it started.
//
// Apps and tunnels are launched as `sh -c "<command>"` with `detached: true`, which makes the shell the leader
// of its own process group. Killing only the shell is not enough: on Debian and Ubuntu `sh` is dash, which
// keeps running the command as a child instead of replacing itself with it, so the app would be orphaned and
// keep its port. Signalling the whole group ends both. Windows has no process groups: `taskkill /T` ends the
// tree.

import path from "node:path";
import { execFile } from "node:child_process";

/**
 * taskkill by its full path. It lives in System32, which is found through PATH only; an engine started with a
 * restricted PATH (or one an attacker controls) would otherwise fail to stop anything, silently.
 */
function taskkillPath() {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(root, "System32", "taskkill.exe");
}

/** Ends the process tree of `pid` (SIGTERM to the group, then SIGKILL three seconds later if anything is left). */
export function killTree(pid, child) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFile(
        taskkillPath(),
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        (err, _stdout, stderr) => {
          // "not found" just means it was already gone
          if (err && !/not found|no running instance/i.test(`${stderr} ${err.message}`))
            console.warn(
              `[process] taskkill ${pid} failed: ${String(stderr || err.message).trim()}`,
            );
        },
      );
      return;
    }
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }, 3000).unref();
  } catch {
    try {
      child?.kill("SIGKILL");
    } catch {}
  }
}

/** Whether nothing is left: the process group on POSIX, the process itself on Windows. */
const treeGone = (pid) => {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};

/**
 * Resolves once the tree of `pid` is gone, so a replacement can bind the same port.
 * Anything still alive after `ms` is killed outright.
 */
export async function waitForTreeExit(pid, ms = 5000) {
  if (!pid) return;
  const sleep = (n) => new Promise((r) => setTimeout(r, n));
  for (const end = Date.now() + ms; !treeGone(pid) && Date.now() < end;) await sleep(50);
  if (treeGone(pid)) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch {}
  for (const end = Date.now() + 1000; !treeGone(pid) && Date.now() < end;) await sleep(50);
}
