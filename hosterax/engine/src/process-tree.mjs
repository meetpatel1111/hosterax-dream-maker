// Ending a process we started together with everything it started.
//
// Apps and tunnels are launched as `sh -c "<command>"` with `detached: true`, which makes the shell the leader
// of its own process group. Killing only the shell is not enough: on Debian and Ubuntu `sh` is dash, which
// keeps running the command as a child instead of replacing itself with it, so the app would be orphaned and
// keep its port. Signalling the whole group ends both.

import { execFile } from "node:child_process";

/** Sends SIGTERM to the process group of `pid` (SIGKILL three seconds later if anything is left). */
export function killTree(pid, child) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
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

const treeGone = (pid) => {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};

/**
 * Resolves once nothing is left in the process group of `pid`, so a replacement can bind the same port.
 * Anything still alive after `ms` is killed outright.
 */
export async function waitForTreeExit(pid, ms = 5000) {
  if (!pid || process.platform === "win32") return;
  const sleep = (n) => new Promise((r) => setTimeout(r, n));
  for (const end = Date.now() + ms; !treeGone(pid) && Date.now() < end;) await sleep(50);
  if (treeGone(pid)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
  for (const end = Date.now() + 1000; !treeGone(pid) && Date.now() < end;) await sleep(50);
}
